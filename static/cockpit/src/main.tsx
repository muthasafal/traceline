import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../shared/ui.css';
import './cockpit.css';
import { call, enableTheme, openUrl } from '../../shared/api';
import { Chain, ChainColumn, Lozenge } from '../../shared/Chain';

interface GapRow { key: string; ref?: string; title?: string; kind: string; clause: string; blocking: boolean; message: string; url?: string }
interface Cockpit {
  standard: { id: string; name: string; basis: string; levelName: string; depth: string };
  releases: string[];
  release: string;
  gate: { green: boolean; summary: string; scopeSize: number; blocking: GapRow[]; warnings: GapRow[]; evaluatedAt: string };
  coverage: { clause: string; title: string; checked: number; passed: number; percent: number | null }[];
  gapsByKind: { kind: string; label: string; blocking: number; warnings: number }[];
  totals: { artifacts: number; gaps: number; blocking: number };
  suspects: { open: number; timeline: { day: string; opened: number }[] };
  snapshots: { id: number; release: string; at: string; green: boolean }[];
  note?: string;
}
interface Status {
  sample: { status: string; step?: string; progress?: number; message?: string; projectKey?: string; spaceKey?: string };
  sampleProjectKey: string;
}
interface ChainResult { found: boolean; key?: string; summary?: string; columns?: ChainColumn[]; note?: string }
interface Owners { answer: string; source?: string; people?: { name: string; role: string; via: string; teams: number }[]; hint?: string }

