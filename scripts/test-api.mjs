import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createCatalogServer } from '../server/index.mjs';
import { DatabaseSync } from 'node:sqlite';

const temporaryRoot = await mkdtemp(join(tmpdir(), 'ymx-api-test-'));
const applications = new Set();
let checks = 0;
function check(condition, message) { assert.ok(condition, message); checks += 1; }
function equal(actual, expected, message) { assert.deepEqual(actual, expected, message); checks += 1; }

async function start(options = {}) {
  const app = await createCatalogServer({ port: 0, dataDir: join(temporaryRoot, 'data'), localDir: join(temporaryRoot, '.local'), autoBackup: false, ...options });
  applications.add(app);
  const base = `http://127.0.0.1:${app.port}`;
  let cookie = '';
  async function request(path, { method = 'GET', body, auth = true, origin = base, headers = {} } = {}) {
    const outgoing = { ...headers };
    if (origin !== null) outgoing.Origin = origin;
    if (auth && cookie) outgoing.Cookie = cookie;
    if (body !== undefined && !Buffer.isBuffer(body)) { outgoing['Content-Type'] ??= 'application/json'; body = JSON.stringify(body); }
    const response = await fetch(base + path, { method, headers: outgoing, body });
    const content = await response.text();
    let data;
    try { data = JSON.parse(content); } catch { data = content; }
    return { response, status: response.status, data };
  }
  async function login(password) {
    const result = await request('/api/admin/login', { method: 'POST', body: { username: 'admin', password }, auth: false });
    equal(result.status, 200, 'login succeeds');
    const header = result.response.headers.get('set-cookie');
    check(header.includes('HttpOnly') && header.includes('SameSite=Strict') && header.includes('Path=/'), 'session cookie is hardened');
    cookie = header.split(';')[0];
    return result;
  }
  return { app, request, login, getCookie: () => cookie, setCookie: (value) => { cookie = value; }, close: async () => { await app.close(); applications.delete(app); } };
}

