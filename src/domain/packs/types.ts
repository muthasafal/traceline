import { TraceGraph } from '../graph';
import { Artifact, ArtifactKind } from '../types';

export interface Clause {
  /** Clause reference as printed in the standard's structure, e.g. `5.7`. */
  id: string;
  title: string;
}

export interface GapRule {
  id: string;
  clause: string;
  /** What the rule checks, as a sentence. */
  title: string;
  /** The kind of artifact each check runs on. */
  appliesTo: ArtifactKind;
  /** Integrity levels the rule applies at. */
  requiredFor: readonly string[];
  /** Whether a failing check blocks the release gate. */
  blocking: boolean;
  /** Returns an actionable message when the artifact fails the rule, otherwise null. */
  check(a: Artifact, g: TraceGraph): string | null;
}

export interface StandardPack {
  id: 'iec62304' | 'iso26262' | 'do178c';
  name: string;
  /** What the clause map follows. */
  basis: string;
  /** Word for an integrity level in this standard. */
  levelName: string;
  /** Levels from least to most stringent. */
  levels: readonly string[];
  defaultLevel: string;
  clauses: readonly Clause[];
  rules: readonly GapRule[];
  /** Clause cited for "no open suspect links in a release". */
  changeClause: string;
  /** "full" or "light" coverage of the standard's traceability expectations. */
  depth: 'full' | 'light';
}

export const PACK_DISCLAIMER =
  'Clause references are a working aid that follows the structure of the published standard. ' +
  'They are not a copy of it and do not replace your own reading of it or your quality system.';
