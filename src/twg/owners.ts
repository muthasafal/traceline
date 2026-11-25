import api from '@forge/api';
import { TraceGraph } from '../domain/graph';
import { Artifact, KIND_LABEL } from '../domain/types';
import { getSettings } from '../storage/settings';
import { confluence, jira, route } from '../sync/atlassian';

/**
 * "Who signs off on this requirement?" via the Teamwork Graph, with a REST
 * fallback. Teamwork Graph returns EMPTY (not an error) when a scope is
 * missing, so an empty graph answer for an item REST shows has an owner is
 * treated as "suspiciously empty": we fall back and return a setup hint.
 */

export interface Person {
  accountId: string;
  name?: string;
  role: string;
  via: string; // artifact key the role comes from
  teams?: string[];
}

export interface OwnerAnswer {
  source: 'teamwork-graph' | 'rest-fallback' | 'mixed';
  people: Person[];
  hint?: string;
}

const PAGE_OWNERS = `query traceline_pageOwners($id: ID!) {
  confluencePageOwners(id: $id, first: 10) { edges { node { __typename ... on AtlassianUser { id } } } }
  confluencePageContributors(id: $id, first: 10) { edges { node { __typename ... on AtlassianUser { id } } } }
}`;

const PERSISTED = `query traceline_issueOwner($queryKey: String!, $queryParams: CypherRequestParams) {
  customQuery(queryKey: $queryKey, queryParams: $queryParams, first: 25) {
    edges { node { columns { key value { __typename ... on CypherQueryResultNode { id } ... on CypherQueryResultListNode { nodes { id } } } } } }
  }
}`;

/** The Cypher registered for the persisted query (see docs/TEAMWORK_GRAPH.md). */
export const OWNER_CYPHER = `MATCH (item:JiraWorkItem {ari: $itemAri})<-[:atlassian_user_assigned_jira_work_item]-(user:AtlassianUser)
OPTIONAL MATCH (user)-[:atlassian_user_is_in_atlassian_team]->(team:AtlassianTeam)
RETURN user, collect(distinct team) as teams`;

const accountIdFromAri = (ari: string) => ari.split('/').pop() ?? ari;

type Gql = { data?: Record<string, { edges?: ({ node?: Record<string, unknown> | null } | null)[] | null } | null> | null; errors?: { message: string; extensions?: { code?: string } }[] };

async function twg(query: string, variables: Record<string, unknown>): Promise<Gql | undefined> {
  try {
    const res = await api.asUser().requestTeamworkGraph(query, variables);
    return (await res.json()) as Gql;
  } catch {
    return undefined;
  }
}

async function names(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const id of [...new Set(ids)].slice(0, 20)) {
    try {
      const u = await jira<{ displayName?: string }>(route`/rest/api/3/user?accountId=${id}`, { asUser: true }, 'Read user');
      if (u?.displayName) out.set(id, u.displayName);
    } catch {
      /* hidden profile */
    }
  }
  return out;
}

async function pageOwnersFromGraph(cloudId: string, page: Artifact): Promise<Person[] | undefined> {
  const ari = `ari:cloud:confluence:${cloudId}:page/${page.sourceId}`;
  const r = await twg(PAGE_OWNERS, { id: ari });
  if (!r?.data) return undefined;
  const pick = (field: string, role: string) =>
    (r.data?.[field]?.edges ?? [])
      .map((e) => e?.node?.id as string | undefined)
      .filter((x): x is string => !!x)
      .map((id) => ({ accountId: accountIdFromAri(id), role, via: page.key }));
  return [...pick('confluencePageOwners', 'Page owner'), ...pick('confluencePageContributors', 'Contributor')];
}

async function pageOwnersFromRest(page: Artifact): Promise<Person[]> {
  const p = await confluence<{ ownerId?: string; authorId?: string }>(route`/wiki/api/v2/pages/${page.sourceId}`, { asUser: true }, 'Read page').catch(
    () => undefined,
  );
  const out: Person[] = [];
  if (p?.ownerId) out.push({ accountId: p.ownerId, role: 'Page owner', via: page.key });
  if (p?.authorId && p.authorId !== p.ownerId) out.push({ accountId: p.authorId, role: 'Author', via: page.key });
  return out;
}

