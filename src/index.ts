/**
 * Forge function entry points. Handlers named here are referenced from manifest.yml.
 */
import { getPack } from './domain/packs';
import { canComplete } from './domain/validator';
import { ensureSchema } from './storage/forgeSql';
import { getSettings } from './storage/settings';
import { jobs } from './resolvers/admin';
import { fullRecompute } from './sync/recompute';
import { runSampleRemove, runSampleSeed } from './sync/seed';
import { repo, syncIssue, syncPage } from './sync/sync';

export { panelHandler } from './resolvers/panel';
export { adminHandler } from './resolvers/admin';

const log = (msg: string, extra?: unknown) => console.log(`[traceline] ${msg}`, extra === undefined ? '' : JSON.stringify(extra));

/** jira:workflowValidator. Returns { result, errorMessage }. */
export async function validateDone(args: { issue?: { key?: string } }) {
  try {
    const key = args.issue?.key;
    const settings = await getSettings();
    if (!key || !settings.validatorEnabled) return { result: true };
    await ensureSchema();
    // Make sure this issue's links are current before deciding.
    await syncIssue(key);
    const g = await repo.loadGraph();
    const d = canComplete(g, getPack(settings.pack), key, settings.validatorLevels, settings.defaultLevel);
    return d.allowed ? { result: true } : { result: false, errorMessage: `Traceline: ${d.message}` };
  } catch (e) {
    // Never brick a workflow because of an app error; log it and allow.
    log('validator error', String(e));
    return { result: true };
  }
}

type IssueEvent = { issue?: { id?: string; key?: string }; eventType?: string };
type LinkEvent = { issueLink?: { sourceIssueId?: string | number; destinationIssueId?: string | number }; sourceIssueId?: string | number; destinationIssueId?: string | number };
type PageEvent = { content?: { id?: string }; page?: { id?: string } };

/** Product trigger: Jira issue created / updated / deleted. */
export async function onIssueEvent(event: IssueEvent) {
  await ensureSchema();
  const id = event.issue?.id;
  if (!id) return;
  const r = await syncIssue(String(id));
  if (r.versionBumped) log(`version bump ${r.artifact?.key}`, { newSuspects: r.newSuspects });
}

/** Product trigger: Jira issue link created / deleted. Both ends are re-synced. */
export async function onLinkEvent(event: LinkEvent) {
  await ensureSchema();
  const src = event.issueLink?.sourceIssueId ?? event.sourceIssueId;
  const dst = event.issueLink?.destinationIssueId ?? event.destinationIssueId;
  for (const id of [src, dst]) if (id !== undefined) await syncIssue(String(id));
}

/** Product trigger: Confluence page created / updated. */
export async function onPageEvent(event: PageEvent) {
  await ensureSchema();
  const id = event.content?.id ?? event.page?.id;
  if (!id) return;
  const r = await syncPage(String(id));
  if (r.versionBumped) log(`page version bump ${r.artifact?.key}`, { newSuspects: r.newSuspects });
}

/** Lifecycle trigger: install / upgrade. Migrations run in the queue consumer (long timeout). */
export async function onLifecycle() {
  await jobs.push({ body: { type: 'migrate' } });
}

/** Scheduled trigger: nightly full recompute. */
export async function nightly() {
  await jobs.push({ body: { type: 'recompute' } });
}

/** Queue consumer for long-running jobs. */
export async function runJob(event: { body?: { type?: string; accountId?: string; siteUrl?: string } }) {
  const body = event.body ?? {};
  log(`job ${body.type}`);
  await ensureSchema();
  switch (body.type) {
    case 'migrate':
      return;
    case 'seed':
      await runSampleSeed(body.accountId!, body.siteUrl!);
      return;
    case 'remove-sample':
      await runSampleRemove();
      return;
    case 'recompute':
      log('recompute', await fullRecompute());
      return;
  }
}
