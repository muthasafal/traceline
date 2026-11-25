import { draftImpactFacts, mockAudit, traceForPath } from '../domain/audit';
import { evaluate } from '../domain/gaps';
import { evaluateGate } from '../domain/gate';
import { TraceGraph } from '../domain/graph';
import { getPack } from '../domain/packs';
import { traceChain } from '../domain/status';
import { impactOfChange } from '../domain/suspect';
import { Gap, KIND_LABEL } from '../domain/types';
import { ensureSchema } from '../storage/forgeSql';
import { getSettings } from '../storage/settings';
import { repo } from '../sync/sync';
import { describeOwners, ownersOf } from '../twg/owners';
import { redactor, visibleIds } from './visibility';

/**
 * Rovo actions (also exposed as MCP tools). Every action:
 *  - computes on the full trace graph (so hidden items never create false gaps),
 *  - redacts its answer to what the calling user can see,
 *  - returns structured facts plus a one-sentence `answer` the agent can cite.
 * The agent writes prose; these never invent facts.
 */

type Input = Record<string, unknown> & { inputs?: Record<string, unknown> };

function arg(payload: Input, name: string): string | undefined {
  const v = payload?.[name] ?? payload?.inputs?.[name];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

async function load() {
  await ensureSchema();
  const settings = await getSettings();
  const pack = getPack(settings.pack);
  const graph = await repo.loadGraph();
  const visible = await visibleIds(graph);
  return { settings, pack, graph, visible };
}

function notFound(key: string) {
  return { found: false, answer: `Traceline does not track ${key}, or you do not have permission to view it.` };
}

function resolveVisible(graph: TraceGraph, visible: Set<string>, key: string | undefined) {
  if (!key) return undefined;
  const a = graph.resolve(key) ?? [...graph.artifacts.values()].find((x) => x.title.includes(`[${key.toUpperCase()}]`));
  return a && visible.has(a.id) ? a : undefined;
}

const gapView = (g: Gap) => ({ key: g.artifactKey, kind: KIND_LABEL[g.artifactKind], clause: g.clause, blocking: g.blocking, message: g.message });

const label = (graph: TraceGraph, id: string) => {
  const a = graph.get(id)!;
  return { key: a.key, kind: KIND_LABEL[a.kind], title: a.title };
};

export async function gapsForRelease(payload: Input) {
  const { settings, pack, graph, visible } = await load();
  const release = arg(payload, 'release') ?? '*';
  const gate = evaluateGate(graph, pack, release, new Date().toISOString(), settings.defaultLevel);
  const r = redactor(visible);
  const blocking = r.keep(gate.blocking).slice(0, 40).map(gapView);
  const warnings = r.keep(gate.warnings).slice(0, 20).map(gapView);
  return {
    release: release === '*' ? 'whole project' : release,
    standard: pack.name,
    canShip: gate.green,
    answer: gate.summary,
    blocking,
    warnings,
    note: r.note(),
  };
}

export async function impactOfChangeAction(payload: Input) {
  const { graph, visible } = await load();
  const key = arg(payload, 'artifactKey') ?? arg(payload, 'issueKey');
  const root = resolveVisible(graph, visible, key);
  if (!root) return notFound(key ?? '(no key given)');
  const imp = impactOfChange(graph, root.id)!;
  const r = redactor(visible);
  const affected = r.keep(imp.affected).map((a) => label(graph, a.id));
  const retest = r.keep(imp.retest).map((a) => ({ ...label(graph, a.id), lastResult: a.result ?? 'not-run' }));
  return {
    artifact: label(graph, root.id),
    answer: `Changing ${root.key} affects ${imp.affected.length} downstream artifact${imp.affected.length === 1 ? '' : 's'}; ${imp.retest.length} verification${imp.retest.length === 1 ? '' : 's'} must be re-run.`,
    affected,
    mustRetest: retest,
    hazardsUpstream: r.keep(imp.hazards).map((h) => label(graph, h.id)),
    note: r.note(),
  };
}

export async function whatToRetest(payload: Input) {
  const res = await impactOfChangeAction(payload);
  if (!('mustRetest' in res)) return res;
  return { artifact: res.artifact, answer: res.answer, mustRetest: res.mustRetest, note: res.note };
}

export async function traceChainAction(payload: Input) {
  const { graph, visible } = await load();
  const key = arg(payload, 'artifactKey') ?? arg(payload, 'issueKey');
  const root = resolveVisible(graph, visible, key);
  if (!root) return notFound(key ?? '(no key given)');
  const chain = traceChain(graph, root.id)!;
  const r = redactor(visible);
  return {
    answer: chain.summary,
    columns: chain.columns.map((c) => ({
      kind: c.label,
      items: r.keep(c.nodes).map((n) => ({ key: n.key, title: n.title, status: n.status.text, suspectReason: n.status.suspect?.reason })),
    })),
    suspectLinks: chain.links.filter((l) => l.suspect),
    note: r.note(),
  };
}

export async function coverageByClause(payload: Input) {
  const { settings, graph } = await load();
  const pack = getPack(arg(payload, 'standard') ?? settings.pack);
  const ev = evaluate(graph, pack, { defaultLevel: settings.defaultLevel });
  const rows = ev.coverage.map((c) => ({
    clause: c.clause,
    title: c.title,
    checked: c.checked,
    passed: c.passed,
    percent: c.percent,
    sentence:
      c.percent === null
        ? `§${c.clause} ${c.title}: nothing in scope is checked under this clause.`
        : `§${c.clause} ${c.title}: ${c.passed} of ${c.checked} checks pass (${c.percent}%).`,
  }));
  const weakest = rows.filter((r) => r.percent !== null).sort((a, b) => a.percent! - b.percent!)[0];
  return {
    standard: pack.name,
    basis: pack.basis,
    answer: weakest ? `Weakest clause: ${weakest.sentence}` : 'Nothing is tracked yet.',
    clauses: rows,
  };
}

export async function draftImpactAnalysis(payload: Input) {
  const { pack, graph, visible } = await load();
  const key = arg(payload, 'artifactKey') ?? arg(payload, 'issueKey');
  const root = resolveVisible(graph, visible, key);
  if (!root) return notFound(key ?? '(no key given)');
  const facts = draftImpactFacts(graph, pack, root.id)!;
  const r = redactor(visible);
  const keep = <T extends { key: string }>(xs: T[]) => r.keep(xs.map((x) => ({ ...x, id: graph.getByKey(x.key)?.id })));
  return {
    instructions:
      'Write a change impact analysis from these facts only. Sections: Change, Safety relevance, Affected items, Verification to repeat, Residual risk questions for the risk owner. Cite every artifact key. Do not invent tests, hazards or results.',
    ...facts,
    hazardsInvolved: keep(facts.hazardsInvolved),
    downstreamAffected: keep(facts.downstreamAffected),
    verificationsToRerun: keep(facts.verificationsToRerun),
    note: r.note(),
  };
}

export async function mockAuditAction(payload: Input) {
  const { settings, pack, graph, visible } = await load();
  const scope = arg(payload, 'scope') ?? arg(payload, 'release') ?? '*';
  const gate = evaluateGate(graph, pack, scope, new Date().toISOString(), settings.defaultLevel);
  const r = redactor(visible);
  const gaps = r.keep([...gate.blocking, ...gate.warnings]);
  const questions = mockAudit(gaps, 10);
  return {
    scope: scope === '*' ? 'whole project' : scope,
    standard: pack.name,
    answer: questions.length
      ? `${questions.length} questions an auditor is likely to ask, based on ${gaps.length} open gap${gaps.length === 1 ? '' : 's'}.`
      : 'No open gaps, so no gap-driven audit questions. Expect general questions on process and records.',
    questions,
    note: r.note(),
  };
}

export async function traceForFile(payload: Input) {
  const { graph, visible } = await load();
  const path = arg(payload, 'path') ?? arg(payload, 'component');
  if (!path) return { answer: 'Give a file path, folder or component name.', implementations: [] };
  const hits = traceForPath(graph, path);
  const r = redactor(visible);
  const implementations = hits
    .filter((h) => {
      const id = graph.getByKey(h.implementation.key)?.id;
      return !id || visible.has(id);
    })
    .map((h) => ({
      ...h,
      requirements: r.keep(h.requirements.map((q) => ({ ...q, id: graph.getByKey(q.key)?.id }))).map(({ id: _id, ...q }) => q),
    }));
  const reqs = new Set(implementations.flatMap((h) => h.requirements.map((q) => q.key)));
  return {
    path,
    answer: implementations.length
      ? `${path} is touched by ${implementations.length} implementation item${implementations.length === 1 ? '' : 's'} tracing to ${reqs.size} requirement${reqs.size === 1 ? '' : 's'} or risk item${reqs.size === 1 ? '' : 's'}.`
      : `No tracked implementation item touches ${path}. Link the work item to its requirement, or add code paths to it.`,
    implementations,
    note: r.note(),
  };
}

/** Cloud id from a Forge invocation context (Rovo/MCP actions and resolvers). */
export function cloudIdOf(payload: unknown, context: unknown): string | undefined {
  const c = (context ?? {}) as { cloudId?: string; installContext?: string };
  const p = (payload ?? {}) as { context?: { cloudId?: string } };
  return c.cloudId ?? p.context?.cloudId ?? /site\/([0-9a-f-]+)/.exec(c.installContext ?? '')?.[1];
}

export async function whoSignsOff(payload: Input, context?: unknown) {
  const { graph, visible } = await load();
  const key = arg(payload, 'artifactKey') ?? arg(payload, 'issueKey');
  const root = resolveVisible(graph, visible, key);
  if (!root) return notFound(key ?? '(no key given)');
  const cloudId = cloudIdOf(payload, context);
  if (!cloudId) return { answer: 'Could not determine the site for this request.', people: [] };
  const owners = await ownersOf(graph, root, cloudId);
  return {
    artifact: { key: root.key, title: root.title },
    answer: describeOwners(root, owners),
    source: owners.source,
    people: owners.people.map((p) => ({ name: p.name ?? 'Unknown user', role: p.role, via: p.via, teams: p.teams?.length ?? 0 })),
    hint: owners.hint,
  };
}
