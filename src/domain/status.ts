import { failingVerifications, passingVerifications } from './coverage';
import { TraceGraph } from './graph';
import { shortDate } from './suspect';
import { Artifact, ArtifactKind, KIND_LABEL } from './types';

export type Tone = 'ok' | 'warn' | 'bad' | 'neutral';

export interface NodeStatus {
  text: string;
  tone: Tone;
  suspect?: { since: string; reason: string; edgeId: string };
}

/** Plain-text status for one artifact, e.g. "verified", "missing test", "suspect since 12 Dec". */
export function nodeStatus(graph: TraceGraph, a: Artifact): NodeStatus {
  const suspectEdge = graph
    .upstreamEdges(a.id)
    .concat(graph.downstreamEdges(a.id, 'verifies'))
    .find((e) => graph.openSuspect(e.id));
  if (suspectEdge) {
    const s = graph.openSuspect(suspectEdge.id)!;
    return {
      text: `suspect since ${shortDate(s.since)}`,
      tone: 'bad',
      suspect: { since: s.since, reason: s.reason, edgeId: s.edgeId },
    };
  }
  switch (a.kind) {
    case 'VER':
      if (a.result === 'pass') return { text: 'passed', tone: 'ok' };
      if (a.result === 'fail') return { text: 'failing', tone: 'bad' };
      return { text: 'not run', tone: 'warn' };
    case 'SRS':
    case 'RC':
    case 'DES': {
      if (passingVerifications(graph, a).length) return { text: 'verified', tone: 'ok' };
      if (failingVerifications(graph, a).length) return { text: 'test failing', tone: 'bad' };
      if (graph.downstream(a.id, 'verifies').length === 0) return { text: 'missing test', tone: 'bad' };
      return { text: 'needs re-test', tone: 'warn' };
    }
    case 'HAZ':
      return graph.downstream(a.id, 'mitigates').length
        ? { text: 'controlled', tone: 'ok' }
        : { text: 'no risk control', tone: 'bad' };
    case 'SYS':
      return graph.downstream(a.id, 'derives').length
        ? { text: 'covered', tone: 'ok' }
        : { text: 'no software requirement', tone: 'warn' };
    case 'IMP':
      return a.status && /done|closed|resolved/i.test(a.status)
        ? { text: 'implemented', tone: 'ok' }
        : { text: a.status ? a.status.toLowerCase() : 'in progress', tone: 'neutral' };
  }
}

/** Left-to-right reading order of the trace chain. */
export const CHAIN_ORDER: readonly ArtifactKind[] = ['SYS', 'HAZ', 'RC', 'SRS', 'DES', 'IMP', 'VER'];

export interface ChainNode {
  id: string;
  key: string;
  title: string;
  kind: ArtifactKind;
  kindLabel: string;
  position: 'upstream' | 'self' | 'downstream';
  status: NodeStatus;
  sample?: boolean;
}

export interface ChainLink {
  fromKey: string;
  toKey: string;
  rel: string;
  suspect: boolean;
}

export interface TraceChain {
  root: ChainNode;
  /** Columns in CHAIN_ORDER; empty columns are omitted. */
  columns: { kind: ArtifactKind; label: string; nodes: ChainNode[] }[];
  links: ChainLink[];
  /** One sentence summary, e.g. "PUMP-12 is verified by 2 tests; 1 link is suspect." */
  summary: string;
}

export function traceChain(graph: TraceGraph, idOrKey: string): TraceChain | undefined {
  const root = graph.resolve(idOrKey);
  if (!root) return undefined;
  const up = graph.allUpstream(root.id);
  const down = graph.allDownstream(root.id);
  const toNode = (a: Artifact, position: ChainNode['position']): ChainNode => ({
    id: a.id,
    key: a.key,
    title: a.title,
    kind: a.kind,
    kindLabel: KIND_LABEL[a.kind],
    position,
    status: nodeStatus(graph, a),
    sample: a.sample,
  });
  const nodes = [toNode(root, 'self'), ...up.map((a) => toNode(a, 'upstream')), ...down.map((a) => toNode(a, 'downstream'))];
  const ids = new Set(nodes.map((n) => n.id));
  const links: ChainLink[] = [...graph.edges.values()]
    .filter((e) => ids.has(e.fromId) && ids.has(e.toId))
    .map((e) => ({
      fromKey: graph.get(e.fromId)!.key,
      toKey: graph.get(e.toId)!.key,
      rel: e.rel,
      suspect: !!graph.openSuspect(e.id),
    }));
  const columns = CHAIN_ORDER.map((kind) => ({
    kind,
    label: KIND_LABEL[kind],
    nodes: nodes.filter((n) => n.kind === kind).sort((a, b) => a.key.localeCompare(b.key)),
  })).filter((c) => c.nodes.length);

  const suspects = links.filter((l) => l.suspect).length;
  const tests = down.filter((a) => a.kind === 'VER');
  // A test only counts if it passed against the CURRENT version of everything it verifies.
  const passing = tests.filter(
    (t) =>
      t.result === 'pass' &&
      graph
        .upstreamEdges(t.id, 'verifies')
        .every((e) => e.verifiedAgainstVersion === graph.get(e.toId)!.version && !graph.openSuspect(e.id)),
  ).length;
  const parts = [
    `${root.key} is ${nodes[0].status.text}`,
    `${up.length} upstream and ${down.length} downstream artifact${down.length === 1 ? '' : 's'}`,
    tests.length
      ? `${passing} of ${tests.length} linked test${tests.length === 1 ? '' : 's'} passing against current versions`
      : 'no linked tests',
  ];
  if (suspects) parts.push(`${suspects} suspect link${suspects === 1 ? '' : 's'}`);
  return { root: nodes[0], columns, links, summary: parts.join('; ') + '.' };
}
