import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { exportPublic } from './export-public.mjs';
import { DEFAULT_SETTINGS } from '../server/validation.mjs';

const testParent = resolve(tmpdir());
const root = await mkdtemp(join(testParent, 'ymx-public-test-'));
const seedRoot = await mkdtemp(join(testParent, 'ymx-public-seed-test-'));
let db;
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const rejects = async (fn, message) => { await assert.rejects(fn); checks++; };
const settings = { ...DEFAULT_SETTINGS, categories: [{ ...DEFAULT_SETTINGS.categories[0], image: '/catalog-products/cover.png' }], password: 'SETTINGS_SECRET' };
const product = {
  id: 'public-1', sku: 'SKU 01/9', order: 1, catalogId: 'ORIGINAL-01', imageId: 'photo-1', model: '9-piece',
  nameEn: 'Public set', nameZh: '公开套装', category: 'Kitchenware', image: '/catalog-products/main.png',
  published: true, verificationStatus: 'Verified',
  components: [{ id: 'fork', nameEn: 'Fork', nameZh: '餐叉', quantity: '9', unit: 'pcs' }],
  gallery: ['/media/gallery.png'], blocks: [{ id: 'detail', type: 'image', title: 'Detail', content: '/media/detail.jpg' }],
  password_hash: 'PRODUCT_SECRET', internalNotes: 'PRIVATE_NOTE',
};
async function fixtures(at) {
  for (const path of ['data/media', 'public/catalog-products', 'app/data']) await mkdir(join(at, path), { recursive: true });
  for (const path of ['public/catalog-products/main.png', 'public/catalog-products/cover.png', 'data/media/gallery.png', 'data/media/detail.jpg', 'data/media/draft.png']) await writeFile(join(at, path), `image fixture: ${path}`);
  await writeFile(join(at, 'public/favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
}
function save(doc, published = Number(doc.published)) {
  db.prepare('INSERT OR REPLACE INTO products(id,sku,published,sort_order,document) VALUES(?,?,?,?,?)').run(doc.id, doc.sku, published, doc.order, JSON.stringify(doc));
}
try {
  await fixtures(root);
  db = new DatabaseSync(join(root, 'data/catalog.sqlite'));
  db.exec('CREATE TABLE products(id TEXT PRIMARY KEY,sku TEXT,published INTEGER,sort_order INTEGER,document TEXT); CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE admins(password_hash TEXT); CREATE TABLE sessions(token_hash TEXT); CREATE TABLE audit_log(details TEXT);');
  db.prepare('INSERT INTO meta VALUES(?,?)').run('settings', JSON.stringify(settings));
  db.exec("INSERT INTO admins VALUES('ADMIN_SECRET'); INSERT INTO sessions VALUES('SESSION_SECRET'); INSERT INTO audit_log VALUES('AUDIT_SECRET'); INSERT INTO meta VALUES('private', 'META_SECRET');");
  save(product);
  save({ ...product, id: 'draft', sku: 'DRAFT', published: false, image: '/media/draft.png' });
  save({ ...product, id: 'unverified', sku: 'UNVERIFIED', verificationStatus: 'Needs confirmation', image: '/media/missing-unverified.png' });
  save({ ...product, id: 'flag-disagrees', sku: 'FLAG-DRAFT' }, 0);
  const first = await exportPublic({ rootDir: root });
  check(first.productCount === 1 && first.imageCount === 4, 'only verified, published products and their images plus category cover');
  const jsonPath = join(root, 'publication/catalog.json');
  const original = await readFile(jsonPath, 'utf8');
  const snapshot = JSON.parse(original);
  check(snapshot.schemaVersion === 1 && snapshot.products[0].sku === 'SKU 01/9', 'public schema and SKU preserved');
  check(snapshot.products[0].components[0].quantity === '9', 'dynamic component quantities preserved');
  check(!/SECRET|PRIVATE_NOTE|password_hash|internalNotes/.test(original), 'credentials, sessions, audit and unknown properties excluded');
  check((await readFile(join(root, 'publication/media/gallery.png'), 'utf8')).includes('data/media/gallery.png'), 'uploaded image copied from local media');
  check((await readFile(join(root, 'publication/catalog-products/main.png'), 'utf8')).includes('public/catalog-products/main.png'), 'original image mapping preserved');
  check((await readdir(join(root, 'publication/media'))).sort().join(',') === 'detail.jpg,gallery.png', 'draft and unrelated uploads omitted');
  check((await readdir(join(root, 'publication'))).includes('.nojekyll'), 'GitHub Pages marker exists');
  save({ ...product, image: '/media/missing.png' });
  await rejects(() => exportPublic({ rootDir: root }), 'missing image rejected');
  check(await readFile(jsonPath, 'utf8') === original, 'missing image failure preserves previous snapshot byte-for-byte');
  save({ ...product, image: '/media/../../.local/admin-access.txt' });
  await rejects(() => exportPublic({ rootDir: root }), 'traversal rejected');
  check(await readFile(jsonPath, 'utf8') === original, 'unsafe path failure preserves previous snapshot');
  await rejects(() => exportPublic({ rootDir: root, source: 'seed' }), 'seed cannot overwrite an existing snapshot');
  save({ ...product, nameEn: 'Updated public set', gallery: [], blocks: [] });
  const next = await exportPublic({ rootDir: root });
  check(next.imageCount === 2 && JSON.parse(await readFile(jsonPath, 'utf8')).products[0].nameEn === 'Updated public set', 'current local data replaces snapshot completely');
  check(!(await readdir(join(root, 'publication'))).includes('media'), 'obsolete images removed on complete replacement');
  check(!(await readdir(root)).some((name) => name.startsWith('.publication-')), 'temporary snapshot directories cleaned');
  check(db.prepare('SELECT COUNT(*) AS count FROM products').get().count === 4, 'export never changes runtime products');
  await fixtures(seedRoot);
  await rejects(() => exportPublic({ rootDir: seedRoot }), 'missing runtime DB does not silently fall back to seed');
  const seed = { ...product, gallery: [], blocks: [] };
  await writeFile(join(seedRoot, 'app/data/catalog.json'), JSON.stringify([seed, { ...seed, id: 'seed-draft', sku: 'DRAFT', published: false }]));
  // Seed uses the real default category covers; fixture them explicitly.
  for (const category of DEFAULT_SETTINGS.categories) await writeFile(join(seedRoot, 'public', category.image.slice(1)), 'category fixture');
  check((await exportPublic({ rootDir: seedRoot, source: 'seed' })).productCount === 1, 'explicit first seed export works');
  check(!(await readdir(join(seedRoot, 'data'))).includes('catalog.sqlite'), 'seed export does not initialize a database or administrator');
  console.log(`Public snapshot: ${checks} checks passed.`);
} finally {
  db?.close();
  for (const target of [root, seedRoot]) {
    const part = relative(testParent, resolve(target));
    if (part && !part.startsWith(`..${sep}`) && part !== '..' && /^ymx-public-(?:seed-)?test-/.test(part) && !part.includes(sep)) await rm(target, { recursive: true, force: true });
  }
}
