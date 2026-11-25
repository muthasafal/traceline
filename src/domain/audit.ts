import { TraceGraph } from './graph';
import { levelOf } from './gaps';
import { StandardPack } from './packs/types';
import { impactOfChange } from './suspect';
import { nodeStatus } from './status';
import { Gap, KIND_LABEL } from './types';

/**
 * Deterministic helpers that turn the graph into structured facts for the
 * Rovo Auditor agent. The agent writes the prose; these never invent facts.
 */

export interface AuditQuestion {
  question: string;
  clause: string;
  artifactKey: string;
  /** What evidence would answer it. */
  evidenceNeeded: string;
}

const TEMPLATES: Record<string, (g: Gap) => Omit<AuditQuestion, 'clause' | 'artifactKey'>> = {
  'srs-traces-sys': (g) => ({
    question: `Which system requirement is ${g.artifactKey} derived from, and where is that recorded?`,
    evidenceNeeded: 'A "derives" link from the software requirement to its system requirement.',
  }),
  'srs-verified': (g) => ({
    question: `Show me the test that verifies the current version of ${g.artifactKey}, and its result.`,
    evidenceNeeded: 'A passing verification recorded against the current requirement version.',
  }),
  'srs-implemented': (g) => ({
    question: `Where is ${g.artifactKey} implemented?`,
    evidenceNeeded: 'An implementing story or task with its commits or pull requests.',
  }),
  'haz-controlled': (g) => ({
    question: `What risk control measure reduces the risk of hazard ${g.artifactKey}?`,
    evidenceNeeded: 'A risk control linked to the hazard with "mitigates".',
  }),
  'rc-in-srs': (g) => ({
    question: `Which software requirement implements risk control ${g.artifactKey}?`,
    evidenceNeeded: 'A software requirement linked to the risk control with "implements".',
  }),
  'rc-verified': (g) => ({
    question: `How did you verify that risk control ${g.artifactKey} is effective?`,
    evidenceNeeded: 'A passing verification of the risk control.',
  }),
  'no-open-suspects': (g) => ({
    question: `${g.artifactKey} was verified before its upstream item changed. Why was it not re-tested?`,
    evidenceNeeded: 'A re-run of the verification, or a recorded justification for clearing the suspect link.',
  }),
};

function templateFor(ruleId: string) {
  const suffix = ruleId.split('.').slice(1).join('.');
  for (const [k, fn] of Object.entries(TEMPLATES)) if (suffix.endsWith(k)) return fn;
  return undefined;
}

/** Likely auditor questions from the current gaps, most important first, capped at `limit`. */
export function mockAudit(gaps: Gap[], limit = 10): AuditQuestion[] {
  const ordered = [...gaps].sort((a, b) => Number(b.blocking) - Number(a.blocking) || a.clause.localeCompare(b.clause));
  return ordered.slice(0, limit).map((g) => {
    const t = templateFor(g.ruleId);
    return {
      clause: g.clause,
      artifactKey: g.artifactKey,
      ...(t
        ? t(g)
        : {
            question: `Clause ${g.clause}: ${g.message} How will you close this before release?`,
            evidenceNeeded: 'Evidence that closes the gap described.',
          }),
    };
  });
}

/** Structured facts for an impact analysis of changing one artifact. */
export function draftImpactFacts(graph: TraceGraph, pack: StandardPack, idOrKey: string) {
  const impact = impactOfChange(graph, idOrKey);
  if (!impact) return undefined;
  const { root, affected, retest, hazards } = impact;
  return {
    artifact: { key: root.key, title: root.title, kind: KIND_LABEL[root.kind], version: root.version },
    integrityLevel: `${pack.levelName} ${levelOf(root, pack)}`,
    hazardsInvolved: hazards.map((h) => ({ key: h.key, title: h.title })),
    downstreamAffected: affected.map((a) => ({ key: a.key, kind: KIND_LABEL[a.kind], status: nodeStatus(graph, a).text })),
    verificationsToRerun: retest.map((v) => ({ key: v.key, title: v.title, lastResult: v.result ?? 'not-run' })),
    counts: { downstream: affected.length, retest: retest.length, hazards: hazards.length },
  };
}

/** Requirements implemented by a code area, via IMP artifacts whose paths match. */
export function traceForPath(graph: TraceGraph, pathOrComponent: string) {
  const needle = normalisePath(pathOrComponent);
  if (!needle) return [];
  const imps = graph
    .ofKind('IMP')
    .filter((i) => (i.paths ?? []).some((p) => matchesPath(normalisePath(p), needle)));
  return imps.map((imp) => ({
    implementation: { key: imp.key, title: imp.title },
    requirements: graph
      .allUpstream(imp.id)
      .filter((u) => u.kind === 'SRS' || u.kind === 'RC' || u.kind === 'SYS' || u.kind === 'HAZ')
      .map((u) => ({ key: u.key, kind: KIND_LABEL[u.kind], title: u.title, status: nodeStatus(graph, u).text })),
  }));
}

function normalisePath(p: string): string {
  return p.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase();
}

/** `src/pump/dose.ts` matches `src/pump`, `src/pump/dose.ts`, or a component name `pump`. */
function matchesPath(candidate: string, needle: string): boolean {
  if (candidate === needle) return true;
  if (candidate.startsWith(needle + '/') || needle.startsWith(candidate + '/')) return true;
  return candidate.split('/').includes(needle);
}
