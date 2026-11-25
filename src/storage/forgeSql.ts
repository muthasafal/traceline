import { kvs } from '@forge/kvs';
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

let schemaReady: Promise<boolean> | undefined;
const SCHEMA_KEY = 'state:schemaVersion';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Applies pending migrations. Forge SQL allows only 25 DDL statements a minute
 * per installation, so the applied version is recorded in KVS and every later
 * call is a single KVS read. Pass `migrate: false` from triggers so bursts of
 * events never run DDL; they skip work until the schema is ready.
 */
export function ensureSchema(opts: { migrate?: boolean } = {}): Promise<boolean> {
  const migrate = opts.migrate ?? true;
  if (schemaReady) return schemaReady;
  const attempt = (async () => {
    if ((await kvs.get<number>(SCHEMA_KEY)) === MIGRATIONS.length) return true;
    if (!migrate) return false;
    for (let tries = 0; ; tries++) {
      try {
        let runner = migrationRunner;
        for (const [name, ddl] of MIGRATIONS) runner = runner.enqueue(name, ddl);
        await runner.run();
        break;
      } catch (e) {
        if (tries >= 6) throw e;
        await sleep(10_000); // rate limited or racing another invocation; wait for the DDL window
      }
    }
    await seedClauses();
    await kvs.set(SCHEMA_KEY, MIGRATIONS.length);
    return true;
  })();
  schemaReady = attempt.then((ok) => {
    if (!ok) schemaReady = undefined; // check again next time
    return ok;
  }).catch((err) => {
    schemaReady = undefined;
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
