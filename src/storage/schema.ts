/**
 * Forge SQL schema (BRIEF section 6). Forge SQL is MySQL-compatible with no
 * foreign keys and one statement per query, so each DDL is its own migration
 * step and every step is idempotent.
 */
export const MIGRATIONS: [name: string, ddl: string][] = [
  [
    'v001_create_artifact',
    `CREATE TABLE IF NOT EXISTS artifact (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      kind VARCHAR(8) NOT NULL,
      source VARCHAR(16) NOT NULL,
      source_id VARCHAR(191) NOT NULL,
      art_key VARCHAR(191) NOT NULL,
      title VARCHAR(512) NOT NULL,
      safety_class VARCHAR(8) NULL,
      version INT NOT NULL DEFAULT 1,
      content_hash VARCHAR(64) NULL,
      updated_at VARCHAR(32) NOT NULL,
      status VARCHAR(64) NULL,
      result VARCHAR(16) NULL,
      result_against_version INT NULL,
      releases TEXT NULL,
      paths TEXT NULL,
      sample TINYINT NOT NULL DEFAULT 0
    )`,
  ],
  ['v002_artifact_key_idx', 'CREATE INDEX IF NOT EXISTS idx_artifact_key ON artifact (art_key)'],
  [
    'v003_create_edge',
    `CREATE TABLE IF NOT EXISTS edge (
      id VARCHAR(400) NOT NULL PRIMARY KEY,
      from_id VARCHAR(191) NOT NULL,
      to_id VARCHAR(191) NOT NULL,
      rel VARCHAR(16) NOT NULL,
      created_at VARCHAR(32) NOT NULL,
      verified_against_version INT NULL
    )`,
  ],
  ['v004_edge_from_idx', 'CREATE INDEX IF NOT EXISTS idx_edge_from ON edge (from_id)'],
  ['v005_edge_to_idx', 'CREATE INDEX IF NOT EXISTS idx_edge_to ON edge (to_id)'],
  [
    'v006_create_evidence',
    `CREATE TABLE IF NOT EXISTS evidence (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      artifact_id VARCHAR(191) NOT NULL,
      kind VARCHAR(16) NOT NULL,
      result VARCHAR(32) NOT NULL,
      at VARCHAR(32) NOT NULL,
      ref VARCHAR(512) NULL,
      against_version INT NULL,
      recorded_by VARCHAR(128) NULL
    )`,
  ],
  ['v007_evidence_artifact_idx', 'CREATE INDEX IF NOT EXISTS idx_evidence_artifact ON evidence (artifact_id)'],
  [
    'v008_create_suspect',
    `CREATE TABLE IF NOT EXISTS suspect (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      edge_id VARCHAR(400) NOT NULL,
      reason VARCHAR(1024) NOT NULL,
      since VARCHAR(32) NOT NULL,
      upstream_version INT NOT NULL,
      cleared_by VARCHAR(128) NULL,
      cleared_at VARCHAR(32) NULL,
      justification VARCHAR(2048) NULL
    )`,
  ],
  ['v009_suspect_edge_idx', 'CREATE INDEX IF NOT EXISTS idx_suspect_edge ON suspect (edge_id)'],
  [
    'v010_create_standard_clause',
    `CREATE TABLE IF NOT EXISTS standard_clause (
      standard VARCHAR(16) NOT NULL,
      clause VARCHAR(16) NOT NULL,
      title VARCHAR(256) NOT NULL,
      required_for VARCHAR(64) NOT NULL,
      rule VARCHAR(128) NOT NULL,
      PRIMARY KEY (standard, clause, rule)
    )`,
  ],
  [
    'v011_create_snapshot',
    `CREATE TABLE IF NOT EXISTS snapshot (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      release_id VARCHAR(191) NOT NULL,
      created_at VARCHAR(32) NOT NULL,
      created_by VARCHAR(128) NULL,
      green TINYINT NOT NULL,
      coverage_json MEDIUMTEXT NOT NULL
    )`,
  ],
];
