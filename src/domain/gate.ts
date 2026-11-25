import { evaluate, releaseScope } from './gaps';
import { TraceGraph } from './graph';
import { StandardPack } from './packs/types';
import { Gap, Suspect } from './types';

export interface GateResult {
  release: string;
  standard: string;
  green: boolean;
  /** Gaps that turn the gate red, including open suspect links. */
  blocking: Gap[];
  /** Gaps that do not block shipping but should be reviewed. */
  warnings: Gap[];
  openSuspects: Suspect[];
  /** Number of artifacts the gate looked at. */
  scopeSize: number;
  /** One sentence that answers "Can we ship?". */
  summary: string;
  evaluatedAt: string;
}

/**
 * The release gate: green if and only if there are no blocking gaps.
 * Open suspect links on in-scope artifacts are blocking (a release you mark
 * "ready" must not ship on stale evidence).
 */
export function evaluateGate(
  graph: TraceGraph,
  pack: StandardPack,
  release: string,
  now: string,
  defaultLevel?: string,
): GateResult {
  const scope = releaseScope(graph, release);
  const ev = evaluate(graph, pack, { scope, defaultLevel });

  const inScope = (id: string) => !scope || scope.has(id);
  const openSuspects = graph.openSuspects().filter((s) => {
    const e = graph.edges.get(s.edgeId)!;
    return inScope(e.fromId) || inScope(e.toId);
  });
  const suspectGaps: Gap[] = openSuspects.map((s) => {
    const e = graph.edges.get(s.edgeId)!;
    const down = graph.get(e.fromId)!;
    return {
      ruleId: `${pack.id}.no-open-suspects`,
      standard: pack.id,
      clause: pack.changeClause,
      artifactId: down.id,
      artifactKey: down.key,
      artifactKind: down.kind,
      message: `Suspect link: ${s.reason} Re-verify ${down.key} or clear the link with a justification.`,
      blocking: true,
    };
  });

  const emptyGaps: Gap[] =
    scope && scope.size === 0
      ? [
          {
            ruleId: `${pack.id}.release-empty`,
            standard: pack.id,
            clause: pack.changeClause,
            artifactId: '',
            artifactKey: release,
            artifactKind: 'IMP',
            message: `Nothing is assigned to ${release} yet. Add the fix version to the work in this release.`,
            blocking: true,
          },
        ]
      : [];
  const blocking = [...emptyGaps, ...ev.gaps.filter((g) => g.blocking), ...suspectGaps];
  const warnings = ev.gaps.filter((g) => !g.blocking);
  const scopeSize = scope ? scope.size : graph.artifacts.size;
  const green = blocking.length === 0;

  let summary: string;
  if (scope && scope.size === 0) {
    summary = `Nothing is assigned to ${release} yet, so there is nothing to ship. Add a fix version to the work in this release.`;
  } else if (green) {
    summary = `Yes: ${release} has no blocking gaps across ${scopeSize} artifacts${
      warnings.length ? `, with ${warnings.length} warning${warnings.length === 1 ? '' : 's'} to review` : ''
    }.`;
  } else {
    summary = `Not yet: ${release} has ${blocking.length} blocking item${blocking.length === 1 ? '' : 's'}${
      openSuspects.length ? `, including ${openSuspects.length} suspect link${openSuspects.length === 1 ? '' : 's'}` : ''
    }.`;
  }

  return {
    release,
    standard: pack.id,
    green,
    blocking,
    warnings,
    openSuspects,
    scopeSize,
    summary,
    evaluatedAt: now,
  };
}
