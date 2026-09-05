import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, readFile, writeFile, readdir, cp, rm } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { DEFAULT_SETTINGS, validateProduct } from './validation.mjs';

const scrypt = promisify(scryptCallback);

export async function hashPassword(password) {
  const salt = randomBytes(24).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [salt, hex] = stored.split(':');
  const actual = await scrypt(password, salt, 64);
  const expected = Buffer.from(hex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function transaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = operation(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function listProducts(db, includeDrafts = false) {
  return db.prepare(`SELECT document FROM products ${includeDrafts ? '' : 'WHERE published = 1'} ORDER BY sort_order, sku`).all().map((row) => JSON.parse(row.document));
}

export function getSettings(db) {
  return JSON.parse(db.prepare("SELECT value FROM meta WHERE key='settings'").get().value);
}

export function getProduct(db, id) {
  const row = db.prepare('SELECT document FROM products WHERE id = ?').get(id);
  return row ? JSON.parse(row.document) : undefined;
}

export function saveProduct(db, product) {
  db.prepare(`INSERT INTO products(id,sku,category,published,sort_order,document,updated_at) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET category=excluded.category,published=excluded.published,sort_order=excluded.sort_order,document=excluded.document,updated_at=excluded.updated_at`).run(
    product.id, product.sku, product.category, Number(product.published), product.order, JSON.stringify(product), Date.now(),
  );
}

export function saveSettings(db, settings) {
  db.prepare("INSERT INTO meta(key,value) VALUES('settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(settings));
}

export function audit(db, actor, action, details = {}) {
  db.prepare('INSERT INTO audit_log(created_at,actor,action,details) VALUES(?,?,?,?)').run(Date.now(), actor, action, JSON.stringify(details));
}

export async function initializeStore({ dataDir, localDir, seedPath }) {
  await mkdir(dataDir, { recursive: true });
  await mkdir(join(dataDir, 'media'), { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'catalog.sqlite'));
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,sku TEXT NOT NULL UNIQUE COLLATE NOCASE,category TEXT NOT NULL,published INTEGER NOT NULL CHECK(published IN (0,1)),sort_order INTEGER NOT NULL,document TEXT NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS admins(username TEXT PRIMARY KEY,password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,username TEXT NOT NULL REFERENCES admins(username),expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS login_limits(ip TEXT PRIMARY KEY,attempts INTEGER NOT NULL,window_start INTEGER NOT NULL,blocked_until INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY AUTOINCREMENT,created_at INTEGER NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,details TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS product_public_order ON products(published,sort_order);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);`);
  try {
    // This marker deliberately survives an empty catalog. Deleted seed products never reappear.
    if (!db.prepare("SELECT value FROM meta WHERE key='initialized'").get()) {
      const parsed = JSON.parse(await readFile(seedPath, 'utf8'));
      const seed = Array.isArray(parsed) ? parsed : parsed.products;
      const settings = structuredClone(DEFAULT_SETTINGS);
      const counts = new Map();
      for (const product of seed) counts.set(product.catalogId, (counts.get(product.catalogId) ?? 0) + 1);
      transaction(db, () => {
        saveSettings(db, settings);
        for (const product of seed) {
          const sku = counts.get(product.catalogId) > 1 ? `${product.catalogId}-${product.imageId.split('-').at(-1)}` : product.catalogId;
          saveProduct(db, validateProduct({ ...product, sku }, settings));
        }
        db.prepare("INSERT INTO meta(key,value) VALUES('initialized','1')").run();
        audit(db, 'system', 'catalog.seeded', { count: seed.length });
      });
    }
    let accessFile;
    if (!db.prepare('SELECT username FROM admins LIMIT 1').get()) {
      const password = randomBytes(24).toString('base64url');
      const passwordHash = await hashPassword(password);
      await mkdir(localDir, { recursive: true });
      accessFile = join(localDir, 'admin-access.txt');
      // Write before creating the account: a write failure cannot leave an inaccessible account.
      await writeFile(accessFile, `YMX local catalog administrator\nUsername: admin\nPassword: ${password}\n\nChange this password in the admin interface after signing in. Do not publish this file.\n`, { mode: 0o600 });
      db.prepare('INSERT INTO admins(username,password_hash) VALUES(?,?)').run('admin', passwordHash);
      audit(db, 'system', 'admin.created', { username: 'admin' });
    }
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    return { db, accessFile };
  } catch (error) { db.close(); throw error; }
}

let backupSequence = Promise.resolve();
export async function waitForBackups() { await backupSequence; }
export function createBackup(db, dataDirectory, reason = 'manual') {
  const operation = backupSequence.then(async () => {
    const dataDir = resolve(dataDirectory);
    const backupRoot = join(dataDir, 'backups');
    await mkdir(backupRoot, { recursive: true });
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`;
    const target = join(backupRoot, name);
    await mkdir(target);
    try {
      await backup(db, join(target, 'catalog.sqlite'));
      await cp(join(dataDir, 'media'), join(target, 'media'), { recursive: true });
      await writeFile(join(target, 'manifest.json'), JSON.stringify({ version: 1, createdAt: new Date().toISOString(), reason }, null, 2));
      const old = (await readdir(backupRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}T[\dTZ-]+-[a-f0-9]{6}$/.test(entry.name)).map((entry) => entry.name).sort().reverse().slice(10);
      for (const entry of old) {
        const oldPath = resolve(backupRoot, entry);
        if (oldPath.startsWith(`${resolve(backupRoot)}\\`) || oldPath.startsWith(`${resolve(backupRoot)}/`)) await rm(oldPath, { recursive: true, force: true });
      }
      audit(db, 'system', 'backup.created', { name: basename(target), reason });
      return { name, createdAt: new Date().toISOString() };
    } catch (error) {
      // Partial backup directories are distinguishable by their missing manifest.
      throw error;
    }
  });
  backupSequence = operation.catch(() => {});
  return operation;
}
