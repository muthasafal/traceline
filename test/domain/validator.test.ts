import { describe, expect, it } from 'vitest';
import { IEC62304 } from '../../src/domain/packs';
import { canComplete } from '../../src/domain/validator';
import { art, cleanChain, graph, link, ver } from './helpers';

describe('workflow validator', () => {
  it('allows Done when every implemented class C requirement has a passing test', () => {
    const { artifacts, edges } = cleanChain();
    expect(canComplete(graph(artifacts, edges), IEC62304, 'IMP-1', ['B', 'C'])).toMatchObject({ allowed: true, checked: ['SRS-1'] });
  });

  it('blocks Done and says exactly what is missing', () => {
    const { artifacts, edges } = cleanChain();
    const g = graph(artifacts.map((a) => (a.key === 'VER-1' ? { ...a, result: 'fail' as const } : a)), edges);
    const d = canComplete(g, IEC62304, 'IMP-1', ['B', 'C']);
    expect(d.allowed).toBe(false);
    expect(d.message).toContain('SRS-1 (software safety class C): VER-1 failing');
  });

  it('ignores class A requirements', () => {
    const g = graph([art('SRS-1', 'SRS', { safetyClass: 'A' }), art('IMP-1', 'IMP')], [link('IMP-1', 'implements', 'SRS-1')]);
    expect(canComplete(g, IEC62304, 'IMP-1', ['B', 'C']).allowed).toBe(true);
  });

  it('blocks on a stale verification', () => {
    const g = graph(
      [art('SRS-1', 'SRS', { version: 3 }), art('IMP-1', 'IMP'), ver('VER-1')],
      [link('IMP-1', 'implements', 'SRS-1', 3), link('VER-1', 'verifies', 'SRS-1', 2)],
    );
    expect(canComplete(g, IEC62304, 'IMP-1', ['B', 'C'], 'C').message).toMatch(/older version/);
  });

  it('allows unknown issues (not traced)', () => {
    expect(canComplete(graph([], []), IEC62304, 'X-1', ['C']).allowed).toBe(true);
  });
});
