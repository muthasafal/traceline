import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../shared/ui.css';
import './matrix.css';
import { call, download, enableTheme, openUrl } from '../../shared/api';
import { Lozenge, Tone } from '../../shared/Chain';
import { dhfPdf, evidenceCsv, Matrix, matrixCsv, Ref, Row } from './dhf';

type RefWithUrl = Ref & { url?: string; tone?: Tone };

/** Which links each row type is expected to have; others show a neutral dash when empty. */
const EXPECTED: Record<string, Record<string, boolean>> = {
  SRS: { 'System requirement': true, 'Hazard and risk control': false, Design: true, Implementation: true, Verification: true },
  RC: { 'System requirement': false, 'Hazard and risk control': true, Design: false, Implementation: true, Verification: true },
};

function Refs({ items, column, row }: { items: RefWithUrl[]; column: string; row: Row }) {
  if (!items.length) {
    return EXPECTED[row.kind]?.[column] ? (
      <span className="missing" aria-label={`${column} for ${row.key}: none linked`}>none</span>
    ) : (
      <span className="tl-muted" aria-label={`${column} for ${row.key}: not applicable`}>–</span>
    );
  }
  return (
    <ul className="refs" aria-label={`${column} for ${row.key}`}>
      {items.map((r, i) => (
        <li key={i}>
          {r.url ? (
            <a href={r.url} onClick={(e) => { e.preventDefault(); openUrl(r.url!); }} title={r.title}>{r.key}</a>
          ) : (
            <span title={r.title}>{r.key}</span>
          )}
          {r.ref && r.ref !== r.key ? <span className="tl-muted"> {r.ref}</span> : null}
          {r.status && column === 'Verification' ? <> <Lozenge tone={r.tone ?? 'neutral'}>{r.status}</Lozenge></> : null}
        </li>
      ))}
    </ul>
  );
}

function App() {
  const [m, setM] = useState<Matrix>();
  const [error, setError] = useState<string>();
  const [level, setLevel] = useState('all');
  const [status, setStatus] = useState('all');
  const [clause, setClause] = useState('all');
  const [exporting, setExporting] = useState(false);

  const load = async (release?: string) => {
    try {
      setError(undefined);
      setM(await call<Matrix>('getMatrix', release ? { release } : {}));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => { enableTheme(); load(); }, []);

  const rows = useMemo(() => {
    if (!m) return [];
    return m.rows.filter((r) =>
      (level === 'all' || r.level === level) &&
      (status === 'all' || (status === 'gaps' && r.gaps.length > 0) || (status === 'suspect' && r.suspect) || (status === 'ok' && !r.gaps.length && !r.suspect)) &&
      (clause === 'all' || r.gaps.some((g) => g.clause === clause)),
    );
  }, [m, level, status, clause]);

  if (error) return <main className="matrix"><p className="tl-lozenge bad" style={{ textTransform: 'none' }}>{error}</p></main>;
  if (!m) return <main className="matrix"><p className="tl-muted">Loading the traceability matrix…</p></main>;

  const stamp = m.generatedAt.slice(0, 10);
  const relName = m.release === '*' ? 'all' : m.release;
  const withGaps = m.rows.filter((r) => r.gaps.length).length;

  return (
    <main className="matrix">
      <header className="matrix-head">
        <div className="tl-stack" style={{ gap: 2 }}>
          <h2 style={{ margin: 0 }}>Traceability matrix</h2>
          <p className="tl-muted">
            {m.standard.name} · {m.rows.length} requirements and risk controls · {withGaps} with gaps ·{' '}
            <Lozenge tone={m.gate.green ? 'ok' : 'bad'}>{m.gate.green ? 'release ready' : 'not ready'}</Lozenge>
          </p>
        </div>
        <div className="tl-row">
          <button className="tl-btn" disabled={exporting} onClick={() => download(`traceability-${relName}-${stamp}.csv`, matrixCsv(m, rows), 'text/csv')}>Matrix CSV</button>
          <button className="tl-btn" disabled={exporting} onClick={() => download(`evidence-${relName}-${stamp}.csv`, evidenceCsv(m), 'text/csv')}>Evidence CSV</button>
          <button className="tl-btn primary" disabled={exporting} onClick={async () => {
            setExporting(true);
            try { download(`DHF-traceability-${relName}-${stamp}.pdf`, await dhfPdf(m, rows), 'application/pdf'); } finally { setExporting(false); }
          }}>{exporting ? 'Building PDF…' : 'Export DHF (PDF)'}</button>
        </div>
      </header>

      <div className="tl-row filters" role="group" aria-label="Filters">
        <label>Release
          <select className="tl-select" value={m.release} onChange={(e) => load(e.target.value)}>
            <option value="*">All</option>
            {m.releases.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label>{m.standard.levelName}
          <select className="tl-select" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="all">All</option>
            {m.standard.levels.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label>Status
          <select className="tl-select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All</option>
            <option value="gaps">Has gaps</option>
            <option value="suspect">Suspect links</option>
            <option value="ok">No gaps</option>
          </select>
        </label>
        <label>Clause
          <select className="tl-select" value={clause} onChange={(e) => setClause(e.target.value)}>
            <option value="all">All</option>
            {m.clauses.map((c) => <option key={c.id} value={c.id}>§{c.id} {c.title}</option>)}
          </select>
        </label>
        <span className="tl-muted tl-small" aria-live="polite">Showing {rows.length} of {m.rows.length}</span>
      </div>

      <div className="matrix-scroll">
        <table className="tl-table">
          <caption className="tl-sr">Traceability from system requirements to verification. Rows with gaps are marked.</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">System requirement</th>
              <th scope="col">Hazard and risk control</th>
              <th scope="col">Design</th>
              <th scope="col">Implementation</th>
              <th scope="col">Verification</th>
              <th scope="col">Gaps</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={r.gaps.length ? 'gap' : ''}>
                <th scope="row">
                  <a href={(r as RefWithUrl).url} onClick={(e) => { e.preventDefault(); const u = (r as RefWithUrl).url; if (u) openUrl(u); }}>{r.key}</a>
                  {r.ref ? <span className="tl-muted"> {r.ref}</span> : null}
                  <div className="row-title">{r.title.replace(/^\[[A-Z]+-\d+\]\s*/, '')}</div>
                  <div className="tl-row" style={{ gap: 4 }}>
                    <Lozenge tone="neutral">{r.kind === 'RC' ? 'risk control' : `class ${r.level}`}</Lozenge>
                    {r.suspect ? <Lozenge tone="bad">suspect</Lozenge> : null}
                  </div>
                </th>
                <td><Refs items={r.system} column="System requirement" row={r} /></td>
                <td><Refs items={r.risk} column="Hazard and risk control" row={r} /></td>
                <td><Refs items={r.design} column="Design" row={r} /></td>
                <td><Refs items={r.implementation} column="Implementation" row={r} /></td>
                <td><Refs items={r.verification} column="Verification" row={r} /></td>
                <td>
                  {r.gaps.length ? (
                    <ul className="refs" aria-label={`Gaps for ${r.key}`}>
                      {r.gaps.map((g, i) => <li key={i}><Lozenge tone={g.blocking ? 'bad' : 'warn'}>§{g.clause}</Lozenge> {g.message}</li>)}
                    </ul>
                  ) : <Lozenge tone="ok">no gaps</Lozenge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length ? <p className="tl-muted" style={{ padding: 12 }}>No rows match these filters.</p> : null}
      </div>
      <p className="tl-small tl-muted">Live from Jira and Confluence via Traceline. Generated {m.generatedAt.replace('T', ' ').slice(0, 16)} UTC.</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
