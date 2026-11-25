import { Relation } from '../domain/types';
import { buildSampleProject, SAMPLE_LABEL, SAMPLE_PROJECT_NAME, SAMPLE_RELEASE, SampleItem } from '../domain/sample';
import { getSettings, getState, saveSettings, setState } from '../storage/settings';
import { confluence, HttpError, jira, route } from './atlassian';
import { remoteLinkGlobalId, textToAdf } from './mapping';
import { fullRecompute, searchIssues } from './recompute';
import { recordResult, repo, syncIssue } from './sync';

/**
 * "Load sample project": creates a clearly labelled SAMPLE Jira project and
 * Confluence space for a fictional infusion pump, then builds the trace graph.
 * Runs in a queue consumer (up to 15 minutes). Progress is kept in KVS.
 */

export const SAMPLE_PROJECT_KEY = 'PUMP';
export const SAMPLE_SPACE_KEY = 'PUMPSAMPLE';

export interface SampleState {
  status: 'idle' | 'running' | 'done' | 'failed' | 'removing';
  step?: string;
  progress?: number; // 0..100
  message?: string;
  projectKey?: string;
  projectCreated?: boolean;
  spaceKey?: string;
  spaceId?: string;
  spaceCreated?: boolean;
  startedAt?: string;
  finishedAt?: string;
  counts?: Record<string, number>;
}

const STATE = 'sample';
const setSample = async (patch: Partial<SampleState>) => {
  const prev = (await getState<SampleState>(STATE)) ?? { status: 'idle' };
  await setState(STATE, { ...prev, ...patch });
};
export const getSampleState = async () => (await getState<SampleState>(STATE)) ?? ({ status: 'idle' } as SampleState);

const LINK_TYPES: { rel: Relation; name: string; outward: string; inward: string }[] = [
  { rel: 'implements', name: 'Implements', outward: 'implements', inward: 'is implemented by' },
  { rel: 'verifies', name: 'Verifies', outward: 'verifies', inward: 'is verified by' },
  { rel: 'mitigates', name: 'Mitigates', outward: 'mitigates', inward: 'is mitigated by' },
  { rel: 'derives', name: 'Derives', outward: 'derives from', inward: 'is source of' },
  { rel: 'designs', name: 'Designs', outward: 'designs', inward: 'is designed by' },
];

const KIND_LABEL_FOR: Record<string, string> = {
  SRS: 'tl-requirement',
  HAZ: 'tl-hazard',
  RC: 'tl-risk-control',
  VER: 'tl-test',
  IMP: 'tl-implementation',
};

export async function ensureLinkTypes(): Promise<void> {
  const existing = await jira<{ issueLinkTypes: { name: string }[] }>(route`/rest/api/3/issueLinkType`, {}, 'List link types');
  const have = new Set(existing.issueLinkTypes.map((t) => t.name.toLowerCase()));
  for (const t of LINK_TYPES) {
    if (have.has(t.name.toLowerCase())) continue;
    await jira(route`/rest/api/3/issueLinkType`, { method: 'POST', body: JSON.stringify({ name: t.name, outward: t.outward, inward: t.inward }) }, `Create link type ${t.name}`);
  }
}

