import { TraceGraph } from '../domain/graph';
import { Artifact, ArtifactKind, Edge, Relation, Suspect, VerificationResult } from '../domain/types';
import { SqlClient } from './db';

interface ArtifactRow {
  id: string;
  kind: string;
  source: string;
  source_id: string;
  art_key: string;
  title: string;
  safety_class: string | null;
  version: number;
  content_hash: string | null;
  updated_at: string;
  status: string | null;
  result: string | null;
  result_against_version: number | null;
  releases: string | null;
  paths: string | null;
  sample: number;
}

interface EdgeRow {
  id: string;
  from_id: string;
  to_id: string;
  rel: string;
  created_at: string;
  verified_against_version: number | null;
}

interface SuspectRow {
  id: number;
  edge_id: string;
  reason: string;
  since: string;
  upstream_version: number;
  cleared_by: string | null;
  cleared_at: string | null;
  justification: string | null;
}

export interface StoredArtifact extends Artifact {
  contentHash?: string;
}

const json = (v: unknown) => (v === undefined ? null : JSON.stringify(v));
const parse = <T>(s: string | null): T | undefined => (s ? (JSON.parse(s) as T) : undefined);
const nn = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

export function rowToArtifact(r: ArtifactRow): StoredArtifact {
  return {
    id: r.id,
    kind: r.kind as ArtifactKind,
    source: r.source as Artifact['source'],
    sourceId: r.source_id,
    key: r.art_key,
    title: r.title,
    safetyClass: nn(r.safety_class),
    version: Number(r.version),
    contentHash: nn(r.content_hash),
    updatedAt: r.updated_at,
    status: nn(r.status),
    result: nn(r.result) as VerificationResult | undefined,
    resultAgainstVersion: r.result_against_version === null ? undefined : Number(r.result_against_version),
    releases: parse<string[]>(r.releases),
    paths: parse<string[]>(r.paths),
    sample: Number(r.sample) === 1,
  };
}

function rowToEdge(r: EdgeRow): Edge {
  return {
    id: r.id,
    fromId: r.from_id,
    toId: r.to_id,
    rel: r.rel as Relation,
    createdAt: r.created_at,
    verifiedAgainstVersion: r.verified_against_version === null ? undefined : Number(r.verified_against_version),
  };
}

function rowToSuspect(r: SuspectRow): Suspect & { rowId: number } {
  return {
    rowId: Number(r.id),
    edgeId: r.edge_id,
    reason: r.reason,
    since: r.since,
    upstreamVersion: Number(r.upstream_version),
    clearedBy: nn(r.cleared_by),
    clearedAt: nn(r.cleared_at),
    justification: nn(r.justification),
  };
}

export class TraceRepository {
  constructor(private readonly db: SqlClient) {}

  // ---------- reads ----------

  async loadGraph(): Promise<TraceGraph> {
    const [arts, edges, suspects] = await Promise.all([
      this.db.query<ArtifactRow>('SELECT * FROM artifact'),
      this.db.query<EdgeRow>('SELECT * FROM edge'),
      this.db.query<SuspectRow>('SELECT * FROM suspect WHERE cleared_at IS NULL'),
    ]);
    return new TraceGraph(arts.map(rowToArtifact), edges.map(rowToEdge), suspects.map(rowToSuspect));
  }

  async getArtifact(id: string): Promise<StoredArtifact | undefined> {
    const rows = await this.db.query<ArtifactRow>('SELECT * FROM artifact WHERE id = ?', [id]);
    return rows[0] ? rowToArtifact(rows[0]) : undefined;
  }

  async edgesFrom(id: string): Promise<Edge[]> {
    return (await this.db.query<EdgeRow>('SELECT * FROM edge WHERE from_id = ?', [id])).map(rowToEdge);
  }

  async suspectHistory(edgeId: string) {
    return (await this.db.query<SuspectRow>('SELECT * FROM suspect WHERE edge_id = ? ORDER BY id DESC', [edgeId])).map(
      rowToSuspect,
    );
  }

  async counts() {
    const rows = await this.db.query<{ kind: string; n: number }>('SELECT kind, COUNT(*) AS n FROM artifact GROUP BY kind');
    return Object.fromEntries(rows.map((r) => [r.kind, Number(r.n)])) as Partial<Record<ArtifactKind, number>>;
  }

  async hasSampleData(): Promise<boolean> {
    const rows = await this.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM artifact WHERE sample = 1');
    return Number(rows[0]?.n ?? 0) > 0;
  }

  // ---------- writes ----------

  async upsertArtifact(a: StoredArtifact): Promise<void> {
    await this.db.exec(
      `INSERT INTO artifact (id, kind, source, source_id, art_key, title, safety_class, version, content_hash, updated_at,
         status, result, result_against_version, releases, paths, sample)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE kind = VALUES(kind), art_key = VALUES(art_key), title = VALUES(title),
         safety_class = VALUES(safety_class), version = VALUES(version), content_hash = VALUES(content_hash),
         updated_at = VALUES(updated_at), status = VALUES(status), result = VALUES(result),
         result_against_version = VALUES(result_against_version), releases = VALUES(releases), paths = VALUES(paths),
         sample = VALUES(sample)`,
      [
        a.id,
        a.kind,
        a.source,
        a.sourceId,
        a.key,
        a.title.slice(0, 512),
        a.safetyClass ?? null,
        a.version,
        a.contentHash ?? null,
        a.updatedAt,
        a.status ?? null,
        a.result ?? null,
        a.resultAgainstVersion ?? null,
        json(a.releases),
        json(a.paths),
        a.sample ? 1 : 0,
      ],
    );
  }

