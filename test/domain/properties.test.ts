import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { evaluate } from '../../src/domain/gaps';
import { evaluateGate } from '../../src/domain/gate';
import { edgeId, TraceGraph } from '../../src/domain/graph';
import { PACKS } from '../../src/domain/packs';
import { applyUpstreamEdit, clearSuspect, detectSuspects, JustificationRequiredError } from '../../src/domain/suspect';
import { Artifact, ArtifactKind, Edge, Relation } from '../../src/domain/types';

const T = '2026-12-12T09:00:00.000Z';

/** Valid (downstream kind, relation, upstream kind) triples. */
const SHAPES: [ArtifactKind, Relation, ArtifactKind][] = [
  ['SRS', 'derives', 'SYS'],
  ['DES', 'designs', 'SRS'],
  ['IMP', 'implements', 'SRS'],
  ['IMP', 'implements', 'DES'],
  ['VER', 'verifies', 'SRS'],
  ['VER', 'verifies', 'DES'],
  ['VER', 'verifies', 'RC'],
  ['RC', 'mitigates', 'HAZ'],
  ['SRS', 'implements', 'RC'],
];
const KINDS: ArtifactKind[] = ['SYS', 'SRS', 'DES', 'HAZ', 'RC', 'IMP', 'VER'];
const packIds = Object.keys(PACKS) as (keyof typeof PACKS)[];

const arbArtifact = (i: number) =>
  fc.record({
    kind: fc.constantFrom(...KINDS),
    version: fc.integer({ min: 1, max: 4 }),
    level: fc.constantFrom('A', 'B', 'C', 'D', 'E', 'QM', undefined),
    result: fc.constantFrom('pass', 'fail', 'not-run', undefined),
  }).map(
    (r): Artifact => ({
      id: `a${i}`,
      key: `K-${i}`,
      kind: r.kind,
      source: 'jira',
      sourceId: String(i),
      title: `t${i}`,
      version: r.version,
      updatedAt: T,
      safetyClass: r.level,
      result: r.kind === 'VER' ? (r.result as Artifact['result']) : undefined,
    }),
  );

/** A random graph whose edges all follow valid shapes. */
const arbGraph = fc
  .integer({ min: 1, max: 18 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => arbArtifact(i))))
  .chain((artifacts) => {
    const candidates: { from: Artifact; rel: Relation; to: Artifact }[] = [];
    for (const from of artifacts)
      for (const to of artifacts)
        for (const [fk, rel, tk] of SHAPES) if (from.kind === fk && to.kind === tk && from !== to) candidates.push({ from, rel, to });
    if (candidates.length === 0) return fc.constant({ artifacts, edges: [] as Edge[] });
    return fc
      .subarray(candidates)
      .chain((chosen) =>
        fc.tuple(...chosen.map(() => fc.option(fc.integer({ min: 1, max: 4 }), { nil: undefined }))).map((vers) => ({
          artifacts,
          edges: chosen.map(
            (c, i): Edge => ({
              id: edgeId(c.from.id, c.rel, c.to.id),
              fromId: c.from.id,
              toId: c.to.id,
              rel: c.rel,
              createdAt: T,
              // Never verified against a version from the future.
              verifiedAgainstVersion: vers[i] === undefined ? undefined : Math.min(vers[i]!, c.to.version),
            }),
          ),
        })),
      );
  });

const withSuspects = (artifacts: Artifact[], edges: Edge[]) => {
  const g = new TraceGraph(artifacts, edges);
  return g.with({ suspects: detectSuspects(g, T) });
};

describe('domain properties', () => {
  it('adding a passing verification never increases gaps', () => {
    fc.assert(
      fc.property(arbGraph, fc.nat(), fc.constantFrom(...packIds), ({ artifacts, edges }, pick, packId) => {
        const targets = artifacts.filter((a) => a.kind === 'SRS' || a.kind === 'DES' || a.kind === 'RC');
        fc.pre(targets.length > 0);
        const target = targets[pick % targets.length];
        const pack = PACKS[packId];
        const before = evaluate(withSuspects(artifacts, edges), pack).gaps.length;
        const v: Artifact = { ...artifacts[0], id: 'new-ver', key: 'NEW-VER', kind: 'VER', result: 'pass', version: 1, safetyClass: undefined };
        const e: Edge = { id: edgeId(v.id, 'verifies', target.id), fromId: v.id, toId: target.id, rel: 'verifies', createdAt: T, verifiedAgainstVersion: target.version };
        const after = evaluate(withSuspects([...artifacts, v], [...edges, e]), pack).gaps.length;
        expect(after).toBeLessThanOrEqual(before);
      }),
      { numRuns: 300 },
    );
  });

  it('editing upstream after verification always creates a suspect edge', () => {
    fc.assert(
      fc.property(arbGraph, fc.nat(), ({ artifacts, edges }, pick) => {
        const verified = edges.filter((e) => e.verifiedAgainstVersion !== undefined);
        fc.pre(verified.length > 0);
        const edge = verified[pick % verified.length];
        const g0 = new TraceGraph(artifacts, edges);
        const g1 = g0.with({ artifacts: [applyUpstreamEdit(g0.get(edge.toId)!, T)] });
        const all = detectSuspects(g1, T);
        expect(all.some((s) => s.edgeId === edge.id)).toBe(true);
        // Incremental detection (only the edited artifact) agrees for that edge.
        expect(detectSuspects(g1, T, [edge.toId]).some((s) => s.edgeId === edge.id)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('clearing a suspect edge requires a justification record', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), (text) => {
        const s = { edgeId: 'e', reason: 'r', since: T, upstreamVersion: 2 };
        if (text.trim().length < 10) {
          expect(() => clearSuspect(s, 'acc', text, T)).toThrow(JustificationRequiredError);
        } else {
          const c = clearSuspect(s, 'acc', text, T);
          expect(c.justification).toBe(text.trim());
          expect(c.clearedAt).toBe(T);
        }
      }),
    );
  });

  it('the gate is green iff there are no blocking gaps', () => {
    fc.assert(
      fc.property(arbGraph, fc.constantFrom(...packIds), ({ artifacts, edges }, packId) => {
        const g = withSuspects(artifacts, edges);
        const r = evaluateGate(g, PACKS[packId], 'all', T);
        const ev = evaluate(g, PACKS[packId]);
        expect(r.green).toBe(r.blocking.length === 0);
        expect(r.green).toBe(ev.gaps.filter((x) => x.blocking).length === 0 && g.openSuspects().length === 0);
      }),
      { numRuns: 300 },
    );
  });
});