async function ensureProject(leadAccountId: string): Promise<{ id: string; key: string; created: boolean }> {
  try {
    const p = await jira<{ id: string; key: string; name: string }>(route`/rest/api/3/project/${SAMPLE_PROJECT_KEY}`, {}, 'Read project');
    if (p.name !== SAMPLE_PROJECT_NAME) {
      throw new Error(`A project with key ${SAMPLE_PROJECT_KEY} already exists ("${p.name}"). Traceline will not add sample data to it.`);
    }
    return { id: p.id, key: p.key, created: false };
  } catch (e) {
    if (!(e instanceof HttpError && e.status === 404)) throw e;
  }
  const templates = [
    'com.pyxis.greenhopper.jira:gh-simplified-kanban-classic',
    'com.pyxis.greenhopper.jira:gh-simplified-scrum-classic',
    'com.atlassian.jira-core-project-templates:jira-core-simplified-task-tracking',
  ];
  let lastErr: unknown;
  for (const projectTemplateKey of templates) {
    try {
      const p = await jira<{ id: number; key: string }>(
        route`/rest/api/3/project`,
        {
          method: 'POST',
          body: JSON.stringify({
            key: SAMPLE_PROJECT_KEY,
            name: SAMPLE_PROJECT_NAME,
            description: 'SAMPLE DATA created by Traceline. A fictional infusion pump; not a real device. Safe to delete.',
            leadAccountId,
            projectTypeKey: projectTemplateKey.includes('greenhopper') ? 'software' : 'business',
            projectTemplateKey,
            assigneeType: 'UNASSIGNED',
          }),
        },
        'Create sample project',
      );
      return { id: String(p.id), key: p.key, created: true };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function issueTypeIds(projectKey: string): Promise<{ task: string; story: string }> {
  const res = await jira<{ issueTypes?: { id: string; name: string; subtask?: boolean }[]; values?: { id: string; name: string; subtask?: boolean }[] }>(
    route`/rest/api/3/issue/createmeta/${projectKey}/issuetypes?maxResults=50`,
    {},
    'Read issue types',
  );
  const types = (res.issueTypes ?? res.values ?? []).filter((t) => !t.subtask);
  const find = (n: string) => types.find((t) => t.name.toLowerCase() === n)?.id;
  const task = find('task') ?? types[0]?.id;
  if (!task) throw new Error(`Project ${projectKey} has no usable issue types.`);
  return { task, story: find('story') ?? task };
}

async function ensureVersion(projectId: string): Promise<void> {
  const versions = await jira<{ name: string }[]>(route`/rest/api/3/project/${projectId}/versions`, {}, 'List versions');
  if (versions.some((v) => v.name === SAMPLE_RELEASE)) return;
  await jira(route`/rest/api/3/version`, { method: 'POST', body: JSON.stringify({ name: SAMPLE_RELEASE, projectId: Number(projectId) }) }, 'Create version');
}

async function ensureSpace(): Promise<{ id: string; key: string; created: boolean }> {
  const found = await confluence<{ results: { id: string; key: string }[] }>(route`/wiki/api/v2/spaces?keys=${SAMPLE_SPACE_KEY}`, {}, 'Find space');
  if (found.results[0]) return { ...found.results[0], created: false };
  const s = await confluence<{ id: number | string; key: string }>(
    route`/wiki/rest/api/space`,
    {
      method: 'POST',
      body: JSON.stringify({
        key: SAMPLE_SPACE_KEY,
        name: 'Sample: Infusion pump DHF',
        description: { plain: { value: 'SAMPLE DATA created by Traceline. Fictional device; safe to delete.', representation: 'plain' } },
      }),
    },
    'Create sample space',
  );
  return { id: String(s.id), key: s.key, created: true };
}

async function createPage(spaceId: string, title: string, html: string, labels: string[], parentId?: string): Promise<string> {
  const page = await confluence<{ id: string }>(
    route`/wiki/api/v2/pages`,
    { method: 'POST', body: JSON.stringify({ spaceId, status: 'current', title, parentId, body: { representation: 'storage', value: html } }) },
    `Create page ${title}`,
  );
  await confluence(
    route`/wiki/rest/api/content/${page.id}/label`,
    { method: 'POST', body: JSON.stringify(labels.map((name) => ({ prefix: 'global', name }))) },
    'Label page',
  );
  return page.id;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const SAMPLE_BANNER =
  '<ac:structured-macro ac:name="info"><ac:rich-text-body><p><strong>Sample data.</strong> Created by Traceline to demonstrate traceability for a fictional infusion pump. It is not a real device and is not design input.</p></ac:rich-text-body></ac:structured-macro>';

function summaryOf(it: SampleItem) {
  return `[${it.ref}] ${it.title}`.slice(0, 250);
}

function descriptionOf(it: SampleItem) {
  const lines = ['SAMPLE DATA (Traceline demo, fictional device).', it.body];
  if (it.severity) lines.push(`Severity: ${it.severity}. Probability: ${it.probability}.`);
  return textToAdf(lines.join('\n\n'));
}

/** Create a Jira issue link reading "<down> <rel verb> <up>", e.g. "VER verifies SRS". */
async function linkIssues(downKey: string, rel: Relation, upKey: string) {
  const s = await getSettings();
  // In POST /issueLink, `inwardIssue` takes the link type's OUTWARD verb: "<inwardIssue> verifies <outwardIssue>".
  await jira(
    route`/rest/api/3/issueLink`,
    { method: 'POST', body: JSON.stringify({ type: { name: s.linkTypes[rel] }, inwardIssue: { key: downKey }, outwardIssue: { key: upKey } }) },
    `Link ${downKey} ${rel} ${upKey}`,
  );
}

async function remoteLink(issueKey: string, rel: Relation, pageIdStr: string, dir: 'up' | 'down', title: string, url: string) {
  await jira(
    route`/rest/api/3/issue/${issueKey}/remotelink`,
    {
      method: 'POST',
      body: JSON.stringify({
        globalId: remoteLinkGlobalId(rel, pageIdStr, dir),
        relationship: dir === 'up' ? (rel === 'derives' ? 'derives from' : rel) : `is ${rel === 'designs' ? 'designed' : rel} by`,
        object: { url, title, icon: { url16x16: 'https://www.atlassian.com/favicon.ico', title: 'Confluence' } },
      }),
    },
    'Create remote link',
  );
}

export async function runSampleSeed(leadAccountId: string, siteUrl: string) {
  const started = new Date().toISOString();
  await setSample({ status: 'running', step: 'Checking link types', progress: 2, startedAt: started, message: undefined });
  try {
    await ensureLinkTypes();
    await saveSettings({ linkTypes: Object.fromEntries(LINK_TYPES.map((t) => [t.rel, t.name])) as Record<Relation, string> });

    await setSample({ step: 'Creating the sample Jira project', progress: 5 });
    const project = await ensureProject(leadAccountId);
    await setSample({ projectKey: project.key, projectCreated: project.created });
    await ensureVersion(project.id);
    const types = await issueTypeIds(project.key);

    await setSample({ step: 'Creating the sample Confluence space', progress: 10 });
    const space = await ensureSpace();
    await setSample({ spaceKey: space.key, spaceId: space.id, spaceCreated: space.created });

    const sample = buildSampleProject();
    const pageItems = sample.items.filter((i) => i.kind === 'SYS' || i.kind === 'DES');
    const issueItems = sample.items.filter((i) => i.kind !== 'SYS' && i.kind !== 'DES');

    // Confluence pages: one overview, then SYS and DES pages under it.
    await setSample({ step: 'Writing system requirements and design pages', progress: 15 });
    const overviewId = await createPage(
      space.id,
      'Sample: Infusion pump controller v2.3 - Design History File',
      `${SAMPLE_BANNER}<p>System requirements (label <code>sys-req</code>) and design items (label <code>design</code>) for the sample project. Add the Traceline matrix macro here to see live traceability.</p>`,
      [SAMPLE_LABEL],
    );
    const pageIds = new Map<string, string>();
    for (const it of pageItems) {
      const label = it.kind === 'SYS' ? 'sys-req' : 'design';
      const id = await createPage(
        space.id,
        `${it.ref}: ${it.title}`,
        `${SAMPLE_BANNER}<p>${esc(it.body)}</p><p>Software safety class: ${it.safetyClass ?? 'C'}</p>`,
        [label, SAMPLE_LABEL, `class-${(it.safetyClass ?? 'C').toLowerCase()}`],
        overviewId,
      );
      pageIds.set(it.ref, id);
    }

    // Jira issues in bulk (50 per call).
    await setSample({ step: 'Creating requirements, hazards, risk controls, stories and tests', progress: 35 });
    const issueKeys = new Map<string, string>();
    for (let i = 0; i < issueItems.length; i += 50) {
      const batch = issueItems.slice(i, i + 50);
      const res = await jira<{ issues: { key: string }[]; errors: unknown[] }>(
        route`/rest/api/3/issue/bulk`,
        {
          method: 'POST',
          body: JSON.stringify({
            issueUpdates: batch.map((it) => ({
              fields: {
                project: { key: project.key },
                summary: summaryOf(it),
                issuetype: { id: it.kind === 'IMP' ? types.story : types.task },
                labels: [KIND_LABEL_FOR[it.kind], SAMPLE_LABEL, ...(it.safetyClass ? [`class-${it.safetyClass.toLowerCase()}`] : [])],
                fixVersions: [{ name: SAMPLE_RELEASE }],
                description: descriptionOf(it),
              },
              properties: [{ key: 'traceline', value: { sample: true, ...(it.paths ? { paths: it.paths } : {}) } }],
            })),
          }),
        },
        'Create sample issues',
      );
      if (res.errors?.length) throw new Error(`Jira rejected some sample issues: ${JSON.stringify(res.errors).slice(0, 400)}`);
      res.issues.forEach((iss, j) => issueKeys.set(batch[j].ref, iss.key));
      await setSample({ progress: 35 + Math.round((20 * (i + batch.length)) / issueItems.length) });
    }

    // Links.
    await setSample({ step: 'Linking the trace chain', progress: 55 });
    const wiki = `${siteUrl.replace(/\/$/, '')}/wiki/spaces/${space.key}/pages/`;
    let n = 0;
    for (const l of sample.links) {
      const fromIssue = issueKeys.get(l.from);
      const toIssue = issueKeys.get(l.to);
      if (fromIssue && toIssue) await linkIssues(fromIssue, l.rel, toIssue);
      else if (fromIssue && pageIds.has(l.to)) {
        const pid = pageIds.get(l.to)!;
        await remoteLink(fromIssue, l.rel, pid, 'up', l.to, wiki + pid);
      } else if (toIssue && pageIds.has(l.from)) {
        const pid = pageIds.get(l.from)!;
        await remoteLink(toIssue, l.rel, pid, 'down', l.from, wiki + pid);
      }
      if (++n % 20 === 0) await setSample({ progress: 55 + Math.round((25 * n) / sample.links.length) });
    }

    // Build the graph, then record test results against current versions.
    await setSample({ step: 'Building the trace graph', progress: 82 });
    await saveSettings({ pack: 'iec62304', defaultLevel: 'C' });
    for (const key of issueKeys.values()) await syncIssue(key);
    await setSample({ step: 'Recording test results', progress: 90 });
    const g = await repo.loadGraph();
    for (const it of sample.items.filter((x) => x.kind === 'VER')) {
      const a = g.getByKey(issueKeys.get(it.ref)!);
      if (a && it.result && it.result !== 'not-run') await recordResult(a.id, it.result, 'traceline-sample');
    }

    // The deliberate suspect link: edit a verified requirement as an engineer would.
    await setSample({ step: 'Editing one verified requirement to create a suspect link', progress: 96 });
    const target = sample.items.find((x) => x.ref === sample.suspectTarget)!;
    const targetKey = issueKeys.get(target.ref)!;
    await jira(
      route`/rest/api/3/issue/${targetKey}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          fields: {
            summary: `[${target.ref}] Occlusion pressure threshold shall be configurable in four levels`,
            description: textToAdf(
              'SAMPLE DATA (Traceline demo, fictional device).\n\nChanged from three to four levels after clinical feedback. The existing test was written for three levels.',
            ),
          },
        }),
      },
      'Edit sample requirement',
    );
    await syncIssue(targetKey);

    const counts = await repo.counts();
    await setSample({ status: 'done', step: 'Done', progress: 100, finishedAt: new Date().toISOString(), counts: counts as Record<string, number> });
  } catch (e) {
    await setSample({ status: 'failed', message: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

export async function runSampleRemove() {
  const st = await getSampleState();
  await setSample({ status: 'removing', step: 'Deleting sample issues', progress: 5, message: undefined });
  try {
    // Only items carrying the sample label are deleted.
    const ids: string[] = [];
    for await (const i of searchIssues(`labels = "${SAMPLE_LABEL}"`)) ids.push(i.id);
    let n = 0;
    for (const id of ids) {
      await jira(route`/rest/api/3/issue/${id}?deleteSubtasks=true`, { method: 'DELETE' }, 'Delete sample issue').catch(() => undefined);
      if (++n % 20 === 0) await setSample({ progress: 5 + Math.round((60 * n) / ids.length) });
    }
    if (st.projectCreated && st.projectKey) {
      await setSample({ step: 'Moving the sample project to the trash', progress: 70 });
      await jira(route`/rest/api/3/project/${st.projectKey}`, { method: 'DELETE' }, 'Delete sample project').catch(() => undefined);
    }
    if (st.spaceCreated && st.spaceKey) {
      await setSample({ step: 'Deleting the sample Confluence space', progress: 80 });
      await confluence(route`/wiki/rest/api/space/${st.spaceKey}`, { method: 'DELETE' }, 'Delete sample space').catch(() => undefined);
    }
    await setSample({ step: 'Removing sample data from the trace graph', progress: 90 });
    await repo.deleteSampleData();
    await setState(STATE, { status: 'idle', step: 'Sample data removed', finishedAt: new Date().toISOString() } satisfies SampleState);
  } catch (e) {
    await setSample({ status: 'failed', message: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

export { fullRecompute };
