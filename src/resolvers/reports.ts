import { evaluate, levelOf } from '../domain/gaps';
import { evaluateGate, GateResult } from '../domain/gate';
import { TraceGraph } from '../domain/graph';
import { getPack } from '../domain/packs';
import { nodeStatus, traceChain } from '../domain/status';
import { Artifact, ArtifactKind, Gap, KIND_LABEL } from '../domain/types';
import { ensureSchema } from '../storage/forgeSql';
import { getSettings, getState, setState } from '../storage/settings';
import { jira, route } from '../sync/atlassian';
import { repo } from '../sync/sync';
import { redactor, visibleIds } from './visibility';

/**
 * Read models for the cockpit (Jira global page) and the matrix macro
 * (Confluence). Computed on the full graph, redacted per user.
 */

async function siteUrl(): Promise<string> {
  const cached = await getState<string>('siteUrl');
  if (cached) return cached;
  const info = await jira<{ baseUrl: string }>(route`/rest/api/3/serverInfo`, {}, 'Read site');
  await setState('siteUrl', info.baseUrl);
  return info.baseUrl;
}

export function urlOf(base: string, a: Artifact | undefined): string | undefined {
  if (!a) return undefined;
  if (a.source === 'jira') return `${base}/browse/${a.key}`;
  if (a.source === 'confluence') return `${base}/wiki/pages/viewpage.action?pageId=${a.sourceId}`;
  return undefined;
}

/** "[SRS-004] Occlusion ..." -> "SRS-004" */
export const refOf = (a: Artifact) => /^\[([A-Z]+-\d+)\]/.exec(a.title)?.[1];

async function context() {
  await ensureSchema();
  const settings = await getSettings();
  const pack = getPack(settings.pack);
  const graph = await repo.loadGraph();
  const [visible, base] = await Promise.all([visibleIds(graph), siteUrl()]);
  return { settings, pack, graph, visible, base };
}

export function releasesOf(graph: TraceGraph): string[] {
  const set = new Set<string>();
  for (const a of graph.artifacts.values()) for (const r of a.releases ?? []) set.add(r);
  return [...set].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}

function gapRow(graph: TraceGraph, base: string, g: Gap) {
  const a = graph.get(g.artifactId);
  return {
    key: g.artifactKey,
    ref: a ? refOf(a) : undefined,
    title: a?.title,
    kind: KIND_LABEL[g.artifactKind],
    clause: g.clause,
    blocking: g.blocking,
    message: g.message,
    url: urlOf(base, a),
  };
}

export async function cockpit(release?: string) {
  const { settings, pack, graph, visible, base } = await context();
  const releases = releasesOf(graph);
  const rel = release ?? releases[0] ?? '*';
  const now = new Date().toISOString();
  const gate: GateResult = evaluateGate(graph, pack, rel, now, settings.defaultLevel);
  const ev = evaluate(graph, pack, { defaultLevel: settings.defaultLevel });
  const r = redactor(visible);

  const gapsByKind: Record<string, { label: string; blocking: number; warnings: number }> = {};
  for (const g of ev.gaps) {
    const k = (gapsByKind[g.artifactKind] ??= { label: KIND_LABEL[g.artifactKind], blocking: 0, warnings: 0 });
    if (g.blocking) k.blocking++;
    else k.warnings++;
  }
  const counts: Partial<Record<ArtifactKind, number>> = {};
  for (const a of graph.artifacts.values()) counts[a.kind] = (counts[a.kind] ?? 0) + 1;

  return {
    standard: { id: pack.id, name: pack.name, basis: pack.basis, levelName: pack.levelName, depth: pack.depth },
    releases,
    release: rel,
    gate: {
      green: gate.green,
      summary: gate.summary,
      scopeSize: gate.scopeSize,
      blocking: r.keep(gate.blocking).map((g) => gapRow(graph, base, g)),
      warnings: r.keep(gate.warnings).map((g) => gapRow(graph, base, g)),
      evaluatedAt: gate.evaluatedAt,
    },
    coverage: ev.coverage,
    gapsByKind: Object.entries(gapsByKind).map(([kind, v]) => ({ kind, ...v })),
    totals: { artifacts: graph.artifacts.size, gaps: ev.gaps.length, blocking: ev.gaps.filter((g) => g.blocking).length },
    counts: Object.entries(counts).map(([kind, n]) => ({ kind, label: KIND_LABEL[kind as ArtifactKind], n })),
    suspects: {
      open: graph.openSuspects().length,
      timeline: (await repo.suspectTimeline()).map((t) => ({ day: t.day, opened: Number(t.opened) })),
    },
    snapshots: (await repo.listSnapshots(rel === '*' ? undefined : rel)).map((s) => ({
      id: Number(s.id),
      release: s.release_id,
      at: s.created_at,
      green: Number(s.green) === 1,
    })),
    note: r.note(),
  };
}

