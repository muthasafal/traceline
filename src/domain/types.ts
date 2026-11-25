/**
 * Traceline domain types. Pure TypeScript: nothing in src/domain imports Forge.
 *
 * Edge direction: an edge always points from the DOWNSTREAM artifact to the
 * UPSTREAM artifact it satisfies, e.g. `VER --verifies--> SRS`,
 * `SRS --derives--> SYS`, `RC --mitigates--> HAZ`, `SRS --implements--> RC`.
 */

export type ArtifactKind = 'SYS' | 'SRS' | 'DES' | 'HAZ' | 'RC' | 'IMP' | 'VER';

export const ARTIFACT_KINDS: readonly ArtifactKind[] = ['SYS', 'SRS', 'DES', 'HAZ', 'RC', 'IMP', 'VER'];

export const KIND_LABEL: Record<ArtifactKind, string> = {
  SYS: 'System requirement',
  SRS: 'Software requirement',
  DES: 'Design item',
  HAZ: 'Hazard',
  RC: 'Risk control',
  IMP: 'Implementation',
  VER: 'Verification',
};

export type Relation = 'derives' | 'implements' | 'verifies' | 'mitigates' | 'designs';

export type ArtifactSource = 'jira' | 'confluence' | 'import';

/** Result of the latest run of a verification. */
export type VerificationResult = 'pass' | 'fail' | 'not-run';

export interface Artifact {
  /** Stable Traceline id, e.g. `jira:10042` or `confluence:98765`. */
  id: string;
  kind: ArtifactKind;
  source: ArtifactSource;
  sourceId: string;
  /** Human key shown everywhere, e.g. `PUMP-12` or `SRS-014`. */
  key: string;
  title: string;
  /**
   * Integrity level in the active standard pack's vocabulary:
   * IEC 62304 `A|B|C`, ISO 26262 `QM|A|B|C|D`, DO-178C `A|B|C|D|E`.
   * Undefined means "inherit the project default".
   */
  safetyClass?: string;
  /** Monotonic content version. Bumped whenever the artifact's content changes. */
  version: number;
  /** ISO-8601 timestamp of the last content change. */
  updatedAt: string;
  status?: string;
  /** For VER artifacts: the latest result. */
  result?: VerificationResult;
  /** For VER artifacts: the version of the item under test the latest result was recorded against. */
  resultAgainstVersion?: number;
  /** Release / fix-version names this artifact belongs to. */
  releases?: string[];
  /** For IMP artifacts: code paths or components touched (from dev info). */
  paths?: string[];
  /** True when the artifact is flagged as sample data. */
  sample?: boolean;
}

export interface Edge {
  id: string;
  /** Downstream end. */
  fromId: string;
  /** Upstream end. */
  toId: string;
  rel: Relation;
  createdAt: string;
  /**
   * Version of the UPSTREAM artifact (toId) when this link was last verified
   * or reviewed. Undefined means the link has never been verified.
   */
  verifiedAgainstVersion?: number;
}

export type EvidenceKind = 'test-result' | 'review' | 'pr';

export interface Evidence {
  artifactId: string;
  kind: EvidenceKind;
  result: string;
  at: string;
  ref?: string;
}

export interface Suspect {
  edgeId: string;
  reason: string;
  since: string;
  /** Version of the upstream artifact that made the link suspect. */
  upstreamVersion: number;
  clearedBy?: string;
  clearedAt?: string;
  justification?: string;
}

export interface Gap {
  /** Rule that raised the gap, e.g. `iec62304.srs-verified`. */
  ruleId: string;
  standard: string;
  clause: string;
  artifactId: string;
  artifactKey: string;
  artifactKind: ArtifactKind;
  /** Plain-English, actionable message. */
  message: string;
  /** Blocking gaps turn the release gate red. */
  blocking: boolean;
}

export function isOpen(s: Suspect): boolean {
  return !s.clearedAt;
}