async function issueOwnersFromGraph(cloudId: string, issue: Artifact, queryKey: string): Promise<Person[] | undefined> {
  const itemAri = `ari:cloud:jira:${cloudId}:issue/${issue.sourceId}`;
  const r = (await twg(PERSISTED, { queryKey, queryParams: { itemAri } })) as
    | { data?: { customQuery?: { edges?: ({ node?: { columns?: { key: string; value?: { id?: string; nodes?: { id: string }[] } | null }[] } | null } | null)[] } | null } | null }
    | undefined;
  const edges = r?.data?.customQuery?.edges;
  if (!edges) return undefined;
  const people: Person[] = [];
  for (const e of edges) {
    const cols = e?.node?.columns ?? [];
    const user = cols.find((c) => c.key === 'user')?.value?.id;
    const teams = (cols.find((c) => c.key === 'teams')?.value?.nodes ?? []).filter(Boolean).map((t) => t.id);
    if (user) people.push({ accountId: accountIdFromAri(user), role: 'Assignee', via: issue.key, teams });
  }
  return people;
}

async function issueOwnersFromRest(issue: Artifact): Promise<Person[]> {
  const i = await jira<{ fields: { assignee?: { accountId: string; displayName?: string }; reporter?: { accountId: string; displayName?: string } } }>(
    route`/rest/api/3/issue/${issue.key}?fields=assignee,reporter`,
    { asUser: true },
    'Read issue people',
  ).catch(() => undefined);
  const out: Person[] = [];
  if (i?.fields.assignee) out.push({ accountId: i.fields.assignee.accountId, name: i.fields.assignee.displayName, role: 'Assignee', via: issue.key });
  if (i?.fields.reporter) out.push({ accountId: i.fields.reporter.accountId, name: i.fields.reporter.displayName, role: 'Reporter', via: issue.key });
  return out;
}

/**
 * Owners for an artifact: the artifact itself plus the Confluence pages it
 * traces up to (system requirements and design are typically owned there).
 */
export async function ownersOf(graph: TraceGraph, root: Artifact, cloudId: string): Promise<OwnerAnswer> {
  const settings = await getSettings();
  const pages = [root, ...graph.allUpstream(root.id)].filter((a) => a.source === 'confluence').slice(0, 5);
  const issues = [root].filter((a) => a.source === 'jira');
  const people: Person[] = [];
  let usedGraph = false;
  let usedRest = false;
  let suspicious = false;

  for (const page of pages) {
    const fromGraph = await pageOwnersFromGraph(cloudId, page);
    if (fromGraph && fromGraph.length) {
      people.push(...fromGraph);
      usedGraph = true;
      continue;
    }
    const fromRest = await pageOwnersFromRest(page);
    if (fromRest.length) suspicious ||= fromGraph !== undefined; // graph answered, but with nothing
    people.push(...fromRest);
    usedRest = true;
  }

  for (const issue of issues) {
    const key = settings.twgOwnerQueryKey;
    const fromGraph = key ? await issueOwnersFromGraph(cloudId, issue, key) : undefined;
    if (fromGraph && fromGraph.length) {
      people.push(...fromGraph);
      usedGraph = true;
      continue;
    }
    const fromRest = await issueOwnersFromRest(issue);
    if (key && fromRest.some((p) => p.role === 'Assignee')) suspicious ||= fromGraph !== undefined;
    people.push(...fromRest);
    usedRest = true;
  }

  const nameMap = await names(people.filter((p) => !p.name).map((p) => p.accountId));
  for (const p of people) p.name ??= nameMap.get(p.accountId);

  const hints: string[] = [];
  if (suspicious) {
    hints.push(
      'The Teamwork Graph answered with no people for items that do have owners, which usually means a scope is not granted. Ask a site admin to approve Traceline’s read:graph scopes (page, user, issue, team), then try again.',
    );
  }
  if (!settings.twgOwnerQueryKey && issues.length) {
    hints.push('Issue assignee and team come from REST until the Traceline owner query is registered (see Traceline settings).');
  }
  return {
    source: usedGraph && usedRest ? 'mixed' : usedGraph ? 'teamwork-graph' : 'rest-fallback',
    people: dedupe(people),
    hint: hints.join(' ') || undefined,
  };
}

function dedupe(people: Person[]): Person[] {
  const seen = new Set<string>();
  return people.filter((p) => {
    const k = `${p.accountId}|${p.role}|${p.via}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const describeOwners = (root: Artifact, a: OwnerAnswer) => {
  const signers = a.people.filter((p) => p.role === 'Page owner' || p.role === 'Assignee');
  const who = signers.length ? signers : a.people;
  if (!who.length) return `No owner is recorded for ${root.key} or the pages it traces to.`;
  return `${KIND_LABEL[root.kind]} ${root.key}: ${who.map((p) => `${p.name ?? 'a user'} (${p.role.toLowerCase()} of ${p.via})`).join(', ')}.`;
};
