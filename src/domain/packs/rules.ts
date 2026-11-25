import { passingVerifications, verificationShortfall } from '../coverage';
import { ArtifactKind, KIND_LABEL, Relation } from '../types';
import { GapRule } from './types';

type Base = Pick<GapRule, 'id' | 'clause' | 'requiredFor' | 'blocking'>;

const lower = (k: ArtifactKind) => KIND_LABEL[k].toLowerCase();

/** `appliesTo` must have >= 1 upstream `target` via `rel` (e.g. SRS derives from SYS). */
export function tracesUpTo(base: Base, appliesTo: ArtifactKind, rel: Relation, target: ArtifactKind): GapRule {
  return {
    ...base,
    appliesTo,
    title: `Every ${lower(appliesTo)} traces to a ${lower(target)}.`,
    check(a, g) {
      const ok = g.upstream(a.id, rel).some((u) => u.kind === target);
      return ok ? null : `${a.key} does not trace to any ${lower(target)}. Add a "${rel}" link to one.`;
    },
  };
}

/** `appliesTo` must have >= 1 downstream `source` via `rel` (e.g. a HAZ is mitigated by an RC). */
export function hasDownstream(
  base: Base,
  appliesTo: ArtifactKind,
  rel: Relation,
  source: ArtifactKind,
  phrase: string,
): GapRule {
  return {
    ...base,
    appliesTo,
    title: `Every ${lower(appliesTo)} ${phrase} at least one ${lower(source)}.`,
    check(a, g) {
      const ok = g.downstream(a.id, rel).some((d) => d.kind === source);
      return ok ? null : `${a.key} has no ${lower(source)}. Every ${lower(appliesTo)} ${phrase} at least one.`;
    },
  };
}

/** `appliesTo` must have >= 1 verification that passed against its current version. */
export function verified(base: Base, appliesTo: ArtifactKind, what = 'verification'): GapRule {
  return {
    ...base,
    appliesTo,
    title: `Every ${lower(appliesTo)} has a ${what} that passed against its current version.`,
    check(a, g) {
      if (passingVerifications(g, a).length) return null;
      return `${a.key} has no passing ${what} against version ${a.version}: ${verificationShortfall(g, a)}.`;
    },
  };
}
