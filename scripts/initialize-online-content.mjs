import { DatabaseSync } from 'node:sqlite';
import { copyFile, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProduct, validateSettings, validateCategoryReferences } from '../server/validation.mjs';

// One-time migration only: local data must never silently overwrite online edits.
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const target = join(root, 'content/catalog.json');
try { await readFile(target); throw new Error('Online content already exists. Use the online admin; local data must not overwrite online edits.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const db = new DatabaseSync(join(root, 'data/catalog.sqlite'), { readOnly: true });
let products, settings;
try {
  db.exec('PRAGMA busy_timeout=5000; BEGIN');
  settings = validateSettings(JSON.parse(db.prepare("SELECT value FROM meta WHERE key='settings'").get().value));
  products = db.prepare('SELECT document FROM products ORDER BY sort_order,sku').all().map(row => validateProduct(JSON.parse(row.document), settings));
  db.exec('COMMIT');
} finally { db.close(); }
validateCategoryReferences(products, settings);
if (new Set(products.map(p => p.id)).size !== products.length || new Set(products.map(p => p.sku.toLowerCase())).size !== products.length) throw new Error('Duplicate online product ID/SKU.');
const images = new Set([
  ...products.flatMap(p => [p.image, ...p.gallery, ...p.blocks.filter(b => b.type === 'image').map(b => b.content)]),
  ...settings.categories.map(c => c.image),
].filter(Boolean));
const uploads = [];
for (const image of images) {
  const source = await realpath(join(root, image.startsWith('/media/') ? 'data' : 'public', image.slice(1)));
  const path = relative(root, source);
  if (!path || path.startsWith(`..${sep}`) || path === '..' || !(await stat(source)).isFile()) throw new Error(`Invalid product image: ${image}`);
  if (image.startsWith('/media/')) uploads.push({ source, target: join(root, 'content', image.slice(1)) });
}
await mkdir(join(root, 'content/media'), { recursive: true });
for (const upload of uploads) await copyFile(upload.source, upload.target);
await writeFile(target, `${JSON.stringify({ schemaVersion: 1, products, settings }, null, 2)}\n`, { flag: 'wx' });
console.log(`Initialized online catalogue: ${products.length} products, ${uploads.length} uploaded images. No credentials or runtime database copied.`);
