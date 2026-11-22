import { mkdirSync, readdirSync, renameSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

const NAME = /^nexum-(\d{8})\.db$/;

const dayStamp = (ms: number): string =>
  new Date(ms).toISOString().slice(0, 10).replaceAll('-', '');

export interface BackupOptions {
  readonly db: DatabaseSync;
  /** `DATA_DIR/backups` */
  readonly dir: string;
  readonly now: () => number;
  /** Do not back up before this UTC hour. */
  readonly hourUtc: number;
  readonly keep: number;
}

/**
 * Nightly backup with `VACUUM INTO`, a consistent copy that is safe while the server is writing.
 * Call it often (hourly is plenty): it only acts once per UTC day, after `hourUtc`.
 * Returns the file written, or undefined when nothing was due.
 */
export function backupIfDue(o: BackupOptions): string | undefined {
  const t = o.now();
  if (new Date(t).getUTCHours() < o.hourUtc) return undefined;
  mkdirSync(o.dir, { recursive: true });
  const target = join(o.dir, `nexum-${dayStamp(t)}.db`);
  if (existsSync(target)) return undefined;
  const tmp = `${target}.tmp`;
  rmSync(tmp, { force: true });
  o.db.prepare('VACUUM INTO ?').run(tmp);
  renameSync(tmp, target);
  const files = readdirSync(o.dir)
    .filter((f) => NAME.test(f))
    .sort();
  for (const f of files.slice(0, Math.max(0, files.length - o.keep))) rmSync(join(o.dir, f));
  return target;
}

/**
 * An on-demand backup: a consistent `VACUUM INTO` copy named by the second, never pruned and
 * never overwriting. Used by `npm run backup`.
 */
export function backupNow(db: DatabaseSync, dir: string, nowMs: number): string {
  mkdirSync(dir, { recursive: true });
  const stamp = new Date(nowMs).toISOString().replace(/[-:]/g, '').slice(0, 15);
  const target = join(dir, `nexum-manual-${stamp}.db`);
  if (existsSync(target)) throw new Error(`backup already exists: ${target}`);
  db.prepare('VACUUM INTO ?').run(target);
  return target;
}
