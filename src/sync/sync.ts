import { TraceGraph } from '../domain/graph';
import { detectSuspects } from '../domain/suspect';
import { Edge, Relation } from '../domain/types';
import { forgeSql } from '../storage/forgeSql';
import { StoredArtifact, TraceRepository } from '../storage/repository';
import { getSettings, Settings } from '../storage/settings';
import { confluence, HttpError, jira, route } from './atlassian';
import {
  JiraIssue,
  RemoteLink,
  contentHash,
  edgesFromIssueLinks,
  edgesFromRemoteLinks,
  issueContent,
  jiraId,
  kindOfIssue,
  pageId,
  pageKey,
  pageKind,
  safetyClassOf,
} from './mapping';

export const repo = new TraceRepository(forgeSql);

const ISSUE_FIELDS = 'summary,description,issuetype,labels,fixVersions,status,issuelinks';
const LINK_RELS: Relation[] = ['implements', 'verifies', 'mitigates', 'derives', 'designs'];

export async function fetchIssue(idOrKey: string): Promise<JiraIssue | undefined> {
  try {
    return await jira<JiraIssue>(
      route`/rest/api/3/issue/${idOrKey}?fields=${ISSUE_FIELDS}&properties=traceline`,
      {},
      `Read issue ${idOrKey}`,
    );
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return undefined;
    throw e;
  }
}

async function fetchRemoteLinks(idOrKey: string): Promise<RemoteLink[]> {
  return (await jira<RemoteLink[]>(route`/rest/api/3/issue/${idOrKey}/remotelink`, {}, 'Read remote links')) ?? [];
}

/** Build the artifact for an issue, bumping the version when its content changed. */
function toArtifact(issue: JiraIssue, s: Settings, prev: StoredArtifact | undefined, now: string): StoredArtifact | undefined {
  const kind = kindOfIssue(issue, s);
  if (!kind) return undefined;
  const hash = contentHash(issueContent(issue));
  const changed = !!prev && prev.contentHash !== undefined && prev.contentHash !== hash;
  const prop = issue.properties?.traceline;
  return {
    id: jiraId(issue.id),
    kind,
    source: 'jira',
    sourceId: issue.id,
    key: issue.key,
    title: issue.fields.summary ?? issue.key,
    safetyClass: safetyClassOf(issue),
    version: prev ? prev.version + (changed ? 1 : 0) : 1,
    contentHash: hash,
    updatedAt: changed || !prev ? now : prev.updatedAt,
    status: issue.fields.status?.name,
    result: kind === 'VER' ? (prop?.result ?? prev?.result) : undefined,
    resultAgainstVersion: prev?.resultAgainstVersion,
    releases: (issue.fields.fixVersions ?? []).map((v) => v.name),
    paths: prop?.paths ?? prev?.paths,
    sample: prop?.sample ?? (issue.fields.labels ?? []).includes('traceline-sample'),
  };
}

export interface SyncResult {
  artifact?: StoredArtifact;
  versionBumped: boolean;
  newSuspects: number;
}

/**
 * Incremental sync of one issue: artifact row, its link edges (both
 * directions), Confluence remote-link edges, then suspect detection for
 * anything downstream of it if its content changed.
 */
export async function syncIssue(idOrKey: string, now = new Date().toISOString()): Promise<SyncResult> {
  const s = await getSettings();
  const issue = await fetchIssue(idOrKey);
  if (!issue) {
    // Deleted (or no longer visible to the app).
    if (/^\d+$/.test(idOrKey)) await repo.deleteArtifact(jiraId(idOrKey));
    return { versionBumped: false, newSuspects: 0 };
  }
  const prev = await repo.getArtifact(jiraId(issue.id));
  const art = toArtifact(issue, s, prev, now);
  if (!art) {
    if (prev) await repo.deleteArtifact(prev.id);
    return { versionBumped: false, newSuspects: 0 };
  }
  await repo.upsertArtifact(art);

  // Jira issue links: make sure the other ends exist, then reconcile edges touching this issue.
  const linkEdges = edgesFromIssueLinks(issue, s, now);
  for (const { otherIssueId } of linkEdges) {
    if (!(await repo.getArtifact(jiraId(otherIssueId)))) {
      const other = await fetchIssue(otherIssueId);
      const otherArt = other && toArtifact(other, s, undefined, now);
      if (otherArt) await repo.upsertArtifact(otherArt);
    }
  }
  const remote = edgesFromRemoteLinks(issue, await fetchRemoteLinks(issue.key), now);
  for (const { pageId: pid } of remote) {
    if (!(await repo.getArtifact(pageId(pid)))) await syncPage(pid, now).catch(() => undefined);
  }
  const graphBefore = await repo.loadGraph();
  const wanted: Edge[] = [...linkEdges.map((x) => x.edge), ...remote.map((x) => x.edge)]
    .filter((e) => graphBefore.get(e.fromId) && graphBefore.get(e.toId))
    .map((e) => withInitialReview(graphBefore, e));
  await reconcileEdgesTouching(art.id, wanted, graphBefore);

  const versionBumped = !!prev && art.version > prev.version;
  let newSuspects = 0;
  if (versionBumped) {
    const g = await repo.loadGraph();
    const created = detectSuspects(g, now, [art.id]);
    await repo.insertSuspects(created);
    newSuspects = created.length;
  }
  return { artifact: art, versionBumped, newSuspects };
}

