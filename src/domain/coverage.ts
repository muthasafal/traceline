import { TraceGraph } from './graph';
import { Artifact } from './types';

/**
 * A verification counts as passing for `target` only when its latest result is
 * a pass, it was recorded against the target's CURRENT version, and the link
 * is not suspect.
 */
export function passingVerifications(graph: TraceGraph, target: Artifact): Artifact[] {
  return graph
    .downstreamEdges(target.id, 'verifies')
    .filter((e) => e.verifiedAgainstVersion === target.version && !graph.openSuspect(e.id))
    .map((e) => graph.get(e.fromId)!)
    .filter((v) => v.result === 'pass');
}

export function failingVerifications(graph: TraceGraph, target: Artifact): Artifact[] {
  return graph.downstream(target.id, 'verifies').filter((v) => v.result === 'fail');
}

/** Short reason why `target` has no current passing verification, for messages. */
export function verificationShortfall(graph: TraceGraph, target: Artifact): string {
  const all = graph.downstreamEdges(target.id, 'verifies');
  if (all.length === 0) return 'no linked verification';
  const failing = failingVerifications(graph, target);
  if (failing.length) return `${failing.map((f) => f.key).join(', ')} failing`;
  const stale = all.filter((e) => e.verifiedAgainstVersion !== target.version || graph.openSuspect(e.id));
  if (stale.length) {
    return `${stale.map((e) => graph.get(e.fromId)!.key).join(', ')} verified an older version (suspect)`;
  }
  return 'linked verification not run yet';
}
