import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { evaluateGate } from '../../src/domain/gate';
import { TraceGraph } from '../../src/domain/graph';
import { IEC62304 } from '../../src/domain/packs';
import { sampleGraphData } from '../../src/domain/sample';
import { detectSuspects } from '../../src/domain/suspect';
import { buildRows } from '../../src/sync/publish';
import { dhfPdf, evidenceCsv, Matrix, matrixCsv } from '../../static/matrix/src/dhf';

const T = '2026-12-12T09:00:00.000Z';

function sampleMatrix(): Matrix {
  const { artifacts, edges } = sampleGraphData(T);
  const base = new TraceGraph(artifacts.map((a) => ({ ...a, source: 'jira' as const })), edges);
  const g = base.with({ suspects: detectSuspects(base, T) });
  const gate = evaluateGate(g, IEC62304, '*', T, 'C');
  const rows = buildRows(g, [...gate.blocking, ...gate.warnings], 'iec62304', 'C', T);
  return {
    standard: { id: 'iec62304', name: IEC62304.name, basis: IEC62304.basis, levelName: IEC62304.levelName, levels: [...IEC62304.levels] },
    clauses: [...IEC62304.clauses],
    releases: ['v2.3'],
    release: '*',
    gate: { green: gate.green, summary: gate.summary },
    rows: rows.map((r) => ({ ...r, visible: true })) as unknown as Matrix['rows'],
    evidence: [{ key: 'VER-001', title: 'Test', kind: 'test-result', result: 'pass', at: T, againstVersion: 1, recordedBy: 'acc' }],
    generatedAt: T,
  };
}

describe('DHF export', () => {
  it('publishes one row per software requirement and risk control, with the planned gaps', () => {
    const m = sampleMatrix();
    expect(m.rows).toHaveLength(40);
    expect(m.rows.filter((r) => r.gaps.length).map((r) => r.key).sort()).toEqual(['RC-010', 'SRS-004', 'SRS-021', 'SRS-027', 'SRS-030']);
    expect(m.rows.find((r) => r.key === 'SRS-004')!.suspect).toBe(true);
  });

  it('builds a valid multi-page PDF', async () => {
    const m = sampleMatrix();
    const bytes = await dhfPdf(m, m.rows);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
  });

  it('builds CSVs with a header and one line per row, quoting commas', () => {
    const m = sampleMatrix();
    const csv = matrixCsv(m, m.rows);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toMatch(/^Item,Reference,Type/);
    expect(lines).toHaveLength(41);
    expect(evidenceCsv(m).split('\r\n')[1]).toContain('VER-001');
  });
});
