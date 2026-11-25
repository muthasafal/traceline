import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from 'pdf-lib';

export interface Ref { key: string; ref?: string; title: string; status: string; visible: boolean }
export interface Row extends Ref {
  kind: string;
  level: string;
  version: number;
  system: Ref[];
  risk: Ref[];
  design: Ref[];
  implementation: Ref[];
  verification: Ref[];
  gaps: { clause: string; message: string; blocking: boolean }[];
  suspect: boolean;
}
export interface Evidence { key: string; ref?: string; title?: string; kind: string; result: string; at: string; againstVersion: number | null; recordedBy: string | null }
export interface Matrix {
  standard: { id: string; name: string; basis: string; levelName: string; levels: string[] };
  clauses: { id: string; title: string }[];
  releases: string[];
  release: string;
  gate: { green: boolean; summary: string };
  rows: Row[];
  evidence: Evidence[];
  generatedAt: string;
}

const label = (r: Ref) => (r.ref && r.ref !== r.key ? `${r.key} (${r.ref})` : r.key);
export const cellText = (refs: Ref[]) => refs.map(label).join(', ');

// ---------- CSV ----------
const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

export function matrixCsv(m: Matrix, rows: Row[]) {
  return csv([
    ['Item', 'Reference', 'Type', m.standard.levelName, 'Version', 'Title', 'Status', 'System requirements', 'Hazards and risk controls', 'Design', 'Implementation', 'Verification', 'Gaps'],
    ...rows.map((r) => [
      r.key, r.ref ?? '', r.kind === 'RC' ? 'Risk control' : 'Software requirement', r.level, r.version, r.title, r.status,
      cellText(r.system), cellText(r.risk), cellText(r.design), cellText(r.implementation),
      r.verification.map((v) => `${label(v)} [${v.status}]`).join(', '),
      r.gaps.map((g) => `§${g.clause} ${g.message}`).join(' | '),
    ]),
  ]);
}

export function evidenceCsv(m: Matrix) {
  return csv([
    ['Item', 'Reference', 'Title', 'Evidence', 'Result', 'Recorded at (UTC)', 'Against version', 'Recorded by (account id)'],
    ...m.evidence.map((e) => [e.key, e.ref ?? '', e.title ?? '', e.kind, e.result, e.at, e.againstVersion ?? '', e.recordedBy ?? '']),
  ]);
}

// ---------- PDF ----------
/** Standard PDF fonts only cover WinAnsi; map common symbols and drop the rest. */
function ansi(s: string) {
  return s
    .replace(/[→⇒]/g, '->')
    .replace(/[≥]/g, '>=')
    .replace(/[≤]/g, '<=')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = ansi(text).split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= width) line = next;
    else {
      if (line) lines.push(line);
      line = w;
      while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

export async function dhfPdf(m: Matrix, rows: Row[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Design History File - traceability ${m.release === '*' ? 'whole project' : m.release}`);
  doc.setProducer('Traceline (Atlassian Forge)');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 842, H = 595, M = 36; // A4 landscape
  const ink = rgb(0.09, 0.17, 0.3), muted = rgb(0.27, 0.33, 0.44), red = rgb(0.68, 0.18, 0.14), line = rgb(0.85, 0.87, 0.9);
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;
  let pageNo = 1;

  const footer = () => {
    page.drawText(ansi(`Traceline · generated ${m.generatedAt.replace('T', ' ').slice(0, 19)} UTC from live Jira and Confluence data · page ${pageNo}`), { x: M, y: 18, size: 8, font, color: muted });
  };
  const newPage = () => { footer(); page = doc.addPage([W, H]); pageNo++; y = H - M; };
  const text = (s: string, opts: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; x?: number; width?: number } = {}) => {
    const size = opts.size ?? 10, f = opts.f ?? font, width = opts.width ?? W - 2 * M;
    for (const l of wrap(s, f, size, width)) {
      if (y < M + 20) newPage();
      page.drawText(l, { x: opts.x ?? M, y, size, font: f, color: opts.color ?? ink });
      y -= size + 4;
    }
  };

  // Cover summary
  text('Design History File: traceability record', { size: 20, f: bold });
  y -= 4;
  text(`Release: ${m.release === '*' ? 'whole project' : m.release}    Standard pack: ${m.standard.name}`, { size: 11, color: muted });
  text(m.standard.basis, { size: 9, color: muted });
  y -= 8;
  text(`Release gate: ${m.gate.green ? 'READY' : 'NOT READY'}. ${m.gate.summary}`, { size: 12, f: bold, color: m.gate.green ? rgb(0.12, 0.52, 0.35) : red });
  const gapCount = rows.reduce((n, r) => n + r.gaps.length, 0);
  text(`${rows.length} requirements and risk controls in this record; ${gapCount} open gap${gapCount === 1 ? '' : 's'}; ${rows.filter((r) => r.suspect).length} with suspect links; ${m.evidence.length} evidence records.`);
  text('Clause references are a working aid that follows the structure of the published standard; they are not a copy of it.', { size: 8, color: muted });
  y -= 10;

  // Matrix table
  const cols = [
    { h: 'Item', w: 92 }, { h: m.standard.levelName.replace('Software safety class', 'Class'), w: 34 }, { h: 'System req.', w: 82 },
    { h: 'Hazard / risk control', w: 112 }, { h: 'Design', w: 74 }, { h: 'Implementation', w: 92 }, { h: 'Verification', w: 128 }, { h: 'Gaps', w: W - 2 * M - 614 },
  ];
  const header = () => {
    let x = M;
    for (const c of cols) { page.drawText(ansi(c.h), { x, y, size: 8, font: bold, color: muted }); x += c.w; }
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: line });
    y -= 10;
  };
  text('Traceability matrix', { size: 13, f: bold });
  header();
  for (const r of rows) {
    const cells = [
      `${label(r)}${r.suspect ? ' (suspect)' : ''} v${r.version}`,
      r.level,
      cellText(r.system),
      cellText(r.risk),
      cellText(r.design),
      cellText(r.implementation),
      r.verification.map((v) => `${label(v)}: ${v.status}`).join(', '),
      r.gaps.map((g) => `§${g.clause} ${g.message}`).join(' '),
    ];
    const wrapped = cells.map((c, i) => wrap(c || '-', font, 7, cols[i].w - 6));
    const h = Math.max(...wrapped.map((w) => w.length)) * 9 + 4;
    if (y - h < M + 20) { newPage(); header(); }
    let x = M;
    wrapped.forEach((lines, i) => {
      lines.forEach((l, j) => page.drawText(l, { x, y: y - j * 9, size: 7, font: i === 0 ? bold : font, color: i === 7 && r.gaps.length ? red : ink }));
      x += cols[i].w;
    });
    y -= h;
    page.drawLine({ start: { x: M, y: y + 6 }, end: { x: W - M, y: y + 6 }, thickness: 0.5, color: line });
  }

  // Evidence list
  newPage();
  text('Verification evidence', { size: 13, f: bold });
  text('Each record is a test result captured in Traceline against a specific version of the item it verifies.', { size: 9, color: muted });
  y -= 4;
  for (const e of m.evidence) {
    text(`${e.at.replace('T', ' ').slice(0, 19)} UTC  ${e.key}${e.ref ? ` (${e.ref})` : ''}  ${e.kind}: ${e.result.toUpperCase()}${e.againstVersion !== null ? `  against version ${e.againstVersion}` : ''}${e.title ? `  - ${e.title}` : ''}`, { size: 8 });
  }
  if (!m.evidence.length) text('No verification results recorded yet.', { size: 9, color: muted });
  footer();
  return doc.save();
}
