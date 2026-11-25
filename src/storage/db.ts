/**
 * Minimal SQL port so the repository can run against Forge SQL in production
 * and an in-memory fake in tests.
 */
export type SqlValue = string | number | null;

export interface SqlClient {
  query<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  exec(sql: string, params?: SqlValue[]): Promise<{ affectedRows: number }>;
}
