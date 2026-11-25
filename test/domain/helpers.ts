import { edgeId, TraceGraph } from '../../src/domain/graph';
import { Artifact, ArtifactKind, Edge, Relation, Suspect, VerificationResult } from '../../src/domain/types';

export const T0 = '2026-12-01T10:00:00.000Z';

export function art(key: string, kind: ArtifactKind, extra: Partial<Artifact> = {}): Artifact {
  return { id: key, key, kind, source: 'jira', sourceId: key, title: key, version: 1, updatedAt: T0, ...extra };
}

export function ver(key: string, result: VerificationResult = 'pass', extra: Partial<Artifact> = {}): Artifact {
  return art(key, 'VER', { result, ...extra });
}

export function link(from: string, rel: Relation, to: string, verifiedAgainstVersion: number | null = 1): Edge {
  return { id: edgeId(from, rel, to), fromId: from, toId: to, rel, createdAt: T0, verifiedAgainstVersion: verifiedAgainstVersion ?? undefined };
}

export function graph(artifacts: Artifact[], edges: Edge[], suspects: Suspect[] = []) {
  return new TraceGraph(artifacts, edges, suspects);
}

/** A complete, gap-free Class C chain: SYS-1 <- SRS-1 <- DES-1, IMP-1, VER-1, VER-2(unit); HAZ-1 <- RC-1 <- SRS-1, VER-3. */
export function cleanChain() {
  const artifacts = [
    art('SYS-1', 'SYS'),
    art('SRS-1', 'SRS', { safetyClass: 'C' }),
    art('DES-1', 'DES', { safetyClass: 'C' }),
    art('IMP-1', 'IMP', { status: 'Done' }),
    ver('VER-1'),
    ver('VER-2'),
    art('HAZ-1', 'HAZ'),
    art('RC-1', 'RC', { safetyClass: 'C' }),
    ver('VER-3'),
  ];
  const edges = [
    link('SRS-1', 'derives', 'SYS-1'),
    link('DES-1', 'designs', 'SRS-1'),
    link('IMP-1', 'implements', 'SRS-1'),
    link('VER-1', 'verifies', 'SRS-1'),
    link('VER-2', 'verifies', 'DES-1'),
    link('RC-1', 'mitigates', 'HAZ-1'),
    link('SRS-1', 'implements', 'RC-1'),
    link('VER-3', 'verifies', 'RC-1'),
  ];
  return { artifacts, edges };
}