/**
 * Non-verification links count as reviewed against the upstream version that
 * existed when the link was made. Verification links stay unverified until a
 * result is recorded.
 */
function withInitialReview(g: TraceGraph, e: Edge): Edge {
  if (e.rel === 'verifies') return e;
  return { ...e, verifiedAgainstVersion: g.get(e.toId)?.version };
}

async function reconcileEdgesTouching(id: string, wanted: Edge[], g: TraceGraph) {
  const wantedIds = new Set(wanted.map((e) => e.id));
  const existing = [...g.upstreamEdges(id), ...g.downstreamEdges(id)].filter((e) => LINK_RELS.includes(e.rel));
  for (const e of existing) if (!wantedIds.has(e.id)) await repo.deleteEdge(e.id);
  for (const e of wanted) if (!g.edges.has(e.id)) await repo.ensureEdge(e);
}

interface ConfluencePage {
  id: string;
  title: string;
  version?: { number: number; createdAt?: string };
  spaceId?: string;
}

export async function syncPage(id: string, now = new Date().toISOString()): Promise<SyncResult> {
  const s = await getSettings();
  let page: ConfluencePage;
  try {
    page = await confluence<ConfluencePage>(route`/wiki/api/v2/pages/${id}`, {}, `Read page ${id}`);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) {
      await repo.deleteArtifact(pageId(id));
      return { versionBumped: false, newSuspects: 0 };
    }
    throw e;
  }
  const labels = await confluence<{ results: { name: string }[] }>(route`/wiki/api/v2/pages/${id}/labels`, {}, 'Read page labels');
  const names = labels.results.map((l) => l.name);
  const kind = pageKind(names, s);
  const prev = await repo.getArtifact(pageId(id));
  if (!kind) {
    if (prev) await repo.deleteArtifact(prev.id);
    return { versionBumped: false, newSuspects: 0 };
  }
  const version = page.version?.number ?? 1;
  const cls = names.map((n) => /^class-([abc])$/i.exec(n)?.[1]).find(Boolean)?.toUpperCase();
  const art: StoredArtifact = {
    id: pageId(id),
    kind,
    source: 'confluence',
    sourceId: id,
    key: pageKey(page.title, id),
    title: page.title.replace(/^[A-Z][A-Z0-9]*-\d+\s*[:\-–]\s*/, ''),
    safetyClass: cls,
    version,
    updatedAt: page.version?.createdAt ?? now,
    status: 'current',
    sample: names.includes('traceline-sample'),
  };
  await repo.upsertArtifact(art);
  const bumped = !!prev && version > prev.version;
  let newSuspects = 0;
  if (bumped) {
    const created = detectSuspects(await repo.loadGraph(), now, [art.id]);
    await repo.insertSuspects(created);
    newSuspects = created.length;
  }
  return { artifact: art, versionBumped: bumped, newSuspects };
}

/** Record a verification result against the CURRENT versions of everything it verifies. */
export async function recordResult(verId: string, result: 'pass' | 'fail', by: string, now = new Date().toISOString()) {
  const g = await repo.loadGraph();
  const ver = g.get(verId);
  if (!ver || ver.kind !== 'VER') throw new Error('Only verification items can record a test result.');
  const against: Record<string, number> = {};
  for (const e of g.upstreamEdges(verId, 'verifies')) {
    const target = g.get(e.toId)!;
    against[target.key] = target.version;
    await repo.upsertEdge({ ...e, verifiedAgainstVersion: target.version });
    const open = g.openSuspect(e.id);
    if (open) {
      await repo.saveClearance({
        ...open,
        clearedBy: by,
        clearedAt: now,
        justification: `Re-verified: ${ver.key} recorded "${result}" against ${target.key} version ${target.version}.`,
      });
    }
  }
  await repo.upsertArtifact({ ...ver, result, resultAgainstVersion: Object.values(against)[0], contentHash: (ver as StoredArtifact).contentHash });
  await repo.addEvidence({
    artifactId: verId,
    kind: 'test-result',
    result,
    at: now,
    ref: ver.key,
    againstVersion: Object.values(against)[0],
    recordedBy: by,
  });
  if (ver.source === 'jira') {
    await jira(
      route`/rest/api/3/issue/${ver.sourceId}/properties/traceline`,
      { method: 'PUT', body: JSON.stringify({ result, resultAgainst: against, sample: ver.sample || undefined }) },
      'Save test result',
    );
  }
  return against;
}
