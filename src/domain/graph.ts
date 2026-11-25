import { Artifact, ArtifactKind, Edge, Relation, Suspect, isOpen } from './types';

/**
 * Immutable, indexed view over artifacts, edges and suspect records.
 * All traversals are cycle-safe.
 */
export class TraceGraph {
  readonly artifacts: ReadonlyMap<string, Artifact>;
  readonly edges: ReadonlyMap<string, Edge>;
  private readonly byKey = new Map<string, Artifact>();
  private readonly out = new Map<string, Edge[]>(); // fromId -> edges (towards upstream)
  private readonly inc = new Map<string, Edge[]>(); // toId -> edges (from downstream)
  private readonly openSuspectByEdge = new Map<string, Suspect>();

  constructor(artifacts: Iterable<Artifact>, edges: Iterable<Edge>, suspects: Iterable<Suspect> = []) {
    const a = new Map<string, Artifact>();
    for (const art of artifacts) {
      a.set(art.id, art);
      this.byKey.set(art.key.toUpperCase(), art);
    }
    const e = new Map<string, Edge>();
    for (const edge of edges) {
      if (!a.has(edge.fromId) || !a.has(edge.toId)) continue; // dangling links are ignored
      e.set(edge.id, edge);
      push(this.out, edge.fromId, edge);
      push(this.inc, edge.toId, edge);
    }
    for (const s of suspects) {
      if (isOpen(s) && e.has(s.edgeId)) this.openSuspectByEdge.set(s.edgeId, s);
    }
    this.artifacts = a;
    this.edges = e;
  }

  get(id: string): Artifact | undefined {
    return this.artifacts.get(id);
  }

  getByKey(key: string): Artifact | undefined {
    return this.byKey.get(key.trim().toUpperCase());
  }

  /** Resolve an id or a human key. */
  resolve(idOrKey: string): Artifact | undefined {
    return this.get(idOrKey) ?? this.getByKey(idOrKey);
  }

  ofKind(kind: ArtifactKind): Artifact[] {
    return [...this.artifacts.values()].filter((a) => a.kind === kind);
  }

  /** Edges leaving `id` towards its upstream artifacts. */
  upstreamEdges(id: string, rel?: Relation): Edge[] {
    return (this.out.get(id) ?? []).filter((e) => !rel || e.rel === rel);
  }

  /** Edges arriving at `id` from downstream artifacts. */
  downstreamEdges(id: string, rel?: Relation): Edge[] {
    return (this.inc.get(id) ?? []).filter((e) => !rel || e.rel === rel);
  }

  upstream(id: string, rel?: Relation): Artifact[] {
    return this.upstreamEdges(id, rel).map((e) => this.artifacts.get(e.toId)!);
  }

  downstream(id: string, rel?: Relation): Artifact[] {
    return this.downstreamEdges(id, rel).map((e) => this.artifacts.get(e.fromId)!);
  }

  openSuspect(edgeId: string): Suspect | undefined {
    return this.openSuspectByEdge.get(edgeId);
  }

  openSuspects(): Suspect[] {
    return [...this.openSuspectByEdge.values()];
  }

  /** Transitive closure downstream (everything that depends on `id`), excluding `id`. */
  allDownstream(id: string): Artifact[] {
    return this.walk(id, (n) => this.downstreamEdges(n).map((e) => e.fromId));
  }

  /** Transitive closure upstream (everything `id` satisfies), excluding `id`. */
  allUpstream(id: string): Artifact[] {
    return this.walk(id, (n) => this.upstreamEdges(n).map((e) => e.toId));
  }

  private walk(start: string, next: (id: string) => string[]): Artifact[] {
    const seen = new Set<string>([start]);
    const order: Artifact[] = [];
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const n of next(cur)) {
        if (seen.has(n)) continue;
        seen.add(n);
        order.push(this.artifacts.get(n)!);
        queue.push(n);
      }
    }
    return order;
  }

  /** A copy of this graph with some artifacts / edges / suspects replaced or added. */
  with(changes: { artifacts?: Artifact[]; edges?: Edge[]; suspects?: Suspect[] }): TraceGraph {
    const arts = new Map(this.artifacts);
    for (const a of changes.artifacts ?? []) arts.set(a.id, a);
    const eds = new Map(this.edges);
    for (const e of changes.edges ?? []) eds.set(e.id, e);
    const sus = new Map<string, Suspect>(this.openSuspectByEdge);
    for (const s of changes.suspects ?? []) sus.set(s.edgeId, s);
    return new TraceGraph(arts.values(), eds.values(), sus.values());
  }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

export function edgeId(fromId: string, rel: Relation, toId: string): string {
  return `${fromId}|${rel}|${toId}`;
}
