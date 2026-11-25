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
import { META_PROPERTY, PublishedRef, PublishedRow, ROW_PROPERTY } from '../sync/publish';
import { trackedJql } from '../sync/recompute';
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

/**
 * Matrix for the Confluence macro / space page. Forge storage is per
 * installation, so this reads the read model the Jira installation publishes
 * into Jira entity properties, searching AS THE USER (Jira permissions apply).
 */
export async function matrix(release?: string) {
  const base = await siteUrl();
  const jql = await trackedJql();
  const rows: PublishedRow[] = [];
  const evidence: {
    key: string; ref?: string; title?: string; kind: string; result: string; at: string;
    againstVersion: number | null; recordedBy: string | null; url?: string;
  }[] = [];
  const projects = new Set<string>();
  let nextPageToken: string | undefined;
  do {
    const page = await jira<{
      issues: { id: string; key: string; fields: { summary?: string }; properties?: Record<string, unknown> }[];
      nextPageToken?: string;
      isLast?: boolean;
    }>(
      route`/rest/api/3/search/jql`,
      {
        method: 'POST',
        asUser: true,
        body: JSON.stringify({ jql, fields: ['summary'], properties: [ROW_PROPERTY, 'traceline'], maxResults: 100, nextPageToken }),
      },
      'Read published matrix',
    );
    for (const iss of page.issues ?? []) {
      const row = iss.properties?.[ROW_PROPERTY] as PublishedRow | undefined;
      if (row?.schema === 1) {
        rows.push(row);
        projects.add(iss.key.split('-')[0]);
      }
      const t = iss.properties?.traceline as { result?: string; resultAt?: string; resultBy?: string; resultAgainst?: Record<string, number> } | undefined;
      if (t?.result && t.resultAt) {
        evidence.push({
          key: iss.key,
          ref: /^\[([A-Z]+-\d+)\]/.exec(iss.fields.summary ?? '')?.[1],
          title: iss.fields.summary,
          kind: 'test-result',
          result: t.result,
          at: t.resultAt,
          againstVersion: t.resultAgainst ? Object.values(t.resultAgainst)[0] ?? null : null,
          recordedBy: t.resultBy ?? null,
          url: `${base}/browse/${iss.key}`,
        });
      }
    }
    nextPageToken = page.isLast === false || page.nextPageToken ? page.nextPageToken : undefined;
  } while (nextPageToken);

  type Meta = {
    standard: { id: string; name: string; basis: string; levelName: string; levels: string[] };
    clauses: { id: string; title: string }[];
    releases: string[];
    gates: Record<string, { green: boolean; summary: string }>;
    publishedAt: string;
  };
  let meta: Meta | undefined;
  for (const p of projects) {
    const prop = await jira<{ value?: Meta }>(route`/rest/api/3/project/${p}/properties/${META_PROPERTY}`, { asUser: true }, 'Read meta').catch(
      () => undefined,
    );
    if (prop?.value) {
      meta = prop.value;
      break;
    }
  }
  const pack = getPack(meta?.standard.id);
  const rel = release && release !== '*' ? release : undefined;
  const toUrl = (r: PublishedRef) =>
    r.source === 'jira' ? `${base}/browse/${r.key}` : r.source === 'confluence' ? `${base}/wiki/pages/viewpage.action?pageId=${r.sourceId}` : undefined;
  const withUrls = (xs: PublishedRef[]) => xs.map((x) => ({ ...x, title: x.ref ?? x.key, url: toUrl(x), visible: true }));
  const out = rows
    .filter((r) => !rel || r.releases.includes(rel))
    .sort((x, y) => (x.ref ?? x.key).localeCompare(y.ref ?? y.key, undefined, { numeric: true }))
    .map((r) => ({
      ...r,
      url: `${base}/browse/${r.key}`,
      visible: true,
      system: withUrls(r.system),
      risk: withUrls(r.risk),
      design: withUrls(r.design),
      implementation: withUrls(r.implementation),
      verification: withUrls(r.verification),
    }));
  const gate = meta?.gates[rel ?? '*'] ?? { green: false, summary: 'Traceline has not published a release gate yet. Open the Traceline cockpit in Jira once.' };
  return {
    standard: meta?.standard ?? { id: pack.id, name: pack.name, basis: pack.basis, levelName: pack.levelName, levels: [...pack.levels] },
    clauses: meta?.clauses ?? pack.clauses,
    releases: meta?.releases ?? [],
    release: rel ?? '*',
    gate,
    rows: out,
    evidence: evidence.sort((a, b) => b.at.localeCompare(a.at)),
    generatedAt: meta?.publishedAt ?? new Date().toISOString(),
  };
}