try {
  const fixtureDist = join(temporaryRoot, 'dist');
  await mkdir(fixtureDist);
  await writeFile(join(fixtureDist, 'index.html'), '<!doctype html><title>Catalog fixture</title>');
  let client = await start({ distDir: fixtureDist });
  let { request } = client;
  const access = await readFile(join(temporaryRoot, '.local', 'admin-access.txt'), 'utf8');
  const password = access.match(/^Password: (.+)$/m)?.[1];
  check(password?.length >= 30, 'initial password has strong entropy');
  const health = await request('/api/health');
  equal(health.data, { ok: true }, 'health endpoint');
  const publicCatalog = await request('/api/catalog');
  equal(publicCatalog.status, 200, 'public catalog works');
  check(publicCatalog.data.products.every((p) => p.published && p.verificationStatus === 'Verified'), 'public catalog includes only verified published products');
  equal(publicCatalog.data.settings.whatsapp, '8615992577610', 'default WhatsApp');
  equal(publicCatalog.data.settings.brand, 'YUMINGXING', 'brand matches frontend design');
  check(publicCatalog.data.settings.categories.every((category) => category.image.startsWith('/catalog-products/')), 'default categories include their real cover images');
  equal((await request('/api/products?includeDrafts=1', { auth: false })).status, 401, 'draft list requires authentication');
  equal((await request('/api/admin/export', { auth: false })).status, 401, 'export requires authentication');
  equal((await request('/api/products', { method: 'POST', body: { sku: 'UNAUTHORIZED' }, auth: false })).status, 401, 'write requires authentication');
  equal((await request('/api/admin/session')).data, { authenticated: false, username: null }, 'anonymous session');
  equal((await request('/api/admin/login', { method: 'POST', body: { username: 'admin', password }, origin: 'https://evil.example' })).status, 403, 'login checks Origin');
  equal((await request('/api/admin/login', { method: 'POST', body: { username: 'admin', password }, origin: null })).status, 403, 'missing Origin is rejected');
  await client.login(password);
  equal((await request('/api/admin/session')).data, { authenticated: true, username: 'admin' }, 'authenticated session');
  const seeded = (await request('/api/products?includeDrafts=1')).data.products;
  equal(seeded.length, 110, 'all 110 seed records survive');
  equal(new Set(seeded.map((p) => p.sku.toLowerCase())).size, 110, 'every seed SKU is unique');
  check(seeded.filter((p) => p.catalogId === 'CUT-020').every((p) => p.sku === `${p.catalogId}-${p.imageId.split('-').at(-1)}`), 'duplicate catalog IDs gain the image suffix');
  equal(seeded.find((p) => p.catalogId === 'KIT-U01').sku, 'KIT-U01', 'unique catalog ID remains unchanged');
  const slashId = seeded.find((p) => p.id.includes('/'));
  equal((await request(`/api/products/${encodeURIComponent(slashId.id)}`, { method: 'PUT', body: { descriptionEn: 'Edited encoded ID' } })).status, 200, 'encoded legacy IDs can be updated');
  equal((await request('/api/products', { method: 'POST', body: { sku: seeded[0].sku.toLowerCase() } })).status, 409, 'SKU uniqueness is case insensitive');
  equal((await request('/api/products', { method: 'POST', body: { nameEn: 'Missing SKU' } })).status, 400, 'SKU required');

  const draft = (await request('/api/products', { method: 'POST', body: { sku: 'TEST-NINE', nameEn: 'Nine-piece test', category: 'Kitchenware', image: seeded[0].image } })).data.product;
  check(draft && draft.published === false, 'new products default to draft');
  check(!(await request('/api/catalog')).data.products.some((p) => p.id === draft.id), 'draft never leaks into public catalog');
  equal((await request(`/api/products/${draft.id}`, { method: 'PUT', body: { published: true } })).status, 400, 'unverified publishing rejected');
  equal((await request(`/api/products/${draft.id}`, { method: 'PUT', body: { sku: 'NEW-SKU' } })).status, 400, 'existing SKU immutable');
  equal((await request(`/api/products/${draft.id}`, { method: 'PUT', body: { published: 'true' } })).status, 400, 'published boolean validated');
  equal((await request(`/api/products/${draft.id}`, { method: 'PUT', body: { category: 'MISSING' } })).status, 400, 'unknown categories rejected');
  const changed = await request(`/api/products/${draft.id}`, { method: 'PUT', body: {
    verificationStatus: 'Verified', published: true,
    components: Array.from({ length: 9 }, (_, i) => ({ id: `piece-${i}`, nameEn: `Piece ${i + 1}`, quantity: '1' })),
    attributes: [{ id: 'color', label: 'Color', value: 'Silver' }],
    blocks: [{ id: 'description', type: 'text', title: 'Description', content: 'Expandable details' }, { id: 'photo', type: 'image', title: 'Close-up', content: seeded[0].image }],
    gallery: [seeded[0].image],
  } });
  equal(changed.status, 200, 'valid dynamic product saved');
  equal(changed.data.product.components.length, 9, 'all nine components retained');
  equal(changed.data.product.blocks.length, 2, 'text and image blocks retained');
  check((await request('/api/catalog')).data.products.some((p) => p.id === draft.id), 'verified publishing is public');
  equal((await request(`/api/products/${draft.id}`, { method: 'PUT', body: { image: 'javascript:alert(1)' } })).status, 400, 'active image URL rejected');
  equal((await request(`/api/products/${draft.id}`, { method: 'PUT', body: { image: '/media/evil.svg' } })).status, 400, 'SVG product image rejected');
  equal((await request('/api/settings', { method: 'PUT', body: { accent: 'red' } })).status, 400, 'color validation');
  equal((await request('/api/settings', { method: 'PUT', body: { categories: [] } })).status, 409, 'referenced category removal blocked');
  equal((await request('/api/settings', { method: 'PUT', body: { brand: 'Changed' }, origin: 'http://attacker.local' })).status, 403, 'authenticated mutation also checks Origin');
  const settings = (await request('/api/catalog')).data.settings;
  settings.categories.push({ id: 'New Category', nameEn: 'New Category', nameZh: '新增', image: '', descriptionEn: '', descriptionZh: '' });
  equal((await request('/api/settings', { method: 'PUT', body: settings })).status, 200, 'category added');
  equal((await request(`/api/products/${draft.id}`, { method: 'PUT', body: { category: 'New Category' } })).status, 200, 'product category migrated');
  equal((await request('/api/settings', { method: 'PUT', body: { categories: settings.categories.filter((c) => c.id !== 'New Category') } })).status, 409, 'new category reference protected');

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlOIAAAAASUVORK5CYII=', 'base64');
  equal((await request('/api/uploads', { method: 'POST', body: png, auth: false, headers: { 'Content-Type': 'image/png' } })).status, 401, 'upload requires authentication');
  equal((await request('/api/uploads', { method: 'POST', body: Buffer.from('<svg/>'), headers: { 'Content-Type': 'image/svg+xml' } })).status, 415, 'SVG uploads rejected');
  equal((await request('/api/uploads', { method: 'POST', body: Buffer.from('<script>bad</script>'), headers: { 'Content-Type': 'image/png' } })).status, 415, 'forged image MIME rejected');
  equal((await request('/api/uploads', { method: 'POST', body: Buffer.alloc(8 * 1024 * 1024 + 1), headers: { 'Content-Type': 'image/png' } })).status, 413, '8 MB upload limit');
  const uploaded = await request('/api/uploads', { method: 'POST', body: png, headers: { 'Content-Type': 'image/png', 'X-Filename': '../../attack.svg' } });
  equal(uploaded.status, 201, 'PNG upload');
  check(/^\/media\/[a-f0-9-]+\.png$/.test(uploaded.data.url), 'server generates safe filename');
  const servedImage = await request(uploaded.data.url);
  equal(servedImage.status, 200, 'uploaded media is public');
  equal(servedImage.response.headers.get('content-type'), 'image/png', 'uploaded image MIME');
  equal((await request('/media/%2e%2e%2fcatalog.sqlite')).status, 400, 'media traversal rejected');
  equal((await request('/data/catalog.sqlite')).status, 404, 'database is never served');
  equal((await request('/.local/admin-access.txt')).status, 400, 'credential path is never served');
  equal((await request(seeded[0].image)).status, 200, 'existing public product images served');
  equal((await request('/admin')).status, 200, 'admin SPA fallback');
  equal((await request('/product/example')).status, 200, 'product SPA fallback');

  const exported = await request('/api/admin/export');
  equal(exported.data.products.length, 111, 'export includes drafts and new records');
  check(!JSON.stringify(exported.data).includes('password_hash'), 'export contains no credentials');
  const before = (await request(`/api/products?includeDrafts=1`)).data.products.find((p) => p.id === draft.id);
  const invalidImport = { products: [{ ...before, nameEn: 'This must roll back' }, { sku: 'INVALID-PUBLISH', published: true }] };
  equal((await request('/api/admin/import', { method: 'POST', body: invalidImport })).status, 400, 'invalid import rejected');
  equal((await request('/api/products?includeDrafts=1')).data.products.find((p) => p.id === draft.id).nameEn, before.nameEn, 'invalid import does not partially commit');
  const importSettings = structuredClone(settings);
  importSettings.categories = importSettings.categories.filter((c) => c.id !== 'New Category');
  equal((await request('/api/admin/import', { method: 'POST', body: { products: [{ ...before, category: 'Kitchenware' }], settings: importSettings } })).status, 200, 'atomic import can migrate category and remove old category together');
  equal((await request('/api/admin/import', { method: 'POST', body: { products: [{ ...before, category: 'Kitchenware', sku: 'IMMUTABLE-IMPORT' }] } })).status, 400, 'import cannot change existing SKU');
  const backup = await request('/api/admin/backup', { method: 'POST' });
  equal(backup.status, 201, 'manual backup works');
  const backupPath = join(temporaryRoot, 'data', 'backups', backup.data.backup.name);
  check((await readdir(backupPath)).includes('catalog.sqlite'), 'backup contains SQLite snapshot');
  check((await readdir(join(backupPath, 'media'))).length === 1, 'backup includes uploaded images');
  const snapshot = new DatabaseSync(join(backupPath, 'catalog.sqlite'), { readOnly: true });
  try { equal(snapshot.prepare('SELECT count(*) AS count FROM products').get().count, 111, 'backup is readable and contains current product data'); }
  finally { snapshot.close(); }
  equal(await readFile(join(backupPath, 'media', uploaded.data.url.split('/').at(-1))), png, 'backup preserves image bytes');
  const oldCookie = client.getCookie();
  await client.close();
  client = await start();
  request = client.request;
  client.setCookie(oldCookie);
  equal((await request('/api/admin/session')).data.authenticated, true, 'sessions persist across restarts');
  equal((await request('/api/products?includeDrafts=1')).data.products.length, 111, 'product edits persist across restarts');
  equal(await readFile(join(temporaryRoot, '.local', 'admin-access.txt'), 'utf8'), access, 'restart does not reset administrator');
  equal((await request('/api/admin/change-password', { method: 'POST', body: { currentPassword: password, newPassword: 'short' } })).status, 400, 'new password length validated');
  const nextPassword = 'Test-only-password-with-enough-length-2026';
  equal((await request('/api/admin/change-password', { method: 'POST', body: { currentPassword: password, newPassword: nextPassword } })).status, 200, 'password change');
  equal((await request('/api/admin/session')).data.authenticated, false, 'password change revokes old sessions');
  check(!(await readFile(join(temporaryRoot, '.local', 'admin-access.txt'), 'utf8')).includes(password), 'initial credential removed after password change');
  await client.login(nextPassword);
  equal((await request(`/api/products/${draft.id}`, { method: 'DELETE' })).status, 200, 'delete product');
  equal((await request('/api/admin/logout', { method: 'POST' })).status, 200, 'logout works');
  equal((await request('/api/admin/session')).data.authenticated, false, 'logout revokes session');
  for (let i = 0; i < 5; i++) equal((await request('/api/admin/login', { method: 'POST', body: { username: 'admin', password: 'incorrect' } })).status, 401, 'failed login rejected');
  equal((await request('/api/admin/login', { method: 'POST', body: { username: 'admin', password: nextPassword } })).status, 429, 'login rate limit enforced');
  check(client.app.db.prepare('SELECT count(*) AS count FROM audit_log').get().count > 10, 'administrative operations are audited');
  await client.close();

  // A one-record fixture verifies deletion persistence without touching the actual catalog.
  const smallSeedPath = join(temporaryRoot, 'small-seed.json');
  await writeFile(smallSeedPath, JSON.stringify({ products: [{ ...seeded[0], sku: undefined }] }));
  const smallOptions = { dataDir: join(temporaryRoot, 'small-data'), localDir: join(temporaryRoot, 'small-local'), seedPath: smallSeedPath };
  client = await start({ ...smallOptions, autoBackup: true });
  equal((await readdir(join(temporaryRoot, 'small-data', 'backups'))).length, 1, 'startup creates an automatic backup');
  const smallPassword = (await readFile(join(temporaryRoot, 'small-local', 'admin-access.txt'), 'utf8')).match(/^Password: (.+)$/m)[1];
  await client.login(smallPassword);
  const only = (await client.request('/api/products?includeDrafts=1')).data.products[0];
  equal((await client.request(`/api/products/${encodeURIComponent(only.id)}`, { method: 'DELETE' })).status, 200, 'last product deleted');
  await client.close();
  client = await start(smallOptions);
  equal((await client.request('/api/products')).data.products.length, 0, 'empty catalog stays empty after restart');
  await client.close();
  console.log(`API smoke tests passed: ${checks} checks. Only temporary databases were used.`);
} finally {
  for (const app of applications) await app.close();
  const resolved = resolve(temporaryRoot);
  if (!resolved.startsWith(resolve(tmpdir()) + '\\ymx-api-test-') && !resolved.startsWith(resolve(tmpdir()) + '/ymx-api-test-')) throw new Error('Refusing cleanup outside the test directory');
  await rm(resolved, { recursive: true, force: true });
}
