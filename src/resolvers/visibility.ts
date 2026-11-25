import { TraceGraph } from '../domain/graph';
import { confluence, jira, route } from '../sync/atlassian';

/**
 * Permission awareness: Traceline's graph is stored app-wide, but every answer
 * given to a person (panel, cockpit, Rovo, MCP) is filtered to the Jira issues
 * and Confluence pages that person can see. Fails closed.
 */
export async function visibleIds(graph: TraceGraph): Promise<Set<string>> {
  const all = [...graph.artifacts.values()];
  const visible = new Set<string>();
  for (const a of all) if (a.source === 'import') visible.add(a.id);

  const jiraArts = all.filter((a) => a.source === 'jira');
  for (let i = 0; i < jiraArts.length; i += 100) {
    const chunk = jiraArts.slice(i, i + 100);
    const res = await jira<{ issues: { id: string }[] }>(
      route`/rest/api/3/search/jql`,
      {
        method: 'POST',
        asUser: true,
        body: JSON.stringify({ jql: `id in (${chunk.map((a) => a.sourceId).join(',')})`, fields: ['id'], maxResults: 100 }),
      },
      'Check issue visibility',
    );
    for (const iss of res.issues ?? []) visible.add(`jira:${iss.id}`);
  }

  const pages = all.filter((a) => a.source === 'confluence');
  for (let i = 0; i < pages.length; i += 50) {
    const chunk = pages.slice(i, i + 50);
    const cql = `id in (${chunk.map((a) => a.sourceId).join(',')})`;
    const res = await confluence<{ results: { content?: { id: string }; id?: string }[] }>(
      route`/wiki/rest/api/search?cql=${cql}&limit=50`,
      { asUser: true },
      'Check page visibility',
    ).catch(() => ({ results: [] }));
    for (const r of res.results) {
      const id = r.content?.id ?? r.id;
      if (id) visible.add(`confluence:${id}`);
    }
  }
  return visible;
}

/**
 * Gaps and gates are computed on the full graph (hiding an artifact must not
 * invent a gap); answers are then redacted to what the person can see.
 */
export function redactor(visible: Set<string>) {
  let hidden = 0;
  return {
    keep<T extends { artifactId?: string; id?: string }>(items: T[]): T[] {
      const out = items.filter((x) => {
        const id = x.artifactId ?? x.id;
        return !id || visible.has(id);
      });
      hidden += items.length - out.length;
      return out;
    },
    get hidden() {
      return hidden;
    },
    note() {
      return hidden ? `${hidden} item${hidden === 1 ? '' : 's'} you do not have permission to view ${hidden === 1 ? 'is' : 'are'} not listed.` : undefined;
    },
  };
}