  async deleteArtifact(id: string): Promise<void> {
    await this.db.exec('DELETE FROM edge WHERE from_id = ? OR to_id = ?', [id, id]);
    await this.db.exec('DELETE FROM evidence WHERE artifact_id = ?', [id]);
    await this.db.exec('DELETE FROM artifact WHERE id = ?', [id]);
  }

  async upsertEdge(e: Edge): Promise<void> {
    await this.db.exec(
      `INSERT INTO edge (id, from_id, to_id, rel, created_at, verified_against_version) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE verified_against_version = VALUES(verified_against_version)`,
      [e.id, e.fromId, e.toId, e.rel, e.createdAt, e.verifiedAgainstVersion ?? null],
    );
  }

  /** Insert an edge only if missing; never touches verification state of an existing edge. */
  async ensureEdge(e: Edge): Promise<void> {
    await this.db.exec(
      'INSERT IGNORE INTO edge (id, from_id, to_id, rel, created_at, verified_against_version) VALUES (?, ?, ?, ?, ?, ?)',
      [e.id, e.fromId, e.toId, e.rel, e.createdAt, e.verifiedAgainstVersion ?? null],
    );
  }

  async deleteEdge(id: string): Promise<void> {
    await this.db.exec('DELETE FROM edge WHERE id = ?', [id]);
  }

  /** Replace the set of edges leaving `fromId` that came from one source (e.g. Jira links). */
  async replaceOutgoingEdges(fromId: string, keep: Edge[], rels: Relation[]): Promise<void> {
    const existing = await this.edgesFrom(fromId);
    const keepIds = new Set(keep.map((e) => e.id));
    for (const e of existing) if (rels.includes(e.rel) && !keepIds.has(e.id)) await this.deleteEdge(e.id);
    for (const e of keep) await this.ensureEdge(e);
  }

  async insertSuspects(list: Suspect[]): Promise<void> {
    for (const s of list) {
      await this.db.exec(
        'INSERT INTO suspect (edge_id, reason, since, upstream_version) VALUES (?, ?, ?, ?)',
        [s.edgeId, s.reason.slice(0, 1024), s.since, s.upstreamVersion],
      );
    }
  }

  async saveClearance(s: Suspect): Promise<void> {
    await this.db.exec(
      'UPDATE suspect SET cleared_by = ?, cleared_at = ?, justification = ? WHERE edge_id = ? AND cleared_at IS NULL',
      [s.clearedBy ?? null, s.clearedAt ?? null, s.justification ?? null, s.edgeId],
    );
  }

  async addEvidence(ev: {
    artifactId: string;
    kind: string;
    result: string;
    at: string;
    ref?: string;
    againstVersion?: number;
    recordedBy?: string;
  }): Promise<void> {
    await this.db.exec(
      'INSERT INTO evidence (artifact_id, kind, result, at, ref, against_version, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [ev.artifactId, ev.kind, ev.result, ev.at, ev.ref ?? null, ev.againstVersion ?? null, ev.recordedBy ?? null],
    );
  }

  async evidenceFor(artifactId: string) {
    return this.db.query<{ kind: string; result: string; at: string; ref: string | null; against_version: number | null }>(
      'SELECT kind, result, at, ref, against_version FROM evidence WHERE artifact_id = ? ORDER BY id DESC LIMIT 20',
      [artifactId],
    );
  }

  async saveSnapshot(releaseId: string, green: boolean, payload: unknown, at: string, by?: string): Promise<void> {
    await this.db.exec(
      'INSERT INTO snapshot (release_id, created_at, created_by, green, coverage_json) VALUES (?, ?, ?, ?, ?)',
      [releaseId, at, by ?? null, green ? 1 : 0, JSON.stringify(payload)],
    );
  }

  async listSnapshots(releaseId?: string) {
    return this.db.query<{ id: number; release_id: string; created_at: string; created_by: string | null; green: number }>(
      releaseId
        ? 'SELECT id, release_id, created_at, created_by, green FROM snapshot WHERE release_id = ? ORDER BY id DESC LIMIT 50'
        : 'SELECT id, release_id, created_at, created_by, green FROM snapshot ORDER BY id DESC LIMIT 50',
      releaseId ? [releaseId] : [],
    );
  }

  /** Suspect counts per day (opened), for the "suspect links over time" chart. */
  async suspectTimeline() {
    return this.db.query<{ day: string; opened: number }>(
      'SELECT SUBSTRING(since, 1, 10) AS day, COUNT(*) AS opened FROM suspect GROUP BY SUBSTRING(since, 1, 10) ORDER BY day',
    );
  }

  /** Remove every sample artifact and anything attached to it. */
  async deleteSampleData(): Promise<number> {
    const ids = (await this.db.query<{ id: string }>('SELECT id FROM artifact WHERE sample = 1')).map((r) => r.id);
    for (const id of ids) {
      const outgoing = await this.edgesFrom(id);
      for (const e of outgoing) await this.db.exec('DELETE FROM suspect WHERE edge_id = ?', [e.id]);
      await this.deleteArtifact(id);
    }
    return ids.length;
  }
}
