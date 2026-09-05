import { DatabaseSync } from 'node:sqlite';
import { copyFile, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DEFAULT_SETTINGS, validateProduct, validateSettings } from '../server/validation.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exists = async (path) => { try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };

function assertInside(root, target) {
  const part = relative(root, target);
  if (!part || part === '..' || part.startsWith(`..${sep}`) || isAbsolute(part)) throw new Error(`Path must stay inside the project: ${target}`);
}

async function regularFile(root, target) {
  assertInside(root, target);
  // Reject links at every level, including links to private files elsewhere inside the project.
  for (let entry = target; entry !== root; entry = dirname(entry)) {
    if ((await lstat(entry)).isSymbolicLink()) throw new Error(`Symbolic links cannot be published: ${target}`);
  }
  const resolved = await realpath(target);
  assertInside(root, resolved);
  if (!(await lstat(resolved)).isFile()) throw new Error(`Expected a file: ${target}`);
  return resolved;
}

async function safeRemove(root, target) {
  assertInside(root, target);
  const entry = await exists(target);
  if (!entry) return;
  if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error(`Refusing to remove an unexpected path: ${target}`);
  assertInside(root, await realpath(target));
  await rm(target, { recursive: true, force: true });
}

async function readSource(root, source) {
  if (source === 'seed') {
    const value = JSON.parse(await readFile(await regularFile(root, join(root, 'app/data/catalog.json')), 'utf8'));
    return { products: Array.isArray(value) ? value : value.products, settings: DEFAULT_SETTINGS };
  }
  const databasePath = join(root, 'data/catalog.sqlite');
  if (!await exists(databasePath)) throw new Error('Local database is missing. Start the local catalogue first, or explicitly use --source seed for a new publication. Existing publication is retained.');
  const db = new DatabaseSync(await regularFile(root, databasePath), { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 5000; BEGIN');
    const settings = db.prepare("SELECT value FROM meta WHERE key = 'settings'").get();
    if (!settings) throw new Error('The local database has no site settings.');
    const products = db.prepare('SELECT document FROM products WHERE published = 1 ORDER BY sort_order, sku').all().map((row) => JSON.parse(row.document));
    const result = { products, settings: JSON.parse(settings.value) };
    db.exec('COMMIT');
    return result;
  } finally { db.close(); }
}

/** Read-only export of public catalogue data. Never initializes or mutates the local store. */
export async function exportPublic({ rootDir = projectRoot, source = 'local' } = {}) {
  if (!['local', 'seed'].includes(source)) throw new Error('Source must be local or seed.');
  const root = await realpath(resolve(rootDir));
  const output = join(root, 'publication');
  const previous = await exists(output);
  if (previous && (!previous.isDirectory() || previous.isSymbolicLink())) throw new Error('publication must be a regular project directory.');
  // A CI checkout should consume its committed snapshot. Seed fallback must never reset one.
  if (source === 'seed' && previous) throw new Error('A publication already exists. Seed export cannot replace it; publish current local data instead.');
  const input = await readSource(root, source);
  const settings = validateSettings(input.settings);
  if (!Array.isArray(input.products)) throw new Error('Invalid product source.');
  const products = input.products.filter((product) => product.published === true && product.verificationStatus === 'Verified').map((product) => validateProduct(product, settings));
  const skus = new Set();
  const ids = new Set();
  for (const product of products) {
    const sku = product.sku.toLowerCase();
    if (skus.has(sku) || ids.has(product.id)) throw new Error('Published products must have unique IDs and SKUs.');
    skus.add(sku); ids.add(product.id);
  }
  const imageUrls = new Set(settings.categories.map((category) => category.image).filter(Boolean));
  for (const product of products) {
    imageUrls.add(product.image);
    for (const url of product.gallery) if (url) imageUrls.add(url);
    for (const block of product.blocks) if (block.type === 'image' && block.content) imageUrls.add(block.content);
  }
  // validateProduct / validateSettings allow only flat PNG/JPEG/WebP paths in these roots.
  // Resolve every source before staging anything so missing or escaping media preserves the snapshot.
  const images = await Promise.all([...imageUrls].sort().map(async (url) => ({
    url,
    source: await regularFile(root, url.startsWith('/media/') ? join(root, 'data', url.slice(1)) : join(root, 'public', url.slice(1))),
  })));
  const favicon = await regularFile(root, join(root, 'public/favicon.svg'));
  const generatedAt = new Date().toISOString();
  const stage = join(root, `.publication-stage-${randomUUID()}`);
  const old = join(root, `.publication-old-${randomUUID()}`);
  let movedOld = false;
  let installed = false;
  await mkdir(stage);
  try {
    for (const entry of images) {
      const target = join(stage, entry.url.slice(1));
      assertInside(stage, target);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(entry.source, target);
    }
    await copyFile(favicon, join(stage, 'favicon.svg'));
    await writeFile(join(stage, '.nojekyll'), '');
    await writeFile(join(stage, 'catalog.json'), `${JSON.stringify({ schemaVersion: 1, generatedAt, products, settings }, null, 2)}\n`);
    if (previous) { await rename(output, old); movedOld = true; }
    try { await rename(stage, output); installed = true; }
    catch (error) { if (movedOld) { await rename(old, output); movedOld = false; } throw error; }
    if (movedOld) await safeRemove(root, old);
    return { source, output, generatedAt, productCount: products.length, imageCount: images.length };
  } finally {
    if (!installed) await safeRemove(root, stage);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--source')) {
    console.error('Usage: node scripts/export-public.mjs [--source local|seed]');
    process.exitCode = 1;
  } else {
    try { console.log(JSON.stringify(await exportPublic({ source: args[1] ?? 'local' }), null, 2)); }
    catch (error) { console.error(`Public export failed: ${error.message}`); process.exitCode = 1; }
  }
}
