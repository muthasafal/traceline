import React from 'react';
import { openUrl } from './api';

export type Tone = 'ok' | 'warn' | 'bad' | 'neutral';

export interface ChainNode {
  id: string;
  key: string;
  ref?: string;
  title: string;
  position: 'upstream' | 'self' | 'downstream';
  status: { text: string; tone: Tone; suspect?: { reason: string } };
  url?: string;
}

export interface ChainColumn {
  kind: string;
  label: string;
  nodes: ChainNode[];
}

export function Lozenge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`tl-lozenge ${tone}`}>{children}</span>;
}

/** Horizontal, readable chain: SYS → HAZ → RC → SRS → DES → IMP → VER. Suspect nodes pulse once, then stay marked. */
export function Chain({ columns }: { columns: ChainColumn[] }) {
  return (
    <div className="tl-chain" role="list" aria-label="Trace chain">
      {columns.map((c, i) => (
        <React.Fragment key={c.kind}>
          <div className="tl-chain-col" role="listitem" aria-label={c.label}>
            <div className="tl-chain-col-label">{c.label}</div>
            {c.nodes.map((n) => {
              const suspect = !!n.status.suspect;
              return (
                <a
                  key={n.id}
                  href={n.url ?? '#'}
                  onClick={(e) => {
                    e.preventDefault();
                    if (n.url) openUrl(n.url);
                  }}
                  className={`tl-node${n.position === 'self' ? ' self' : ''}${suspect ? ' suspect' : ''}`}
                  title={suspect ? n.status.suspect!.reason : n.title}
                  aria-label={`${c.label} ${n.key}${n.ref ? ` (${n.ref})` : ''}: ${n.status.text}`}
                >
                  <div>
                    <span className="tl-node-key">{n.key}</span>
                    {n.ref && n.ref !== n.key ? <span className="tl-node-ref">{n.ref}</span> : null}
                  </div>
                  <div className="tl-node-title">{n.title.replace(/^\[[A-Z]+-\d+\]\s*/, '')}</div>
                  <Lozenge tone={n.status.tone}>{n.status.text}</Lozenge>
                </a>
              );
            })}
          </div>
          {i < columns.length - 1 ? (
            <div className="tl-chain-gap" aria-hidden="true">
              →
            </div>
          ) : null}
        </React.Fragment>
      ))}
    </div>
  );
}
