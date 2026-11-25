import { describe, expect, it } from 'vitest';
import { traceForPath, mockAudit, draftImpactFacts } from '../../src/domain/audit';
import { evaluate } from '../../src/domain/gaps';
import { evaluateGate } from '../../src/domain/gate';
import { IEC62304 } from '../../src/domain/packs';
import { sampleGraphData, SAMPLE_RELEASE } from '../../src/domain/sample';
import { nodeStatus, traceChain } from '../../src/domain/status';
import {
  applyUpstreamEdit,
  clearSuspect,
  detectSuspects,
  impactOfChange,
  JustificationRequiredError,
  reverify,
} from '../../src/domain/suspect';
import { art, cleanChain, graph, link, T0 } from './helpers';

const T1 = '2026-12-12T09:00:00.000Z';

describe('suspect links', () => {
  it('editing the upstream SRS makes its verification and design links suspect', () => {
    const { artifacts, edges } = cleanChain();
    const g0 = graph(artifacts, edges);
    const edited = applyUpstreamEdit(g0.get('SRS-1')!, T1);
    const g1 = g0.with({ artifacts: [edited] });
    const suspects = detectSuspects(g1, T1);
    expect(suspects.map((s) => s.edgeId).sort()).toEqual(
      [link('DES-1', 'designs', 'SRS-1').id, link('IMP-1', 'implements', 'SRS-1').id, link('VER-1', 'verifies', 'SRS-1').id].sort(),
    );
    expect(suspects[0].reason).toMatch(/SRS-1 changed \(now version 2\)/);
    // Idempotent: once recorded, not raised again.
    expect(detectSuspects(g1.with({ suspects }), T1)).toEqual([]);
  });

  it('never-verified links are not suspect', () => {
    const g = graph([art('A', 'SRS', { version: 5 }), art('V', 'VER')], [link('V', 'verifies', 'A', null)]);
    expect(detectSuspects(g, T1)).toEqual([]);
  });

  it('clearing needs a justification', () => {
    const s = { edgeId: 'e', reason: 'r', since: T0, upstreamVersion: 2 };
    expect(() => clearSuspect(s, 'acc-1', '  ', T1)).toThrow(JustificationRequiredError);
    expect(() => clearSuspect(s, 'acc-1', 'ok', T1)).toThrow(JustificationRequiredError);
    const c = clearSuspect(s, 'acc-1', 'Wording change only; behaviour unchanged.', T1);
    expect(c).toMatchObject({ clearedBy: 'acc-1', clearedAt: T1 });
  });

  it('re-verifying clears the suspect and restores coverage', () => {
    const { artifacts, edges } = cleanChain();
    let g = graph(artifacts, edges);
    g = g.with({ artifacts: [applyUpstreamEdit(g.get('SRS-1')!, T1)] });
    g = g.with({ suspects: detectSuspects(g, T1) });
    expect(nodeStatus(g, g.get('VER-1')!).text).toBe('suspect since 12 Dec');
    expect(evaluateGate(g, IEC62304, 'all', T1).green).toBe(false);

    const edge = g.edges.get(link('VER-1', 'verifies', 'SRS-1').id)!;
    const { edge: e2, cleared } = reverify(g, edge, 'acc-1', T1);
    expect(e2.verifiedAgainstVersion).toBe(2);
    expect(cleared?.justification).toMatch(/Re-verified/);
    g = g.with({ edges: [e2], suspects: [cleared!] });
    expect(g.openSuspect(edge.id)).toBeUndefined();
  });

  it('impact of change lists everything downstream and the tests to re-run', () => {
    const { artifacts, edges } = cleanChain();
    const imp = impactOfChange(graph(artifacts, edges), 'SYS-1')!;
    expect(imp.affected.map((a) => a.key).sort()).toEqual(['DES-1', 'IMP-1', 'SRS-1', 'VER-1', 'VER-2']);
    expect(imp.retest.map((a) => a.key).sort()).toEqual(['VER-1', 'VER-2']);
  });
});

describe('release gate and the sample project', () => {
  const { artifacts, edges } = sampleGraphData(T1);
  const base = graph(artifacts, edges);
  const g = base.with({ suspects: detectSuspects(base, T1) });

  it('has the documented sample sizes', () => {
    const count = (k: string) => artifacts.filter((a) => a.kind === k).length;
    expect([count('SYS'), count('SRS'), count('HAZ'), count('RC'), count('IMP'), count('VER')]).toEqual([15, 30, 8, 10, 35, 40]);
    expect(artifacts.every((a) => a.sample)).toBe(true);
  });

  it('finds exactly the deliberate gaps', () => {
    const gaps = evaluate(g, IEC62304).gaps.map((x) => `${x.ruleId}:${x.artifactKey}`).sort();
    expect(gaps).toEqual(
      [
        'iec62304.c-srs-detailed-design:SRS-030',
        'iec62304.haz-controlled:HAZ-008',
        'iec62304.rc-verified:RC-010',
        'iec62304.srs-verified:SRS-004', // stale after the edit (the suspect link)
        'iec62304.srs-verified:SRS-021', // VER-021 failing
        'iec62304.srs-verified:SRS-027', // no test
      ].sort(),
    );
  });

  it('marks the edited requirement links suspect', () => {
    const open = g.openSuspects().map((s) => s.edgeId);
    expect(open).toContain(link('sample:VER-004', 'verifies', 'sample:SRS-004').id);
  });

  it('the v2.3 gate is red with a sentence explaining why', () => {
    const r = evaluateGate(g, IEC62304, SAMPLE_RELEASE, T1);
    expect(r.green).toBe(false);
    expect(r.summary).toMatch(/^Not yet: v2\.3 has \d+ blocking items, including \d+ suspect link/);
  });

  it('a release with no work is not green', () => {
    const r = evaluateGate(g, IEC62304, 'v9.9', T1);
    expect(r.green).toBe(false);
    expect(r.summary).toMatch(/Nothing is assigned/);
  });

  it('trace chain for a requirement is readable left to right', () => {
    const chain = traceChain(g, 'SRS-004')!;
    expect(chain.columns.map((c) => c.kind)).toEqual(['SYS', 'HAZ', 'RC', 'SRS', 'DES', 'IMP', 'VER']);
    expect(chain.root.status.text).toBe('suspect since 12 Dec');
    expect(chain.links.some((l) => l.suspect)).toBe(true);
  });

  it('mock audit and impact facts are grounded in artifact keys', () => {
    const qs = mockAudit(evaluateGate(g, IEC62304, SAMPLE_RELEASE, T1).blocking, 20);
    expect(qs.some((q) => q.artifactKey === 'HAZ-008' && /risk control/.test(q.question))).toBe(true);
    const facts = draftImpactFacts(g, IEC62304, 'SYS-003')!;
    expect(facts.verificationsToRerun.length).toBeGreaterThan(0);
  });

  it('trace-for-file maps a code path to requirements', () => {
    const hits = traceForPath(g, 'src/occlusion-monitor/pressure.ts');
    expect(hits.flatMap((h) => h.requirements.map((r) => r.key))).toContain('SRS-003');
  });
});
