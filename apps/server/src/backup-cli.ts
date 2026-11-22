import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backupNow } from './game/backup.js';

/**
 * `npm run backup`: writes a consistent copy of the live database to `DATA_DIR/backups`.
 * Safe while the server is running (SQLite WAL, `VACUUM INTO` reads a consistent snapshot).
 */
const dataDir = process.env['DATA_DIR'] ?? './data';
const file = join(dataDir, 'nexum.db');
if (!existsSync(file)) {
  console.error(JSON.stringify({ level: 'error', msg: 'no database', file }));
  process.exit(1);
}
const db = new DatabaseSync(file);
try {
  db.exec('PRAGMA busy_timeout = 5000');
  const target = backupNow(db, join(dataDir, 'backups'), Date.now());
  console.log(JSON.stringify({ level: 'info', msg: 'backup written', file: target }));
} finally {
  db.close();
}