export async function snapshot(release: string, accountId?: string) {
  const data = await cockpit(release);
  await repo.saveSnapshot(release, data.gate.green, { gate: data.gate, coverage: data.coverage, standard: data.standard }, new Date().toISOString(), accountId);
  return cockpit(release);
}

export async function chainFor(key: string) {
  const { graph, visible, base } = await context();
  const root = graph.resolve(key) ?? [...graph.artifacts.values()].find((a) => refOf(a) === key.trim().toUpperCase());
  if (!root || !visible.has(root.id)) return { found: false as const, key };
  const chain = traceChain(graph, root.id)!;
  const r = redactor(visible);
  return {
    found: true as const,
    summary: chain.summary,
    columns: chain.columns.map((c) => ({
      ...c,
      nodes: r.keep(c.nodes).map((n) => ({ ...n, ref: refOf(graph.get(n.id)!), url: urlOf(base, graph.get(n.id)) })),
    })),
    links: chain.links,
    note: r.note(),
  };
}

/** Matrix rows: one per software requirement and risk control, with everything it traces to. */
export async function matrix(release?: string) {
  const { settings, pack, graph, visible, base } = await context();
  const scopeRelease = release && release !== '*' ? release : undefined;
  const gate = evaluateGate(graph, pack, scopeRelease ?? '*', new Date().toISOString(), settings.defaultLevel);
  const gapsById = new Map<string, Gap[]>();
  for (const g of [...gate.blocking, ...gate.warnings]) {
    if (!g.artifactId) continue;
    gapsById.set(g.artifactId, [...(gapsById.get(g.artifactId) ?? []), g]);
  }
  const ref = (a: Artifact) => ({
    key: a.key,
    ref: refOf(a),
    title: a.title,
    url: urlOf(base, a),
    status: nodeStatus(graph, a).text,
    tone: nodeStatus(graph, a).tone,
    visible: visible.has(a.id),
  });
  const hide = (xs: ReturnType<typeof ref>[]) => xs.map((x) => (x.visible ? x : { key: 'Restricted', title: 'You cannot view this item', status: '', tone: 'neutral' as const, visible: false }));

  const rows = [...graph.artifacts.values()]
    .filter((a) => a.kind === 'SRS' || a.kind === 'RC')
    .filter((a) => !scopeRelease || a.releases?.includes(scopeRelease))
    .filter((a) => visible.has(a.id))
    .sort((x, y) => (refOf(x) ?? x.key).localeCompare(refOf(y) ?? y.key, undefined, { numeric: true }))
    .map((a) => {
      const up = graph.upstream(a.id);
      const down = graph.downstream(a.id);
      const ownGaps = gapsById.get(a.id) ?? [];
      return {
        ...ref(a),
        kind: a.kind,
        level: levelOf(a, pack, settings.defaultLevel),
        version: a.version,
        system: hide(up.filter((u) => u.kind === 'SYS').map(ref)),
        risk: hide(
          a.kind === 'RC'
            ? up.filter((u) => u.kind === 'HAZ').map(ref)
            : up.filter((u) => u.kind === 'RC').flatMap((rc) => [ref(rc), ...graph.upstream(rc.id, 'mitigates').map(ref)]),
        ),
        design: hide(down.filter((d) => d.kind === 'DES').map(ref)),
        implementation: hide(down.filter((d) => d.kind === 'IMP' || d.kind === 'SRS').map(ref)),
        verification: hide(down.filter((d) => d.kind === 'VER').map(ref)),
        gaps: ownGaps.map((g) => ({ clause: g.clause, message: g.message, blocking: g.blocking })),
        suspect: [...graph.upstreamEdges(a.id), ...graph.downstreamEdges(a.id)].some((e) => graph.openSuspect(e.id)),
      };
    });

  const evidence = (await repo.allEvidence())
    .filter((e) => visible.has(e.artifact_id))
    .map((e) => {
      const a = graph.get(e.artifact_id);
      return {
        key: a?.key ?? e.artifact_id,
        ref: a ? refOf(a) : undefined,
        title: a?.title,
        kind: e.kind,
        result: e.result,
        at: e.at,
        againstVersion: e.against_version,
        recordedBy: e.recorded_by,
        url: urlOf(base, a),
      };
    });

  return {
    standard: { id: pack.id, name: pack.name, basis: pack.basis, levelName: pack.levelName, levels: pack.levels },
    clauses: pack.clauses,
    releases: releasesOf(graph),
    release: scopeRelease ?? '*',
    gate: { green: gate.green, summary: gate.summary },
    rows,
    evidence,
    generatedAt: new Date().toISOString(),
  };
}
