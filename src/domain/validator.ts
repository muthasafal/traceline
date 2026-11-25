import { passingVerifications, verificationShortfall } from './coverage';
import { levelOf } from './gaps';
import { TraceGraph } from './graph';
import { StandardPack } from './packs/types';

export interface ValidatorDecision {
  allowed: boolean;
  /** Exactly what is missing, when blocked. */
  message?: string;
  checked: string[];
}

/**
 * Workflow validator rule: an issue that implements a requirement (or risk
 * control) at one of `levels` cannot move to Done until each of those
 * requirements has a verification that passed against its current version.
 */
export function canComplete(
  graph: TraceGraph,
  pack: StandardPack,
  idOrKey: string,
  levels: readonly string[],
  defaultLevel?: string,
): ValidatorDecision {
  const item = graph.resolve(idOrKey);
  if (!item) return { allowed: true, checked: [] };
  const targets = graph
    .upstream(item.id, 'implements')
    .filter((u) => u.kind === 'SRS' || u.kind === 'RC')
    .filter((u) => levels.includes(levelOf(u, pack, defaultLevel)));
  const missing = targets.filter((t) => passingVerifications(graph, t).length === 0);
  if (missing.length === 0) return { allowed: true, checked: targets.map((t) => t.key) };
  const parts = missing.map(
    (t) => `${t.key} (${pack.levelName.toLowerCase()} ${levelOf(t, pack, defaultLevel)}): ${verificationShortfall(graph, t)}`,
  );
  return {
    allowed: false,
    checked: targets.map((t) => t.key),
    message: `${item.key} implements ${missing.length === 1 ? 'a requirement' : `${missing.length} requirements`} without a passing verification against the current version. ${parts.join('; ')}. Record a passing test, then try again.`,
  };
}
