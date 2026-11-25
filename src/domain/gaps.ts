import { TraceGraph } from './graph';
import { StandardPack } from './packs/types';
import { Artifact, Gap } from './types';

export interface EvaluateOptions {
  /** Restrict checks to these artifact ids (e.g. one release). Defaults to all artifacts. */
  scope?: ReadonlySet<string>;
  /** Integrity level for artifacts that do not carry one. Defaults to the pack default. */
  defaultLevel?: string;
}

export interface ClauseCoverage {
  clause: string;
  title: string;
  /** Number of (artifact, rule) checks run under this clause. */
  checked: number;
  passed: number;
  /** 0..100, or null when nothing in scope is checked under this clause. */
  percent: number | null;
}

export interface Evaluation {
  standard: string;
  gaps: Gap[];
  coverage: ClauseCoverage[];
  /** Per-rule totals, keyed by rule id. */
  byRule: Record<string, { checked: number; failed: number }>;
}

export function levelOf(a: Artifact, pack: StandardPack, defaultLevel?: string): string {
  const lvl = a.safetyClass && pack.levels.includes(a.safetyClass) ? a.safetyClass : undefined;
  return lvl ?? defaultLevel ?? pack.defaultLevel;
}

/** Run every rule of `pack` over the graph. Deterministic: same input, same output order. */
export function evaluate(graph: TraceGraph, pack: StandardPack, opts: EvaluateOptions = {}): Evaluation {
  const inScope = (a: Artifact) => !opts.scope || opts.scope.has(a.id);
  const artifacts = [...graph.artifacts.values()].filter(inScope).sort((x, y) => x.key.localeCompare(y.key));
  const gaps: Gap[] = [];
  const byRule: Evaluation['byRule'] = {};
  const byClause = new Map<string, { checked: number; passed: number }>();

  for (const rule of pack.rules) {
    const stat = (byRule[rule.id] = { checked: 0, failed: 0 });
    const clause = byClause.get(rule.clause) ?? { checked: 0, passed: 0 };
    byClause.set(rule.clause, clause);
    for (const a of artifacts) {
      if (a.kind !== rule.appliesTo) continue;
      if (!rule.requiredFor.includes(levelOf(a, pack, opts.defaultLevel))) continue;
      stat.checked++;
      clause.checked++;
      const message = rule.check(a, graph);
      if (message === null) {
        clause.passed++;
        continue;
      }
      stat.failed++;
      gaps.push({
        ruleId: rule.id,
        standard: pack.id,
        clause: rule.clause,
        artifactId: a.id,
        artifactKey: a.key,
        artifactKind: a.kind,
        message,
        blocking: rule.blocking,
      });
    }
  }

  const coverage = pack.clauses.map((c) => {
    const s = byClause.get(c.id) ?? { checked: 0, passed: 0 };
    return {
      clause: c.id,
      title: c.title,
      checked: s.checked,
      passed: s.passed,
      percent: s.checked ? Math.round((100 * s.passed) / s.checked) : null,
    };
  });

  return { standard: pack.id, gaps, coverage, byRule };
}

/** Artifacts that belong to a release, plus everything upstream of them (what they satisfy). */
export const WHOLE_PROJECT = ['', '*', 'all'];

/** `undefined` means the whole project (release empty, `*` or `all`). */
export function releaseScope(graph: TraceGraph, release: string | undefined): Set<string> | undefined {
  const r = (release ?? '').trim().toLowerCase();
  if (WHOLE_PROJECT.includes(r)) return undefined;
  const direct = [...graph.artifacts.values()].filter((a) => a.releases?.some((x) => x.toLowerCase() === r));
  if (direct.length === 0) return new Set();
  const scope = new Set<string>();
  for (const a of direct) {
    scope.add(a.id);
    for (const u of graph.allUpstream(a.id)) scope.add(u.id);
    // Verifications of in-release items are evidence for the release too.
    for (const d of graph.downstream(a.id, 'verifies')) scope.add(d.id);
  }
  return scope;
}

/** "3 gaps: 2 software requirements without a passing test, 1 hazard without a risk control." */
export function describeGaps(gaps: Gap[]): string {
  if (gaps.length === 0) return 'No gaps.';
  const byRule = new Map<string, number>();
  for (const g of gaps) byRule.set(g.ruleId, (byRule.get(g.ruleId) ?? 0) + 1);
  return `${gaps.length} gap${gaps.length === 1 ? '' : 's'} across ${byRule.size} rule${byRule.size === 1 ? '' : 's'}.`;
}
