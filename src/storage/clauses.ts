import { PACKS } from '../domain/packs';

/** Rows for the `standard_clause` table, derived from the standard packs. */
export const STANDARD_CLAUSE_ROWS = Object.values(PACKS).flatMap((pack) =>
  pack.rules.map((rule) => ({
    standard: pack.id,
    clause: rule.clause,
    title: pack.clauses.find((c) => c.id === rule.clause)?.title ?? rule.clause,
    requiredFor: rule.requiredFor.join('|'),
    rule: rule.id,
  })),
);
