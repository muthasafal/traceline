import Resolver from '@forge/resolver';
import { evaluate } from '../domain/gaps';
import { getPack } from '../domain/packs';
import { traceChain } from '../domain/status';
import { clearSuspect, reverify } from '../domain/suspect';
import { ArtifactKind, KIND_LABEL } from '../domain/types';
import { ensureSchema } from '../storage/forgeSql';
import { getSettings } from '../storage/settings';
import { jira, route } from '../sync/atlassian';
import { jiraId } from '../sync/mapping';
import { recordResult, repo, syncIssue } from '../sync/sync';
import { schedulePublish } from '../sync/publish';

const resolver = new Resolver();

type Ctx = { accountId?: string; extension?: { issue?: { key?: string; id?: string } } };

/** The panel only ever shows data for an issue the current user can see. */
async function assertCanView(issueKey: string) {
  await jira(route`/rest/api/3/issue/${issueKey}?fields=summary`, { asUser: true }, 'Check access');
}

async function assertCanEdit(issueKey: string) {
  const res = await jira<{ permissions: Record<string, { havePermission: boolean }> }>(
    route`/rest/api/3/mypermissions?issueKey=${issueKey}&permissions=EDIT_ISSUES`,
    { asUser: true },
    'Check permissions',
  );
  if (!res.permissions?.EDIT_ISSUES?.havePermission) throw new Error('You need permission to edit this issue to do that.');
}

function issueKeyOf(payload: { issueKey?: string }, context: Ctx): string {
  const key = payload.issueKey ?? context.extension?.issue?.key;
  if (!key) throw new Error('No issue in context.');
  return key;
}

async function view(issueKey: string, refresh: boolean) {
  await ensureSchema();
  const settings = await getSettings();
  const pack = getPack(settings.pack);
  let g = await repo.loadGraph();
  let root = g.getByKey(issueKey);
  if (!root || refresh) {
    await syncIssue(issueKey);
    g = await repo.loadGraph();
    root = g.getByKey(issueKey);
  }
  if (!root) {
    return {
      tracked: false as const,
      issueKey,
      kinds: (['SRS', 'HAZ', 'RC', 'VER', 'IMP'] as ArtifactKind[]).map((k) => ({ kind: k, label: KIND_LABEL[k] })),
    };
  }
  const chain = traceChain(g, root.id)!;
  const gaps = evaluate(g, pack, { scope: new Set([root.id]), defaultLevel: settings.defaultLevel }).gaps;
  const suspects = [...g.upstreamEdges(root.id), ...g.downstreamEdges(root.id)]
    .map((e) => ({ e, s: g.openSuspect(e.id) }))
    .filter((x) => x.s)
    .map(({ e, s }) => ({
      edgeId: e.id,
      rel: e.rel,
      fromKey: g.get(e.fromId)!.key,
      toKey: g.get(e.toId)!.key,
      since: s!.since,
      reason: s!.reason,
      canReverifyByTest: e.rel === 'verifies',
    }));
  const evidence = root.kind === 'VER' ? await repo.evidenceFor(root.id) : [];
  return {
    tracked: true as const,
    issueKey,
    standard: pack.name,
    levelName: pack.levelName,
    level: root.safetyClass ?? settings.defaultLevel,
    kind: root.kind,
    kindLabel: KIND_LABEL[root.kind],
    version: root.version,
    result: root.result,
    sample: !!root.sample,
    chain,
    gaps,
    suspects,
    evidence,
  };
}

resolver.define('getTrace', async ({ payload, context }) => {
  const key = issueKeyOf(payload as { issueKey?: string }, context as Ctx);
  await assertCanView(key);
  return view(key, false);
});

resolver.define('refresh', async ({ payload, context }) => {
  const key = issueKeyOf(payload as { issueKey?: string }, context as Ctx);
  await assertCanView(key);
  return view(key, true);
});

resolver.define('recordResult', async ({ payload, context }) => {
  await schedulePublish().catch(() => undefined);
  const p = payload as { issueKey?: string; result: 'pass' | 'fail' };
  const key = issueKeyOf(p, context as Ctx);
  await assertCanEdit(key);
  if (p.result !== 'pass' && p.result !== 'fail') throw new Error('Result must be pass or fail.');
  const g = await repo.loadGraph();
  const a = g.getByKey(key);
  if (!a) throw new Error(`${key} is not tracked by Traceline yet.`);
  await recordResult(a.id, p.result, (context as Ctx).accountId ?? 'unknown');
  return view(key, false);
});

resolver.define('reverifyLink', async ({ payload, context }) => {
  await schedulePublish().catch(() => undefined);
  const p = payload as { issueKey?: string; edgeId: string };
  const key = issueKeyOf(p, context as Ctx);
  await assertCanEdit(key);
  const g = await repo.loadGraph();
  const edge = g.edges.get(p.edgeId);
  if (!edge) throw new Error('That link no longer exists.');
  if (edge.rel === 'verifies') throw new Error('Verification links are re-verified by recording a new test result.');
  const { edge: updated, cleared } = reverify(g, edge, (context as Ctx).accountId ?? 'unknown', new Date().toISOString());
  await repo.upsertEdge(updated);
  if (cleared) await repo.saveClearance(cleared);
  return view(key, false);
});

resolver.define('clearSuspect', async ({ payload, context }) => {
  await schedulePublish().catch(() => undefined);
  const p = payload as { issueKey?: string; edgeId: string; justification: string };
  const key = issueKeyOf(p, context as Ctx);
  await assertCanEdit(key);
  const g = await repo.loadGraph();
  const s = g.openSuspect(p.edgeId);
  if (!s) return view(key, false);
  const cleared = clearSuspect(s, (context as Ctx).accountId ?? 'unknown', p.justification, new Date().toISOString());
  await repo.saveClearance(cleared);
  // The link is accepted as reviewed at the upstream's current version.
  const edge = g.edges.get(p.edgeId)!;
  await repo.upsertEdge({ ...edge, verifiedAgainstVersion: g.get(edge.toId)!.version });
  return view(key, false);
});

resolver.define('trackAs', async ({ payload, context }) => {
  await schedulePublish().catch(() => undefined);
  const p = payload as { issueKey?: string; kind: ArtifactKind };
  const key = issueKeyOf(p, context as Ctx);
  await assertCanEdit(key);
  const s = await getSettings();
  const label = s.kindLabels[p.kind];
  if (!label) throw new Error('Unknown artifact type.');
  await jira(route`/rest/api/3/issue/${key}`, { method: 'PUT', body: JSON.stringify({ update: { labels: [{ add: label }] } }) }, 'Add label');
  return view(key, true);
});

resolver.define('setLevel', async ({ payload, context }) => {
  await schedulePublish().catch(() => undefined);
  const p = payload as { issueKey?: string; level: string };
  const key = issueKeyOf(p, context as Ctx);
  await assertCanEdit(key);
  const s = await getSettings();
  if (!getPack(s.pack).levels.includes(p.level)) throw new Error('Unknown level for this standard.');
  const current = await jira<{ value?: Record<string, unknown> }>(route`/rest/api/3/issue/${key}/properties/traceline`, {}, 'Read property').catch(
    () => ({ value: {} }),
  );
  await jira(
    route`/rest/api/3/issue/${key}/properties/traceline`,
    { method: 'PUT', body: JSON.stringify({ ...(current?.value ?? {}), safetyClass: p.level }) },
    'Save level',
  );
  return view(key, true);
});

export const panelHandler = resolver.getDefinitions();

export { jiraId };
