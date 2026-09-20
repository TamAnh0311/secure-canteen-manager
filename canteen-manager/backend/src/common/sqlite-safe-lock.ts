import { FindOneOptions } from 'typeorm';

/**
 * Return a pessimistic lock option when supported by the DB driver.
 * SQLite (better-sqlite3) does not support row-level locks; its single-writer
 * transactions already serialize access, so the lock is safely omitted.
 */
export function sqliteSafeLock(
  mode: 'pessimistic_read' | 'pessimistic_write',
): Pick<FindOneOptions, 'lock'> {
  const isSqlite = (process.env['DATABASE_TYPE'] ?? 'postgres') === 'sqlite';
  if (isSqlite) return {};
  return { lock: { mode } };
}
