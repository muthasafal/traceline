import { Queue } from '@forge/events';
import { evaluateGate } from '../domain/gate';
import { levelOf } from '../domain/gaps';
import { TraceGraph } from '../domain/graph';
import { getPack } from '../domain/packs';
import { nodeStatus } from '../domain/status';
import { Artifact, Gap } from '../domain/types';
import { contentHash } from './mapping';
import { getSettings, getState, setState } from '../storage/settings';
import { jira, route } from './atlassian';
import { repo } from './sync';

/**
 * Forge storage is per installation: the Confluence installation cannot read
 * the Jira installation's SQL or KVS. So the Jira installation (the source of
 * truth) publishes a read model into Jira entity properties, which any
 * installation can read with the user's own permissions:
 *  - issue property `traceline-row` on every software requirement / risk control
 *  - project property `traceline-meta` with the standard and per-release gate
 * Verification results are already on each test issue's `traceline` property.
 */

export const ROW_PROPERTY = 'traceline-row';
export const META_PROPERTY = 'traceline-meta';

const refOf = (a: Artifact) => /^\[([A-Z]+-\d+)\]/.exec(a.title)?.[1];

export interface PublishedRef {
  key: string;
  ref?: string;
  status: string;
  tone: string;
  source: string;
  sourceId: string;
}

export interface PublishedRow {
  schema: 1;
  key: string;
  ref?: string;
  title: string;
  kind: 'SRS' | 'RC';
  level: string;
  version: number;
  status: string;
  tone: string;
  releases: string[];
  system: PublishedRef[];
  risk: PublishedRef[];
  design: PublishedRef[];
  implementation: PublishedRef[];
  verification: PublishedRef[];
  gaps: { clause: string; message: string; blocking: boolean }[];
  suspect: boolean;
  publishedAt: string;
}

function refTo(graph: TraceGraph, a: Artifact): PublishedRef {
  const st = nodeStatus(graph, a);
  return { key: a.key, ref: refOf(a), status: st.text, tone: st.tone, source: a.source, sourceId: a.sourceId };
}

export function buildRows(graph: TraceGraph, gaps: Gap[], packId: string, defaultLevel: string, now: string): PublishedRow[] {
  const pack = getPack(packId);
  const byId = new Map<string, Gap[]>();
  for (const g of gaps) if (g.artifactId) byId.set(g.artifactId, [...(byId.get(g.artifactId) ?? []), g]);
  return [...graph.artifacts.values()]
    .filter((a) => (a.kind === 'SRS' || a.kind === 'RC') && a.source === 'jira')
    .map((a) => {
      const up = graph.upstream(a.id);
      const down = graph.downstream(a.id);
      const st = nodeStatus(graph, a);
      return {
        schema: 1 as const,
        key: a.key,
        ref: refOf(a),
        title: a.title,
        kind: a.kind as 'SRS' | 'RC',
        level: levelOf(a, pack, defaultLevel),
        version: a.version,
        status: st.text,
        tone: st.tone,
        releases: a.releases ?? [],
        system: up.filter((u) => u.kind === 'SYS').map((u) => refTo(graph, u)),
        risk:
          a.kind === 'RC'
            ? up.filter((u) => u.kind === 'HAZ').map((u) => refTo(graph, u))
            : up.filter((u) => u.kind === 'RC').flatMap((rc) => [refTo(graph, rc), ...graph.upstream(rc.id, 'mitigates').map((h) => refTo(graph, h))]),
        design: down.filter((d) => d.kind === 'DES').map((d) => refTo(graph, d)),
        implementation: down.filter((d) => d.kind === 'IMP' || d.kind === 'SRS').map((d) => refTo(graph, d)),
        verification: down.filter((d) => d.kind === 'VER').map((d) => refTo(graph, d)),
        gaps: (byId.get(a.id) ?? []).map((g) => ({ clause: g.clause, message: g.message, blocking: g.blocking })),
        suspect: [...graph.upstreamEdges(a.id), ...graph.downstreamEdges(a.id)].some((e) => graph.openSuspect(e.id)),
        publishedAt: now,
      };
    });
}

