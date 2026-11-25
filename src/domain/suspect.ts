import { TraceGraph } from './graph';
import { Artifact, Edge, Suspect, isOpen } from './types';

/**
 * Suspect links (the DOORS idea): when an upstream artifact changes after a
 * downstream link was verified against it, the link becomes suspect until
 * someone re-verifies it or clears it with a recorded justification.
 */

/** True when the edge's upstream end has moved past the version it was verified against. */
export function isStale(graph: TraceGraph, edge: Edge): boolean {
  if (edge.verifiedAgainstVersion === undefined) return false;
  const up = graph.get(edge.toId);
  return !!up && up.version > edge.verifiedAgainstVersion;
}

/**
 * Returns NEW suspect records for every stale edge that has no open suspect yet.
 * Pure: the caller persists the result.
 */
export function detectSuspects(graph: TraceGraph, now: string, onlyUpstreamIds?: Iterable<string>): Suspect[] {
  const edges = onlyUpstreamIds
    ? [...new Set(onlyUpstreamIds)].flatMap((id) => graph.downstreamEdges(id))
    : [...graph.edges.values()];
  const created: Suspect[] = [];
  for (const edge of edges) {
    if (!isStale(graph, edge) || graph.openSuspect(edge.id)) continue;
    const up = graph.get(edge.toId)!;
    const down = graph.get(edge.fromId)!;
    created.push({
      edgeId: edge.id,
      since: now,
      upstreamVersion: up.version,
      reason: `${up.key} changed (now version ${up.version}) after ${down.key} was ${
        edge.rel === 'verifies' ? 'verified' : 'linked and reviewed'
      } against version ${edge.verifiedAgainstVersion}.`,
    });
  }
  return created;
}

/** Records an upstream content change: bumps the version and returns the new artifact. */
export function applyUpstreamEdit(a: Artifact, at: string): Artifact {
  return { ...a, version: a.version + 1, updatedAt: at };
}

export class JustificationRequiredError extends Error {
  constructor() {
    super('Clearing a suspect link needs a written justification (at least 10 characters).');
    this.name = 'JustificationRequiredError';
  }
}

export const MIN_JUSTIFICATION = 10;

/**
 * Clear a suspect link without re-verifying. A justification record is
 * mandatory: an auditor will ask why the change did not need re-testing.
 */
export function clearSuspect(s: Suspect, by: string, justification: string, at: string): Suspect {
  const text = (justification ?? '').trim();
  if (text.length < MIN_JUSTIFICATION) throw new JustificationRequiredError();
  if (!by || !by.trim()) throw new Error('Clearing a suspect link needs the account that cleared it.');
  if (!isOpen(s)) return s;
  return { ...s, clearedBy: by, clearedAt: at, justification: text };
}

/**
 * Re-verify a link against the upstream artifact's current version. Returns the
 * updated edge and, if one was open, the cleared suspect record (justified by the re-verification).
 */
export function reverify(
  graph: TraceGraph,
  edge: Edge,
  by: string,
  at: string,
): { edge: Edge; cleared?: Suspect } {
  const up = graph.get(edge.toId);
  if (!up) throw new Error(`Upstream artifact ${edge.toId} not found.`);
  const updated: Edge = { ...edge, verifiedAgainstVersion: up.version };
  const open = graph.openSuspect(edge.id);
  const cleared = open
    ? clearSuspect(open, by, `Re-verified against ${up.key} version ${up.version}.`, at)
    : undefined;
  return { edge: updated, cleared };
}

/**
 * Downstream impact of changing an artifact: every artifact that transitively
 * depends on it, and the verifications that must be re-run.
 */
export function impactOfChange(graph: TraceGraph, idOrKey: string) {
  const root = graph.resolve(idOrKey);
  if (!root) return undefined;
  const affected = graph.allDownstream(root.id);
  const retest = affected.filter((a) => a.kind === 'VER');
  // Verifications of the root itself plus of anything affected.
  return {
    root,
    affected,
    retest,
    hazards: graph.allUpstream(root.id).filter((a) => a.kind === 'HAZ'),
  };
}

/** Plain-text "since" for display, e.g. "12 Dec". */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
