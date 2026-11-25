import { edgeId } from '../domain/graph';
import { ArtifactKind, Edge, Relation, VerificationResult } from '../domain/types';
import type { Settings } from '../storage/settings';

/**
 * Pure mapping from Jira / Confluence REST payloads to Traceline artifacts and
 * edges. No Forge imports, so it is unit-testable.
 */

export const jiraId = (issueId: string | number) => `jira:${issueId}`;
export const pageId = (id: string | number) => `confluence:${id}`;

export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary?: string;
    description?: unknown;
    issuetype?: { name?: string };
    labels?: string[];
    fixVersions?: { name: string }[];
    status?: { name?: string; statusCategory?: { key?: string } };
    issuelinks?: JiraLink[];
  };
  properties?: { traceline?: TracelineIssueProperty };
}

export interface JiraLink {
  id: string;
  type: { name: string; inward: string; outward: string };
  inwardIssue?: { id: string; key: string };
  outwardIssue?: { id: string; key: string };
}

export interface RemoteLink {
  id: number;
  globalId?: string;
  relationship?: string;
  object?: { url?: string; title?: string };
}

/** Stored on each issue as the `traceline` entity property. */
export interface TracelineIssueProperty {
  safetyClass?: string;
  result?: VerificationResult;
  resultAgainst?: Record<string, number>;
  sample?: boolean;
  paths?: string[];
}

const lc = (s?: string) => (s ?? '').trim().toLowerCase();

export function kindOfIssue(issue: JiraIssue, s: Settings): ArtifactKind | undefined {
  const labels = (issue.fields.labels ?? []).map(lc);
  // Labels win: they are explicit.
  for (const [kind, label] of Object.entries(s.kindLabels)) if (label && labels.includes(lc(label))) return kind as ArtifactKind;
  const type = lc(issue.fields.issuetype?.name);
  for (const kind of ['SRS', 'HAZ', 'RC', 'VER', 'IMP'] as ArtifactKind[]) {
    if ((s.issueTypes[kind] ?? []).some((t) => lc(t) === type)) return kind;
  }
  return undefined;
}

export function safetyClassOf(issue: JiraIssue): string | undefined {
  const fromProp = issue.properties?.traceline?.safetyClass;
  if (fromProp) return fromProp.toUpperCase();
  for (const l of issue.fields.labels ?? []) {
    const m = /^(?:class|asil|dal)-([a-e]|qm)$/i.exec(l);
    if (m) return m[1].toUpperCase();
  }
  return undefined;
}

export function relationOfLinkType(typeName: string, s: Settings): Relation | undefined {
  const t = lc(typeName);
  for (const [rel, name] of Object.entries(s.linkTypes)) if (lc(name) === t) return rel as Relation;
  return undefined;
}

/**
 * Edges from an issue's links. A link listed on issue X with `outwardIssue` Y
 * reads "X <outward verb> Y" (e.g. "X verifies Y"), so X is downstream.
 * With `inwardIssue` Y it reads "X <inward verb> Y" ("X is verified by Y"), so Y is downstream.
 */
export function edgesFromIssueLinks(issue: JiraIssue, s: Settings, now: string): { edge: Edge; otherIssueId: string }[] {
  const out: { edge: Edge; otherIssueId: string }[] = [];
  for (const l of issue.fields.issuelinks ?? []) {
    const rel = relationOfLinkType(l.type.name, s);
    if (!rel) continue;
    const self = jiraId(issue.id);
    if (l.outwardIssue) {
      const up = jiraId(l.outwardIssue.id);
      out.push({ edge: { id: edgeId(self, rel, up), fromId: self, toId: up, rel, createdAt: now }, otherIssueId: l.outwardIssue.id });
    } else if (l.inwardIssue) {
      const down = jiraId(l.inwardIssue.id);
      out.push({ edge: { id: edgeId(down, rel, self), fromId: down, toId: self, rel, createdAt: now }, otherIssueId: l.inwardIssue.id });
    }
  }
  return out;
}

/** Remote links Traceline created to Confluence pages: globalId `traceline:<rel>:<pageId>:<direction>`. */
export function edgesFromRemoteLinks(issue: JiraIssue, links: RemoteLink[], now: string): { edge: Edge; pageId: string }[] {
  const out: { edge: Edge; pageId: string }[] = [];
  for (const rl of links) {
    const m = /^traceline:(derives|designs|implements|verifies|mitigates):(\d+):(up|down)$/.exec(rl.globalId ?? '');
    if (!m) continue;
    const rel = m[1] as Relation;
    const page = pageId(m[2]);
    const self = jiraId(issue.id);
    // "up": the page is upstream of the issue (SRS derives from SYS page). "down": page is downstream (DES page designs SRS).
    const [fromId, toId] = m[3] === 'up' ? [self, page] : [page, self];
    out.push({ edge: { id: edgeId(fromId, rel, toId), fromId, toId, rel, createdAt: now }, pageId: m[2] });
  }
  return out;
}

export function remoteLinkGlobalId(rel: Relation, confluencePageId: string, direction: 'up' | 'down') {
  return `traceline:${rel}:${confluencePageId}:${direction}`;
}

/** Text that defines an issue's content: changes to it bump the version. */
export function issueContent(issue: JiraIssue): string {
  return JSON.stringify([issue.fields.summary ?? '', issue.fields.description ?? null, safetyClassOf(issue) ?? '']);
}

export function pageKey(title: string, id: string): string {
  const m = /^([A-Z][A-Z0-9]*-\d+)\b/.exec(title.trim());
  return m ? m[1] : `PAGE-${id}`;
}

export function pageKind(labels: string[], s: Settings): ArtifactKind | undefined {
  const ls = labels.map(lc);
  for (const [kind, label] of Object.entries(s.pageLabels)) if (label && ls.includes(lc(label))) return kind as ArtifactKind;
  return undefined;
}

/** Small, stable, dependency-free hash (FNV-1a 64 as hex) for content change detection. */
export function contentHash(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/** Plain text from an Atlassian Document Format node. */
export function adfToText(node: unknown): string {
  if (!node || typeof node !== 'object') return typeof node === 'string' ? node : '';
  const n = node as { text?: string; content?: unknown[] };
  return (n.text ?? '') + (n.content ?? []).map(adfToText).join(n.content && n.content.length > 1 ? ' ' : '');
}

export function textToAdf(text: string) {
  return {
    type: 'doc',
    version: 1,
    content: text.split('\n\n').map((p) => ({ type: 'paragraph', content: p ? [{ type: 'text', text: p }] : [] })),
  };
}