/** Publish rows (only the ones that changed) and per-project meta. Runs in the Jira installation. */
export async function publishReadModel() {
  const settings = await getSettings();
  const pack = getPack(settings.pack);
  const graph = await repo.loadGraph();
  const now = new Date().toISOString();
  const all = evaluateGate(graph, pack, '*', now, settings.defaultLevel);
  const rows = buildRows(graph, [...all.blocking, ...all.warnings], pack.id, settings.defaultLevel, now);

  const hashes = (await getState<Record<string, string>>('publishedRowHashes')) ?? {};
  let written = 0;
  for (const r of rows) {
    const { publishedAt: _p, ...stable } = r;
    const h = contentHash(JSON.stringify(stable));
    if (hashes[r.key] === h) continue;
    const a = graph.getByKey(r.key)!;
    await jira(route`/rest/api/3/issue/${a.sourceId}/properties/${ROW_PROPERTY}`, { method: 'PUT', body: JSON.stringify(r) }, 'Publish row');
    hashes[r.key] = h;
    written++;
  }
  await setState('publishedRowHashes', hashes);

  // Backfill when/by on test issues whose results were recorded before the read model existed.
  const done = new Set((await getState<string[]>('evidencePublished')) ?? []);
  const latest = new Map<string, { at: string; by: string | null }>();
  for (const e of await repo.allEvidence()) if (!latest.has(e.artifact_id)) latest.set(e.artifact_id, { at: e.at, by: e.recorded_by });
  for (const [id, ev] of latest) {
    const a = graph.get(id);
    if (!a || a.source !== 'jira' || done.has(`${id}@${ev.at}`)) continue;
    const current = await jira<{ value?: Record<string, unknown> }>(route`/rest/api/3/issue/${a.sourceId}/properties/traceline`, {}, 'Read test property').catch(
      () => undefined,
    );
    if (current?.value?.resultAt !== ev.at) {
      await jira(
        route`/rest/api/3/issue/${a.sourceId}/properties/traceline`,
        { method: 'PUT', body: JSON.stringify({ ...(current?.value ?? {}), resultAt: ev.at, resultBy: ev.by ?? undefined }) },
        'Backfill test evidence',
      );
    }
    done.add(`${id}@${ev.at}`);
  }
  await setState('evidencePublished', [...done]);

  // Per-release gate, stored on every project that holds a tracked requirement.
  const releases = [...new Set(rows.flatMap((r) => r.releases))].sort();
  const gates: Record<string, { green: boolean; summary: string }> = { '*': { green: all.green, summary: all.summary } };
  for (const rel of releases) {
    const g = evaluateGate(graph, pack, rel, now, settings.defaultLevel);
    gates[rel] = { green: g.green, summary: g.summary };
  }
  const meta = {
    schema: 1,
    standard: { id: pack.id, name: pack.name, basis: pack.basis, levelName: pack.levelName, levels: pack.levels },
    clauses: pack.clauses,
    releases,
    gates,
    publishedAt: now,
  };
  const projects = new Set(rows.map((r) => r.key.split('-')[0]));
  for (const p of projects) {
    await jira(route`/rest/api/3/project/${p}/properties/${META_PROPERTY}`, { method: 'PUT', body: JSON.stringify(meta) }, 'Publish meta');
  }
  await setState('lastPublish', { at: now, rows: rows.length, written });
  return { rows: rows.length, written };
}

const jobs = new Queue({ key: 'traceline-jobs' });

/** Coalesce bursts of changes into one publish ~20 s later. */
export async function schedulePublish() {
  const last = await getState<number>('publishQueuedAt');
  if (last && Date.now() - last < 20_000) return;
  await setState('publishQueuedAt', Date.now());
  await jobs.push({ body: { type: 'publish' }, delayInSeconds: 20 });
}
