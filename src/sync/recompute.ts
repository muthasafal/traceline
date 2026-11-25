import { detectSuspects } from '../domain/suspect';
import { getSettings, setState } from '../storage/settings';
import { confluence, jira, route } from './atlassian';
import { repo, syncIssue, syncPage } from './sync';

/** Iterate JQL results with the enhanced search endpoint. */
export async function* searchIssues(jql: string, fields = 'summary'): AsyncGenerator<{ id: string; key: string }> {
  let nextPageToken: string | undefined;
  do {
    const page = await jira<{ issues: { id: string; key: string }[]; nextPageToken?: string; isLast?: boolean }>(
      route`/rest/api/3/search/jql`,
      { method: 'POST', body: JSON.stringify({ jql, fields: fields.split(','), maxResults: 100, nextPageToken }) },
      'Search issues',
    );
    for (const i of page.issues ?? []) yield i;
    nextPageToken = page.isLast === false || page.nextPageToken ? page.nextPageToken : undefined;
  } while (nextPageToken);
}

/** JQL that finds every issue Traceline tracks, using only issue types that exist on this site. */
export async function trackedJql(): Promise<string> {
  const s = await getSettings();
  const labels = Object.values(s.kindLabels).filter(Boolean).map((l) => `"${l}"`);
  const siteTypes = new Set(
    (await jira<{ name: string }[]>(route`/rest/api/3/issuetype`, {}, 'List issue types')).map((t) => t.name.toLowerCase()),
  );
  const types = Object.entries(s.issueTypes)
    .filter(([k]) => k !== 'IMP') // stories are tracked through their links, not wholesale
    .flatMap(([, names]) => names ?? [])
    .filter((n) => siteTypes.has(n.toLowerCase()))
    .map((n) => `"${n}"`);
  const parts = [`labels in (${labels.join(', ')})`];
  if (types.length) parts.push(`issuetype in (${types.join(', ')})`);
  let jql = `(${parts.join(' OR ')})`;
  if (s.projects.length) jql = `project in (${s.projects.map((p) => `"${p}"`).join(', ')}) AND ${jql}`;
  return jql;
}

export async function* searchPages(cql: string): AsyncGenerator<{ id: string }> {
  let start = 0;
  for (;;) {
    const res = await confluence<{ results: { content?: { id: string }; id?: string }[]; size: number; totalSize?: number }>(
      route`/wiki/rest/api/search?cql=${cql}&limit=50&start=${start}`,
      {},
      'Search pages',
    );
    for (const r of res.results) {
      const id = r.content?.id ?? r.id;
      if (id) yield { id };
    }
    if (res.results.length < 50) return;
    start += 50;
  }
}

/**
 * Full recompute: re-sync every tracked issue and page, drop artifacts that no
 * longer exist, then detect suspects across the whole graph. Used nightly and
 * after the sample loader.
 */
export async function fullRecompute(deadlineMs = Date.now() + 800_000) {
  const s = await getSettings();
  const now = new Date().toISOString();
  const seen = new Set<string>();
  let issues = 0;
  let pages = 0;

  for await (const i of searchIssues(await trackedJql())) {
    if (Date.now() > deadlineMs) break;
    const r = await syncIssue(i.id, now);
    if (r.artifact) seen.add(r.artifact.id);
    issues++;
  }
  const labels = Object.values(s.pageLabels).filter(Boolean).map((l) => `"${l}"`);
  if (labels.length) {
    for await (const p of searchPages(`type = page AND label in (${labels.join(', ')})`)) {
      if (Date.now() > deadlineMs) break;
      const r = await syncPage(p.id, now).catch(() => undefined);
      if (r?.artifact) seen.add(r.artifact.id);
      pages++;
    }
  }
  const timedOut = Date.now() > deadlineMs;
  let removed = 0;
  const g = await repo.loadGraph();
  if (!timedOut) {
    for (const a of g.artifacts.values()) {
      // Implementation items are discovered through links, so keep the linked ones.
      if (a.source === 'import' || seen.has(a.id)) continue;
      if (a.kind === 'IMP' && (g.upstreamEdges(a.id).length || g.downstreamEdges(a.id).length)) continue;
      await repo.deleteArtifact(a.id);
      removed++;
    }
  }
  const suspects = detectSuspects(await repo.loadGraph(), now);
  await repo.insertSuspects(suspects);
  const summary = { at: now, issues, pages, removed, newSuspects: suspects.length, complete: !timedOut };
  await setState('lastRecompute', summary);
  return summary;
}
