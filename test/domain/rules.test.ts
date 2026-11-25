import { describe, expect, it } from 'vitest';
import { evaluate } from '../../src/domain/gaps';
import { DO178C, IEC62304, ISO26262 } from '../../src/domain/packs';
import { art, cleanChain, graph, link, ver } from './helpers';

const ruleIds = (g: ReturnType<typeof graph>, pack = IEC62304, defaultLevel?: string) =>
  evaluate(g, pack, { defaultLevel }).gaps.map((x) => `${x.ruleId}:${x.artifactKey}`);

describe('IEC 62304 gap rules', () => {
  it('a complete Class C chain has no gaps', () => {
    const { artifacts, edges } = cleanChain();
    expect(ruleIds(graph(artifacts, edges))).toEqual([]);
  });

  it('srs-traces-sys: SRS without a system requirement', () => {
    const { artifacts, edges } = cleanChain();
    const g = graph(artifacts, edges.filter((e) => e.rel !== 'derives'));
    expect(ruleIds(g)).toEqual(['iec62304.srs-traces-sys:SRS-1']);
  });

  it('srs-verified: missing, failing, and stale tests', () => {
    const { artifacts, edges } = cleanChain();
    const noTest = graph(artifacts, edges.filter((e) => e.id !== link('VER-1', 'verifies', 'SRS-1').id));
    expect(ruleIds(noTest)).toEqual(['iec62304.srs-verified:SRS-1']);

    const failing = graph(artifacts.map((a) => (a.key === 'VER-1' ? { ...a, result: 'fail' as const } : a)), edges);
    const gap = evaluate(failing, IEC62304).gaps;
    expect(gap.map((x) => x.ruleId)).toEqual(['iec62304.srs-verified']);
    expect(gap[0].message).toContain('VER-1 failing');

    const stale = graph(artifacts.map((a) => (a.key === 'SRS-1' ? { ...a, version: 2 } : a)), edges);
    expect(evaluate(stale, IEC62304).gaps[0].message).toContain('older version');
  });

  it('srs-implemented: SRS with no implementation', () => {
    const { artifacts, edges } = cleanChain();
    const g = graph(artifacts, edges.filter((e) => e.fromId !== 'IMP-1'));
    expect(ruleIds(g)).toEqual(['iec62304.srs-implemented:SRS-1']);
  });

  it('class B SRS without design is a non-blocking warning; class C is blocking', () => {
    const { artifacts, edges } = cleanChain();
    const noDes = edges.filter((e) => e.rel !== 'designs');
    const asB = artifacts.map((a) => (a.key === 'SRS-1' ? { ...a, safetyClass: 'B' } : a));
    const b = evaluate(graph(asB, noDes), IEC62304).gaps;
    expect(b.map((x) => [x.ruleId, x.blocking])).toEqual([['iec62304.srs-designed', false]]);
    const c = evaluate(graph(artifacts, noDes), IEC62304).gaps;
    expect(c.map((x) => [x.ruleId, x.blocking])).toEqual([['iec62304.c-srs-detailed-design', true]]);
  });

  it('class A SRS needs no design item', () => {
    const { artifacts, edges } = cleanChain();
    const asA = artifacts.map((a) => (a.key === 'SRS-1' ? { ...a, safetyClass: 'A' } : a));
    expect(ruleIds(graph(asA, edges.filter((e) => e.rel !== 'designs')))).toEqual([]);
  });

  it('c-unit-verified: class C design item needs unit verification', () => {
    const { artifacts, edges } = cleanChain();
    const g = graph(artifacts, edges.filter((e) => e.fromId !== 'VER-2'));
    expect(ruleIds(g)).toEqual(['iec62304.c-unit-verified:DES-1']);
  });

  it('haz-controlled: hazard without risk control', () => {
    const g = graph([art('HAZ-9', 'HAZ')], []);
    expect(ruleIds(g)).toEqual(['iec62304.haz-controlled:HAZ-9']);
  });

  it('rc-in-srs and rc-verified: bare risk control', () => {
    const g = graph([art('HAZ-1', 'HAZ'), art('RC-9', 'RC')], [link('RC-9', 'mitigates', 'HAZ-1')]);
    expect(ruleIds(g).sort()).toEqual(['iec62304.rc-in-srs:RC-9', 'iec62304.rc-verified:RC-9']);
  });

  it('artifacts without a class inherit the default level', () => {
    const g = graph([art('DES-9', 'DES')], []);
    expect(ruleIds(g, IEC62304, 'C')).toEqual(['iec62304.c-unit-verified:DES-9']);
    expect(ruleIds(g, IEC62304, 'B')).toEqual([]);
  });

  it('reports clause coverage as passed over checked', () => {
    const { artifacts, edges } = cleanChain();
    const g = graph([...artifacts, art('HAZ-9', 'HAZ')], edges);
    const c72 = evaluate(g, IEC62304).coverage.find((c) => c.clause === '7.2')!;
    expect(c72).toMatchObject({ checked: 3, passed: 2, percent: 67 });
    expect(evaluate(g, IEC62304).coverage.find((c) => c.clause === '7.4')!.percent).toBeNull();
  });
});

describe('ISO 26262 light pack', () => {
  it('QM requirement needs a test but not a system trace', () => {
    const g = graph([art('SRS-1', 'SRS', { safetyClass: 'QM' })], []);
    expect(ruleIds(g, ISO26262)).toEqual(['iso26262.srs-verified:SRS-1']);
  });
  it('ASIL D design item needs unit verification', () => {
    const g = graph([art('DES-1', 'DES', { safetyClass: 'D' })], []);
    expect(ruleIds(g, ISO26262)).toEqual(['iso26262.unit-verified:DES-1']);
  });
  it('hazardous event needs a safety requirement', () => {
    expect(ruleIds(graph([art('HAZ-1', 'HAZ', { safetyClass: 'B' })], []), ISO26262)).toEqual(['iso26262.haz-goal:HAZ-1']);
  });
});

describe('DO-178C light pack', () => {
  it('level E has no objectives', () => {
    expect(ruleIds(graph([art('SRS-1', 'SRS', { safetyClass: 'E' })], []), DO178C)).toEqual([]);
  });
  it('level A high-level requirement needs trace, low-level requirement and test', () => {
    const g = graph([art('SRS-1', 'SRS', { safetyClass: 'A' }), ver('VER-1')], [link('VER-1', 'verifies', 'SRS-1')]);
    expect(ruleIds(g, DO178C).sort()).toEqual([
      'do178c.hlr-has-llr:SRS-1',
      'do178c.hlr-implemented:SRS-1',
      'do178c.hlr-traces-sys:SRS-1',
    ]);
  });
});