const fmtDate = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function Gate({ data, onSnapshot, busy }: { data: Cockpit; onSnapshot: () => void; busy: boolean }) {
  const [showWarnings, setShowWarnings] = useState(false);
  const rel = data.release === '*' ? 'the whole project' : data.release;
  return (
    <section className={`tl-card cockpit-gate ${data.gate.green ? 'green' : 'red'}`} aria-labelledby="gate-h">
      <div className="gate-head">
        <div className={`gate-badge ${data.gate.green ? 'green' : 'red'}`} aria-hidden="true">{data.gate.green ? '✓' : '✕'}</div>
        <div className="tl-stack" style={{ gap: 4 }}>
          <h2 id="gate-h" style={{ margin: 0 }}>Can we ship {rel}?</h2>
          <p className="gate-summary">{data.gate.summary}</p>
          <p className="tl-small tl-muted">
            Checked {data.gate.scopeSize} artifacts against {data.standard.name} at {fmtDate(data.gate.evaluatedAt)}.
          </p>
        </div>
        <button className="tl-btn" onClick={onSnapshot} disabled={busy}>Snapshot for audit trail</button>
      </div>
      {data.gate.blocking.length ? (
        <ul className="gap-list" aria-label="Blocking items">
          {data.gate.blocking.map((g, i) => (
            <li key={i}>
              <Lozenge tone="bad">§{g.clause}</Lozenge>
              <div>
                {g.url ? (
                  <a href={g.url} onClick={(e) => { e.preventDefault(); openUrl(g.url!); }}>{g.key}</a>
                ) : (
                  <strong>{g.key}</strong>
                )}
                {g.ref ? <span className="tl-muted"> {g.ref}</span> : null} <span className="tl-muted">· {g.kind}</span>
                <p>{g.message}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {data.gate.warnings.length ? (
        <div>
          <button className="tl-btn subtle" aria-expanded={showWarnings} onClick={() => setShowWarnings(!showWarnings)}>
            {showWarnings ? 'Hide' : 'Show'} {data.gate.warnings.length} warning{data.gate.warnings.length === 1 ? '' : 's'} that do not block release
          </button>
          {showWarnings ? (
            <ul className="gap-list">
              {data.gate.warnings.map((g, i) => (
                <li key={i}><Lozenge tone="warn">§{g.clause}</Lozenge><div><strong>{g.key}</strong><p>{g.message}</p></div></li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {data.note ? <p className="tl-small tl-muted">{data.note}</p> : null}
    </section>
  );
}

function Coverage({ data }: { data: Cockpit }) {
  return (
    <section className="tl-card" aria-labelledby="cov-h">
      <h2 id="cov-h">Coverage by clause</h2>
      <p className="tl-small tl-muted" style={{ marginBottom: 12 }}>{data.standard.basis}</p>
      <div className="tl-stack" style={{ gap: 12 }}>
        {data.coverage.map((c) => (
          <div key={c.clause}>
            <div className="tl-row" style={{ justifyContent: 'space-between' }}>
              <span><strong>§{c.clause}</strong> {c.title}</span>
              <span className="tl-muted">{c.percent === null ? 'not checked' : `${c.percent}%`}</span>
            </div>
            <div className={`tl-bar ${c.percent !== null && c.percent < 80 ? (c.percent < 50 ? 'low' : 'mid') : ''}`} role="img"
              aria-label={c.percent === null ? `Clause ${c.clause}: nothing in scope` : `Clause ${c.clause}: ${c.passed} of ${c.checked} checks pass`}>
              <span style={{ width: `${c.percent ?? 0}%` }} />
            </div>
            <p className="tl-small tl-muted">{c.percent === null ? 'Nothing in scope is checked under this clause.' : `${c.passed} of ${c.checked} checks pass.`}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function GapsByType({ data }: { data: Cockpit }) {
  return (
    <section className="tl-card" aria-labelledby="gbt-h">
      <h2 id="gbt-h">Gaps by type</h2>
      {data.gapsByKind.length === 0 ? (
        <p className="tl-muted">No gaps across {data.totals.artifacts} tracked artifacts.</p>
      ) : (
        <>
          <p className="tl-muted" style={{ marginBottom: 8 }}>
            {data.totals.gaps} gap{data.totals.gaps === 1 ? '' : 's'} across {data.totals.artifacts} artifacts; {data.totals.blocking} block release.
          </p>
          <table className="tl-table">
            <thead><tr><th>Type</th><th>Blocking</th><th>Warnings</th></tr></thead>
            <tbody>
              {data.gapsByKind.map((g) => (
                <tr key={g.kind}><td>{g.label}</td><td>{g.blocking}</td><td>{g.warnings}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function SuspectTimeline({ data }: { data: Cockpit }) {
  const days = data.suspects.timeline.slice(-30);
  const max = Math.max(1, ...days.map((d) => d.opened));
  const W = 320, H = 96, bw = days.length ? Math.min(24, (W - 8) / days.length - 4) : 0;
  return (
    <section className="tl-card" aria-labelledby="sus-h">
      <h2 id="sus-h">Suspect links over time</h2>
      <p className="tl-muted" style={{ marginBottom: 8 }}>
        {data.suspects.open} open now. A link turns suspect when its upstream item changes after it was verified.
      </p>
      {days.length ? (
        <svg viewBox={`0 0 ${W} ${H + 18}`} width="100%" role="img" aria-label={days.map((d) => `${d.day}: ${d.opened} opened`).join('; ')}>
          {days.map((d, i) => {
            const h = Math.max(2, (d.opened / max) * H);
            const x = 4 + i * (bw + 4);
            return (
              <g key={d.day}>
                <rect x={x} y={H - h} width={bw} height={h} rx={2} fill="var(--tl-bad-bold)" />
                <text x={x + bw / 2} y={H - h - 3} fontSize="10" textAnchor="middle" fill="var(--tl-subtle)">{d.opened}</text>
                {days.length <= 10 || i % Math.ceil(days.length / 6) === 0 ? (
                  <text x={x + bw / 2} y={H + 13} fontSize="10" textAnchor="middle" fill="var(--tl-subtlest)">{d.day.slice(5)}</text>
                ) : null}
              </g>
            );
          })}
        </svg>
      ) : (
        <p className="tl-small tl-muted">No suspect links recorded yet.</p>
      )}
    </section>
  );
}

function Explorer() {
  const [key, setKey] = useState('');
  const [res, setRes] = useState<ChainResult>();
  const [owners, setOwners] = useState<Owners>();
  const [busy, setBusy] = useState(false);
  const go = async (k: string) => {
    if (!k.trim()) return;
    setBusy(true);
    setOwners(undefined);
    try {
      setRes(await call<ChainResult>('getChain', { key: k }));
      call<Owners>('getOwners', { key: k }).then(setOwners).catch(() => setOwners({ answer: 'Owner lookup is unavailable right now.' }));
    } finally { setBusy(false); }
  };
  return (
    <section className="tl-card" aria-labelledby="ex-h">
      <h2 id="ex-h">Trace any item</h2>
      <form className="tl-row" onSubmit={(e) => { e.preventDefault(); go(key); }}>
        <label htmlFor="ex-key" className="tl-sr">Issue key or reference</label>
        <input id="ex-key" className="tl-input" placeholder="PUMP-4 or SRS-004" value={key} onChange={(e) => setKey(e.target.value)} />
        <button className="tl-btn primary" disabled={busy || !key.trim()}>Show trace</button>
      </form>
      {res && !res.found ? <p className="tl-muted" style={{ marginTop: 8 }}>Traceline does not track {res.key}, or you cannot view it.</p> : null}
      {res && res.found ? (
        <div style={{ marginTop: 12 }}>
          <p style={{ marginBottom: 8 }}>{res.summary}</p>
          <Chain columns={res.columns!} />
          {res.note ? <p className="tl-small tl-muted">{res.note}</p> : null}
          <div className="owners" aria-live="polite">
            <h3>Who signs off</h3>
            {!owners ? <p className="tl-muted">Asking the Teamwork Graph…</p> : (
              <>
                <p>{owners.answer}</p>
                {owners.people?.length ? (
                  <ul>
                    {owners.people.map((p, i) => (
                      <li key={i}><strong>{p.name}</strong> <span className="tl-muted">· {p.role} of {p.via}{p.teams ? ` · ${p.teams} team${p.teams === 1 ? '' : 's'}` : ''}</span></li>
                    ))}
                  </ul>
                ) : null}
                {owners.source ? (
                  <p className="tl-small tl-muted">Source: {owners.source === 'teamwork-graph' ? 'Teamwork Graph' : owners.source === 'mixed' ? 'Teamwork Graph and Jira/Confluence REST' : 'Jira/Confluence REST (fallback)'}</p>
                ) : null}
                {owners.hint ? <p className="tl-small hint">{owners.hint}</p> : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SampleCard({ status, refresh }: { status?: Status; refresh: () => void }) {
  const [confirm, setConfirm] = useState(false);
  if (!status) return null;
  const s = status.sample;
  const busy = s.status === 'running' || s.status === 'removing';
  const run = async (name: string) => { await call(name); refresh(); };
  return (
    <section className="tl-card" aria-labelledby="sample-h">
      <h2 id="sample-h">Sample project</h2>
      <p className="tl-muted" style={{ marginBottom: 8 }}>
        A clearly labelled sample: a fictional infusion pump controller (Class C) with deliberate gaps and one suspect link,
        in Jira project {status.sampleProjectKey} and a Confluence space.
      </p>
      {busy ? (
        <div className="tl-stack">
          <span>{s.step ?? 'Working'}…</span>
          <div className="tl-bar" role="progressbar" aria-valuenow={s.progress ?? 0} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${s.progress ?? 2}%`, background: 'var(--tl-brand)' }} />
          </div>
        </div>
      ) : null}
      {s.status === 'failed' ? <p className="tl-lozenge bad" style={{ textTransform: 'none' }}>{s.message}</p> : null}
      <div className="tl-row" style={{ marginTop: 8 }}>
        {s.status !== 'done' ? <button className="tl-btn primary" disabled={busy} onClick={() => run('loadSample')}>Load sample project</button> : null}
        {s.status === 'done' && !confirm ? <button className="tl-btn" disabled={busy} onClick={() => setConfirm(true)}>Remove sample data</button> : null}
        {confirm ? (
          <>
            <span>Delete every issue labelled traceline-sample, the {s.projectKey} project and the {s.spaceKey} space?</span>
            <button className="tl-btn primary danger" onClick={() => { setConfirm(false); run('removeSample'); }}>Remove</button>
            <button className="tl-btn subtle" onClick={() => setConfirm(false)}>Keep it</button>
          </>
        ) : null}
      </div>
    </section>
  );
}

function App() {
  const [data, setData] = useState<Cockpit>();
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [release, setRelease] = useState<string>();
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback(async (rel?: string) => {
    try {
      setError(undefined);
      const [c, s] = await Promise.all([call<Cockpit>('getCockpit', rel ? { release: rel } : {}), call<Status>('getStatus')]);
      setData(c);
      setStatus(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { enableTheme(); load(); }, [load]);
  useEffect(() => {
    const running = status && (status.sample.status === 'running' || status.sample.status === 'removing');
    if (running) timer.current = setTimeout(() => load(release), 4000);
    return () => clearTimeout(timer.current);
  }, [status, release, load]);

  if (error) return <main className="cockpit"><p className="tl-lozenge bad" style={{ textTransform: 'none' }}>{error}</p></main>;
  if (!data) return <main className="cockpit"><p className="tl-muted">Loading the trace graph…</p></main>;

  const empty = data.totals.artifacts === 0;
  return (
    <main className="cockpit">
      <header className="cockpit-head">
        <div className="tl-stack" style={{ gap: 2 }}>
          <h1>Compliance cockpit</h1>
          <p className="tl-muted">{data.standard.name} · living traceability from Jira and Confluence</p>
        </div>
        {!empty ? (
          <div className="tl-row">
            <label htmlFor="rel" className="tl-muted">Release</label>
            <select id="rel" className="tl-select" value={data.release}
              onChange={(e) => { setRelease(e.target.value); load(e.target.value); }}>
              {data.releases.map((r) => <option key={r} value={r}>{r}</option>)}
              <option value="*">Whole project</option>
            </select>
          </div>
        ) : null}
      </header>

      {empty ? (
        <section className="tl-card empty">
          <h2>Nothing is traced yet</h2>
          <p className="tl-muted">Load the sample project to see Traceline find gaps and a suspect link, or label your own issues
            tl-requirement, tl-hazard, tl-risk-control or tl-test and link them with Implements, Verifies, Mitigates or Derives.</p>
        </section>
      ) : (
        <>
          <Gate data={data} busy={busy} onSnapshot={async () => {
            setBusy(true);
            try { setData(await call<Cockpit>('takeSnapshot', { release: data.release })); } finally { setBusy(false); }
          }} />
          <div className="cockpit-grid">
            <Coverage data={data} />
            <div className="tl-stack" style={{ gap: 16 }}>
              <GapsByType data={data} />
              <SuspectTimeline data={data} />
            </div>
          </div>
          <Explorer />
          <section className="tl-card" aria-labelledby="snap-h">
            <h2 id="snap-h">Release gate snapshots</h2>
            {data.snapshots.length ? (
              <table className="tl-table">
                <thead><tr><th>When</th><th>Release</th><th>Result</th></tr></thead>
                <tbody>
                  {data.snapshots.map((s) => (
                    <tr key={s.id}><td>{fmtDate(s.at)}</td><td>{s.release}</td><td><Lozenge tone={s.green ? 'ok' : 'bad'}>{s.green ? 'ready' : 'not ready'}</Lozenge></td></tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="tl-muted">No snapshots yet. Take one before a release review; it is kept as audit evidence.</p>
            )}
          </section>
        </>
      )}
      <SampleCard status={status} refresh={() => load(release)} />
      <p className="tl-small tl-muted">Runs on Atlassian: Traceline stores and computes everything on Forge, with no external calls.</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
