import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogueAtBase } from '../app/catalog-source.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'dist-pages');
const base = '/yumingxing_catalog/';
const snapshot = JSON.parse(await readFile(join(output, 'catalog.json'), 'utf8'));
const html = await readFile(join(output, 'index.html'), 'utf8');
const adminHtml = await readFile(join(output, 'admin/index.html'), 'utf8');
assert.match(adminHtml, /\/yumingxing_catalog\/assets\//);
assert.match(adminHtml, /Content-Security-Policy/);
assert.match(adminHtml, /script-src 'self'/);
assert.match(adminHtml, /no-referrer/);
assert.match(html, /\/yumingxing_catalog\/assets\//);
assert.match(html, /\/yumingxing_catalog\/favicon.svg/);
assert.ok(Array.isArray(snapshot.products), 'The published catalogue contains a product list');
assert.equal(new Set(snapshot.products.map(p => p.sku)).size, snapshot.products.length);
assert.ok(snapshot.products.every(p => p.published && p.verificationStatus === 'Verified'));
assert.match(snapshot.settings.whatsapp, /^\d{7,15}$/);
const original = JSON.stringify(snapshot);
const mapped = catalogueAtBase(snapshot, base);
assert.equal(JSON.stringify(snapshot), original, 'Mapping never edits the source snapshot');
const images = new Set([
  ...mapped.products.flatMap(p => [p.image, ...(p.gallery || []), ...(p.blocks || []).filter(b => b.type === 'image').map(b => b.content)]),
  ...mapped.settings.categories.map(c => c.image),
].filter(Boolean));
for (const image of images) {
  assert.ok(image.startsWith(base), `Image must stay under the repository path: ${image}`);
  assert.ok((await stat(resolve(output, image.slice(base.length)))).isFile(), `Missing image: ${image}`);
}
const fixture = { products: [{ ...snapshot.products[0], image: '/media/photo.png', gallery: ['/catalog-products/photo.jpg'], blocks: [{ id: 'image', type: 'image', title: '', content: '/media/detail.webp' }, { id: 'text', type: 'text', title: '', content: '/text is not an image' }] }], settings: { ...snapshot.settings, categories: [{ ...snapshot.settings.categories[0], image: '' }] } };
const paths = catalogueAtBase(fixture, base);
assert.equal(paths.products[0].image, `${base}media/photo.png`);
assert.deepEqual(paths.products[0].gallery, [`${base}catalog-products/photo.jpg`]);
assert.equal(paths.products[0].blocks[0].content, `${base}media/detail.webp`);
assert.equal(paths.products[0].blocks[1].content, '/text is not an image');
assert.equal(paths.settings.categories[0].image, '');
const assets = await readdir(join(output, 'assets'));
assert.ok(assets.some(name => name.includes('admin')), 'Online admin is built as its own entry');
for (const name of assets.filter(name => name.endsWith('.js'))) {
  const code = await readFile(join(output, 'assets', name), 'utf8');
  assert.ok(!/github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{30,}/.test(code), 'No GitHub credential is embedded in the public bundle');
  assert.ok(!code.includes('node:sqlite') && !code.includes('password_hash'), 'Local server and credential storage are not bundled');
}
for (const name of await readdir(output)) {
  assert.ok(!['data', '.local', 'server', 'app', 'products', 'content'].includes(name), `Private/unneeded directory in artifact: ${name}`);
}
console.log(`Pages checks passed: ${snapshot.products.length} verified products, ${images.size} referenced images, repository paths, online admin CSP and no embedded credentials or runtime data.`);
