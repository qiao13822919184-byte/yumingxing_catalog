/** Deterministic GitHub transport tests: no credentials, network, or repository writes. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGitHubStore, GITHUB_REPOSITORY, GITHUB_PUBLIC_URL } from '../app/admin/github-store.ts';

const TOKEN = 'github_pat_FAKE_FOR_UNIT_TESTS_ONLY';
const SHA = 'a'.repeat(40), NEXT = 'b'.repeat(40), OTHER = 'c'.repeat(40);
const product = { id: 'product/1', sku: 'YMX-001', order: 1, catalogId: 'CAT-1', imageId: '1', model: 'Model-1', category: 'Kitchenware', nameEn: 'Kitchen set', nameZh: '厨房套装', image: '/catalog-products/main.png', published: true, verificationStatus: 'Verified', components: Array.from({ length: 4 }, (_, i) => ({ id: `component-${i}`, nameEn: `Piece ${i}`, nameZh: `组件 ${i}`, material: '304', size: '10cm', weightG: '', thicknessMm: '', quantity: '1', unit: 'pcs' })), attributes: [], gallery: [], blocks: [], descriptionEn: '', descriptionZh: '' };
const settings = { brand: 'YUMINGXING', whatsapp: '8615992577610', headlineEn: 'Everyday pieces', headlineZh: '餐厨用具', accent: '#b4472d', columns: 3, categories: [{ id: 'Kitchenware', nameEn: 'Kitchenware', nameZh: '厨房用具', image: '/catalog-products/main.png', descriptionEn: '', descriptionZh: '' }] };
const source = { schemaVersion: 1, products: [product], settings };
const clone = value => structuredClone(value);
const checks = [];
async function test(name, fn) { await fn(); checks.push(name); }
function fakeGitHub(configuration = {}) {
  const calls = [], blobs = [], trees = [], commits = [], updates = [], revoked = [];
  let head = SHA, treeSha = 'tree-0', uuid = 0, status = null, race = false, failPublish = false;
  const files = new Map([['content/catalog.json', { path: 'content/catalog.json', type: 'blob', sha: 'catalog-0' }], ['public/catalog-products/main.png', { path: 'public/catalog-products/main.png', type: 'blob', sha: 'image-0' }]]);
  const contents = new Map([['catalog-0', JSON.stringify(source)]]);
  const respond = (data, code = 200) => new Response(JSON.stringify(data), { status: code, headers: { 'Content-Type': 'application/json' } });
  const fetcher = async (input, options = {}) => {
    const url = new URL(input), method = options.method || 'GET', body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url: input, method, options, body });
    assert.equal(url.origin, 'https://api.github.com');
    assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    assert.equal(options.headers['X-GitHub-Api-Version'], '2022-11-28');
    if (url.pathname.endsWith('/actions/runs')) {
      assert.equal(options.headers.Authorization, undefined, 'Public workflow query must not send token');
      if (configuration.actionsDenied) return respond({}, 403);
      return respond({ workflow_runs: status ? [{ id: 1, path: '.github/workflows/pages.yml', name: 'Deploy Pages', status: status === 'pending' ? 'in_progress' : 'completed', conclusion: status === 'success' ? 'success' : status === 'failure' ? 'failure' : null, html_url: `https://github.com/${GITHUB_REPOSITORY}/actions/runs/1` }] : [] });
    }
    if (configuration.rejectAuth || options.headers.Authorization !== `Bearer ${TOKEN}`) return respond({ message: 'Bad credentials' }, 401);
    const path = url.pathname.replace(`/repos/${GITHUB_REPOSITORY}`, '');
    if (path === '/user') return respond({ login: 'catalogue-admin' });
    if (path === '') return respond({ full_name: GITHUB_REPOSITORY, ...(configuration.permissionsMissing ? {} : { permissions: { push: configuration.readOnly ? false : true } }) });
    if (path === '/git/ref/heads/main') return respond({ object: { sha: head } });
    if (path.startsWith('/git/commits/') && method === 'GET') return respond({ tree: { sha: treeSha } });
    if (path.startsWith('/git/trees/') && method === 'GET') return respond({ truncated: false, tree: [...files.values()] });
    if (path.startsWith('/git/blobs/') && method === 'GET') { const content = contents.get(path.split('/').pop()); return respond({ content: Buffer.from(content).toString('base64'), encoding: 'base64', size: Buffer.byteLength(content) }); }
    if (failPublish && method !== 'GET') return respond({ message: TOKEN }, 403);
    if (path === '/git/blobs' && method === 'POST') { const sha = `blob-${blobs.length + 1}`; blobs.push({ ...body, sha }); contents.set(sha, body.content); return respond({ sha }); }
    if (path === '/git/trees' && method === 'POST') { trees.push(body); return respond({ sha: 'tree-new' }); }
    if (path === '/git/commits' && method === 'POST') { commits.push(body); return respond({ sha: NEXT }); }
    if (path === '/git/refs/heads/main' && method === 'PATCH') {
      updates.push(body); if (race) { head = OTHER; return respond({}, 422); }
      head = body.sha; treeSha = 'tree-new'; for (const entry of trees.at(-1).tree) files.set(entry.path, entry); return respond({ object: { sha: head } });
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  };
  const store = createGitHubStore({ fetch: fetcher, randomUUID: () => `test-${++uuid}`, createObjectURL: () => `blob:test-${uuid}`, revokeObjectURL: url => revoked.push(url) });
  return { store, calls, blobs, trees, commits, updates, revoked, setHead: value => { head = value; }, setRace: value => { race = value; }, setFailure: value => { failPublish = value; }, setStatus: value => { status = value; }, configuration };
}
async function login(fixture) { return fixture.store.request('/api/admin/login', 'POST', { token: TOKEN }); }
async function change(fixture, patch = { nameZh: '新产品名称' }) { return fixture.store.request(`/api/products/${encodeURIComponent(product.id)}`, 'PUT', { ...product, ...patch }); }
const png = () => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])], 'product.png', { type: 'image/png' });

await test('Unauthenticated reads and all mutations require GitHub authentication', async () => {
  const f = fakeGitHub(); assert.equal((await f.store.request('/api/admin/session')).authenticated, false);
  await assert.rejects(f.store.request('/api/products'), /登录/); await assert.rejects(change(f), /登录/); await assert.rejects(f.store.upload(png()), /登录/); await assert.rejects(f.store.publish(), /登录/); assert.equal(f.calls.length, 0);
});
await test('Invalid password, bad token and read-only repository are rejected without writes', async () => {
  for (const config of [{}, { rejectAuth: true }, { readOnly: true }]) { const f = fakeGitHub(config); await assert.rejects(f.store.request('/api/admin/login', 'POST', { token: Object.keys(config).length ? TOKEN : 'my-password' })); assert.equal(f.store.state().authenticated, false); assert.ok(f.calls.every(call => call.method === 'GET')); }
});
await test('Login reads a single HEAD and exact commit tree/blob with no browser credential persistence', async () => {
  const f = fakeGitHub(); assert.equal((await login(f)).username, 'catalogue-admin'); assert.equal(f.store.state().commitSha, SHA); assert.equal(f.store.state().pending, false);
  assert.ok(f.calls.some(call => call.url.endsWith(`/git/commits/${SHA}`))); assert.ok(f.calls.some(call => call.url.endsWith('/git/blobs/catalog-0')));
  assert.equal((await f.store.request('/api/products?includeDrafts=1')).products.length, 1); assert.ok(!JSON.stringify(await f.store.request('/api/admin/export')).includes(TOKEN));
  const code = await readFile(new URL('../app/admin/github-store.ts', import.meta.url), 'utf8'); assert.ok(!/localStorage|sessionStorage|document\.cookie|console\./.test(code));
});
await test('Missing GitHub push metadata does not falsely claim confirmed write permission', async () => {
  const f = fakeGitHub({ permissionsMissing: true }); await login(f); assert.equal(f.store.state().pushPermission, 'unverified');
});
await test('Product CRUD stays in memory, keeps SKU immutable and grows four components to nine', async () => {
  const f = fakeGitHub(); await login(f); const count = f.calls.length;
  const components = Array.from({ length: 9 }, (_, index) => ({ ...product.components[0], id: `new-${index}`, nameEn: `Piece ${index}` }));
  assert.equal((await change(f, { components })).product.components.length, 9); assert.equal(f.store.state().pending, true);
  await assert.rejects(change(f, { sku: 'ALTERED' }), /SKU/);
  await assert.rejects(f.store.request('/api/products', 'POST', { ...product, id: 'duplicate', sku: 'ymx-001' }), /SKU/);
  const draft = (await f.store.request('/api/products', 'POST', { ...product, id: 'new', sku: 'NEW-1', published: false })).product;
  assert.equal(draft.published, false); await f.store.request('/api/products/new', 'DELETE'); assert.equal((await f.store.request('/api/products')).products.length, 1);
  assert.equal(f.calls.length, count, 'Saving product must not make remote API writes');
});
await test('Deletion and re-creation cannot change an original SKU', async () => {
  const f = fakeGitHub(); await login(f); await f.store.request(`/api/products/${encodeURIComponent(product.id)}`, 'DELETE');
  await assert.rejects(f.store.request('/api/products', 'POST', { ...product, sku: 'NEW' }), /SKU/);
});
await test('Unverified publication, malformed components and missing images are rejected atomically', async () => {
  const f = fakeGitHub(); await login(f);
  for (const patch of [{ verificationStatus: 'Needs confirmation' }, { components: {} }, { components: [product.components[0], product.components[0]] }, { image: 'https://evil.invalid/a.png' }, { image: '/media/missing.png' }]) await assert.rejects(change(f, patch));
  assert.equal(f.store.state().pending, false);
});
await test('Category references, settings validation and atomic import preserve existing workspace on failure', async () => {
  const f = fakeGitHub(); await login(f);
  await assert.rejects(f.store.request('/api/settings', 'PUT', { ...settings, categories: [] }), /分类/);
  await assert.rejects(f.store.request('/api/settings', 'PUT', { ...settings, whatsapp: '+8615992577610' }), /WhatsApp/);
  await assert.rejects(f.store.request('/api/admin/import', 'POST', { products: [{ ...product, nameZh: 'Should not persist' }, { ...product, id: 'other' }] }), /SKU/);
  assert.equal((await f.store.request('/api/products')).products[0].nameZh, product.nameZh);
  await assert.rejects(f.store.request('/api/admin/import', 'POST', { products: [{ ...product, image: '/media/missing.png' }] }), /图片不存在/);
  await f.store.request('/api/admin/import', 'POST', { products: [{ ...product, nameZh: '已导入' }], settings: { ...settings, brand: 'NEW BRAND' } });
  assert.equal((await f.store.request('/api/admin/export')).settings.brand, 'NEW BRAND'); assert.equal(f.store.state().pending, true);
});
await test('Uploads validate format/size and use only memory object URLs for preview', async () => {
  const f = fakeGitHub(); await login(f); const count = f.calls.length;
  await assert.rejects(f.store.upload(new File(['<svg/>'], 'a.png', { type: 'image/png' })), /类型/);
  await assert.rejects(f.store.upload(new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'a.png', { type: 'image/png' })), /8 MB/);
  const path = await f.store.upload(png()); assert.match(path, /^\/media\/test-\d+\.png$/); assert.match(f.store.imageUrl(path), /^blob:/); assert.equal(f.calls.length, count);
  assert.equal(f.store.imageUrl('https://evil.invalid/p.png'), ''); assert.ok(f.store.imageUrl(product.image).includes(`/${SHA}/public/catalog-products/main.png`));
  assert.equal(f.store.state().pending, false, 'An unused upload alone does not change catalogue content');
  await f.store.request('/api/admin/logout', 'POST'); assert.equal(f.revoked.length, 1); assert.equal(f.store.state().authenticated, false);
});
await test('Publishing atomically updates only content JSON and referenced media, never unused uploads or credentials', async () => {
  const f = fakeGitHub(); await login(f); const path = await f.store.upload(png()); const unused = await f.store.upload(png());
  await change(f, { image: path }); const result = await f.store.publish(); assert.deepEqual(result, { sha: NEXT, url: GITHUB_PUBLIC_URL });
  assert.deepEqual(f.trees[0].tree.map(entry => entry.path).sort(), ['content/catalog.json', `content${path}`].sort());
  assert.ok(!f.trees[0].tree.some(entry => entry.path.includes(unused))); assert.equal(f.trees[0].base_tree, 'tree-0');
  assert.deepEqual(f.commits[0].parents, [SHA]); assert.deepEqual(f.updates, [{ sha: NEXT, force: false }]);
  assert.ok(!JSON.stringify([...f.blobs, ...f.trees, ...f.commits, ...f.updates]).includes(TOKEN));
  assert.equal(f.store.state().pending, false); assert.equal(f.store.state().lastPublishedSha, NEXT);
  assert.equal(JSON.parse(f.blobs[0].content).products[0].image, path); assert.equal(f.blobs[1].encoding, 'base64');
  await assert.rejects(f.store.publish(), /没有待发布/);
  await change(f, { image: path, nameZh: '第二次修改' }); await f.store.publish();
  assert.equal(f.trees[1].tree.length, 1, 'Previously committed image must not be overwritten with empty bytes');
});
await test('Remote preflight conflict performs no writes and preserves edits', async () => {
  const f = fakeGitHub(); await login(f); await change(f); f.setHead(OTHER); await assert.rejects(f.store.publish(), /其他新提交/);
  assert.equal(f.blobs.length, 0); assert.equal(f.store.state().pending, true); assert.equal((await f.store.request('/api/products')).products[0].nameZh, '新产品名称');
});
await test('Race after preflight uses non-force update and leaves pending edits', async () => {
  const f = fakeGitHub(); await login(f); await change(f); f.setRace(true); await assert.rejects(f.store.publish(), /远端/);
  assert.deepEqual(f.updates, [{ sha: NEXT, force: false }]); assert.equal(f.store.state().commitSha, SHA); assert.equal(f.store.state().pending, true);
});
await test('Permission errors do not echo remote bodies or discard editing state', async () => {
  const f = fakeGitHub(); await login(f); await change(f); f.setFailure(true);
  await assert.rejects(f.store.publish(), error => error.message.includes('Contents') && !error.message.includes(TOKEN)); assert.equal(f.store.state().pending, true); assert.equal(f.store.state().authenticated, true);
});
await test('401 preserves drafts and export, then re-authentication reconnects without loading over edits', async () => {
  const f = fakeGitHub(); await login(f); await change(f); f.configuration.rejectAuth = true; await assert.rejects(f.store.publish(), /过期/);
  assert.equal(f.store.state().authenticated, false); assert.equal(f.store.state().pending, true); assert.equal((await f.store.request('/api/admin/export')).products[0].nameZh, '新产品名称');
  f.configuration.rejectAuth = false; const before = f.calls.length; await login(f); assert.equal(f.calls.length - before, 2); assert.equal((await f.store.request('/api/products')).products[0].nameZh, '新产品名称');
});
await test('Accidentally placing a token in catalog text cannot publish it', async () => {
  const f = fakeGitHub(); await login(f); await change(f, { descriptionEn: TOKEN }); await assert.rejects(f.store.publish(), /包含当前访问令牌/); assert.equal(f.blobs.length, 0);
});
await test('Public deployment state distinguishes pending/success/failure/unknown without Actions token permission', async () => {
  const f = fakeGitHub(); await login(f); assert.equal((await f.store.deployment(SHA)).status, 'pending');
  for (const status of ['pending', 'success', 'failure']) { f.setStatus(status); assert.equal((await f.store.deployment(SHA)).status, status); }
  f.configuration.actionsDenied = true; assert.equal((await f.store.deployment(SHA)).status, 'unknown'); await assert.rejects(f.store.deployment('../main'), /编号/);
});
await test('Logout clears workspace, pending state and credential authorization', async () => {
  const f = fakeGitHub(); await login(f); await change(f); await f.store.request('/api/admin/logout', 'POST'); assert.equal(f.store.state().pending, false); assert.equal(f.store.state().commitSha, ''); await assert.rejects(f.store.request('/api/admin/export'), /登录/);
});
console.log(`GitHub admin adapter: ${checks.length} scenarios passed.`);
for (const check of checks) console.log(`  ✓ ${check}`);
