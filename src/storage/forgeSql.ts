import { migrationRunner, sql } from '@forge/sql';
import { SqlClient, SqlValue } from './db';
import { MIGRATIONS } from './schema';
import { STANDARD_CLAUSE_ROWS } from './clauses';

export const forgeSql: SqlClient = {
  async query<T>(q: string, params: SqlValue[] = []) {
    const stmt = sql.prepare<T>(q);
    const res = params.length ? await stmt.bindParams(...params).execute() : await stmt.execute();
    return res.rows as T[];
  },
  async exec(q: string, params: SqlValue[] = []) {
    const stmt = sql.prepare(q);
    const res = params.length ? await stmt.bindParams(...params).execute() : await stmt.execute();
    const rows = res.rows as unknown as { affectedRows?: number };
    return { affectedRows: rows?.affectedRows ?? 0 };
  },
};

let schemaReady: Promise<void> | undefined;

/** Applies pending migrations once per warm container. Safe to call before every request. */
export function ensureSchema(): Promise<void> {
  schemaReady ??= (async () => {
    let runner = migrationRunner;
    for (const [name, ddl] of MIGRATIONS) runner = runner.enqueue(name, ddl);
    await runner.run();
    await seedClauses();
  })().catch((err) => {
    schemaReady = undefined; // retry on next call
    throw err;
  });
  return schemaReady;
}

async function seedClauses() {
  const [{ n }] = await forgeSql.query<{ n: number }>('SELECT COUNT(*) AS n FROM standard_clause');
  if (Number(n) >= STANDARD_CLAUSE_ROWS.length) return;
  for (const r of STANDARD_CLAUSE_ROWS) {
    await forgeSql.exec(
      'INSERT IGNORE INTO standard_clause (standard, clause, title, required_for, rule) VALUES (?, ?, ?, ?, ?)',
      [r.standard, r.clause, r.title, r.requiredFor, r.rule],
    );
  }
}
