import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stat } from 'node:fs/promises';
import { createBackup } from '../server/storage.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(process.env.CATALOG_DATA_DIR ?? join(root, 'data'));
const database = join(dataDir, 'catalog.sqlite');
await stat(database); // Refuse to silently create a new, empty database.
const db = new DatabaseSync(database);
try {
  db.exec('PRAGMA busy_timeout=5000');
  const result = await createBackup(db, dataDir, 'command-line');
  console.log(`Backup created: ${join(dataDir, 'backups', result.name)}`);
} finally { db.close(); }
