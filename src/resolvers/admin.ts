import { Queue } from '@forge/events';
import Resolver from '@forge/resolver';
import { evaluate } from '../domain/gaps';
import { evaluateGate } from '../domain/gate';
import { getPack, PACKS } from '../domain/packs';
import { SAMPLE_RELEASE } from '../domain/sample';
import { ensureSchema } from '../storage/forgeSql';
import { getSettings, getState, saveSettings, setState, Settings } from '../storage/settings';
import { jira, route } from '../sync/atlassian';
import { getSampleState, SAMPLE_PROJECT_KEY } from '../sync/seed';
import { repo } from '../sync/sync';
import { chainFor, cockpit, snapshot } from './reports';
import { whoSignsOff } from './actions';

export const jobs = new Queue({ key: 'traceline-jobs' });

const resolver = new Resolver();

async function assertAdmin() {
  const res = await jira<{ permissions: Record<string, { havePermission: boolean }> }>(
    route`/rest/api/3/mypermissions?permissions=ADMINISTER`,
    { asUser: true },
    'Check admin',
  );
  if (!res.permissions?.ADMINISTER?.havePermission) throw new Error('Only Jira administrators can change Traceline settings or sample data.');
}

async function status() {
  await ensureSchema();
  const settings = await getSettings();
  const pack = getPack(settings.pack);
  const g = await repo.loadGraph();
  const ev = evaluate(g, pack, { defaultLevel: settings.defaultLevel });
  const gate = evaluateGate(g, pack, SAMPLE_RELEASE, new Date().toISOString(), settings.defaultLevel);
  return {
    settings,
    packs: Object.values(PACKS).map((p) => ({ id: p.id, name: p.name, levels: p.levels, levelName: p.levelName })),
    sample: await getSampleState(),
    sampleProjectKey: SAMPLE_PROJECT_KEY,
    counts: await repo.counts(),
    gaps: ev.gaps.length,
    blocking: ev.gaps.filter((x) => x.blocking).length,
    openSuspects: g.openSuspects().length,
    sampleGate: g.artifacts.size ? { summary: gate.summary, green: gate.green } : undefined,
    lastRecompute: await getState('lastRecompute'),
  };
}

resolver.define('getStatus', async () => status());

resolver.define('loadSample', async ({ context }) => {
  await assertAdmin();
  const st = await getSampleState();
  if (st.status === 'running' || st.status === 'removing') return status();
  const info = await jira<{ baseUrl: string }>(route`/rest/api/3/serverInfo`, {}, 'Read site');
  await jobs.push({ body: { type: 'seed', accountId: (context as { accountId: string }).accountId, siteUrl: info.baseUrl } });
  await setState('sample', { ...st, status: 'running', step: 'Queued', progress: 1, message: undefined });
  return status();
});

resolver.define('removeSample', async () => {
  await assertAdmin();
  const st = await getSampleState();
  if (st.status === 'running' || st.status === 'removing') return status();
  await jobs.push({ body: { type: 'remove-sample' } });
  await setState('sample', { ...st, status: 'removing', step: 'Queued', progress: 1 });
  return status();
});

resolver.define('recompute', async () => {
  await assertAdmin();
  await jobs.push({ body: { type: 'recompute' } });
  return status();
});

resolver.define('saveSettings', async ({ payload }) => {
  await assertAdmin();
  const p = payload as Partial<Settings>;
  const pack = getPack(p.pack);
  const patch: Partial<Settings> = {};
  if (p.pack) patch.pack = pack.id;
  if (p.defaultLevel && pack.levels.includes(p.defaultLevel)) patch.defaultLevel = p.defaultLevel;
  if (Array.isArray(p.validatorLevels)) patch.validatorLevels = p.validatorLevels.filter((l) => pack.levels.includes(l));
  if (typeof p.validatorEnabled === 'boolean') patch.validatorEnabled = p.validatorEnabled;
  if (Array.isArray(p.projects)) patch.projects = p.projects.map((x) => String(x).trim().toUpperCase()).filter(Boolean);
  if (p.pack && !p.defaultLevel) patch.defaultLevel = pack.defaultLevel;
  await saveSettings(patch);
  return status();
});

resolver.define('getCockpit', async ({ payload }) => {
  if (!(await getState('lastPublish'))) await jobs.push({ body: { type: 'publish' } });
  return cockpit((payload as { release?: string }).release);
});

resolver.define('takeSnapshot', async ({ payload, context }) =>
  snapshot((payload as { release: string }).release, (context as { accountId?: string }).accountId),
);

resolver.define('getOwners', async ({ payload, context }) =>
  whoSignsOff({ artifactKey: String((payload as { key?: string }).key ?? '') }, context),
);

resolver.define('saveTwgQueryKey', async ({ payload }) => {
  await assertAdmin();
  const key = String((payload as { key?: string }).key ?? '').trim();
  if (key && !/^[0-9a-f-]{36}$/i.test(key)) throw new Error('A Teamwork Graph query key is a UUID.');
  await saveSettings({ twgOwnerQueryKey: key || undefined });
  return status();
});

resolver.define('getChain', async ({ payload }) => chainFor(String((payload as { key?: string }).key ?? '')));

export const adminHandler = resolver.getDefinitions();
