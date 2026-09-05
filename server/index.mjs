import http from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ApiError, validateProduct, validateSettings, validateCategoryReferences } from './validation.mjs';
import { initializeStore, listProducts, getProduct, saveProduct, getSettings, saveSettings, audit, transaction, verifyPassword, hashPassword, createBackup, waitForBackups } from './storage.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SESSION_AGE = 7 * 24 * 60 * 60 * 1000;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const error = (status, message) => { throw new ApiError(status, message); };

async function readBody(request, limit, contentType) {
  if (contentType && request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== contentType) error(415, `Expected ${contentType}`);
  if (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') error(415, 'Compressed request bodies are not supported');
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) error(413, 'Request body is too large');
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) { request.resume(); error(413, 'Request body is too large'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function jsonBody(request, limit = 4 * 1024 * 1024) {
  const buffer = await readBody(request, limit, 'application/json');
  let parsed;
  try { parsed = JSON.parse(buffer.toString('utf8')); } catch { error(400, 'Invalid JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) error(400, 'Request body must be an object');
  return parsed;
}

function imageExtension(body, contentType) {
  if (contentType === 'image/png' && body.length >= 24 && body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && body.toString('ascii', 12, 16) === 'IHDR' && body.readUInt32BE(16) > 0 && body.readUInt32BE(20) > 0) return '.png';
  if (contentType === 'image/jpeg' && body.length >= 4 && body[0] === 255 && body[1] === 216 && body[2] === 255 && body.at(-2) === 255 && body.at(-1) === 217) return '.jpg';
  if (contentType === 'image/webp' && body.length >= 20 && body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 8, 12) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(body.toString('ascii', 12, 16)) && body.readUInt32LE(4) === body.length - 8) return '.webp';
  error(415, 'File signature does not match PNG, JPEG or WebP');
}

export async function createCatalogServer(options = {}) {
  const dataDir = resolve(options.dataDir ?? process.env.CATALOG_DATA_DIR ?? join(ROOT, 'data'));
  const localDir = resolve(options.localDir ?? process.env.CATALOG_LOCAL_DIR ?? join(ROOT, '.local'));
  const seedPath = resolve(options.seedPath ?? join(ROOT, 'app/data/catalog.json'));
  const distDir = resolve(options.distDir ?? join(ROOT, 'dist'));
  const publicDir = resolve(options.publicDir ?? join(ROOT, 'public'));
  const host = options.host ?? process.env.HOST ?? '127.0.0.1';
  const requestedPort = Number(options.port ?? process.env.PORT ?? 3000);
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) throw new Error('Invalid PORT');
  const secureCookie = options.secureCookie ?? process.env.CATALOG_SECURE_COOKIE === '1';
  const configuredOrigins = options.allowedOrigins ?? (process.env.CATALOG_ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
  const allowedOrigins = new Set(configuredOrigins);
  for (const origin of allowedOrigins) {
    if (new URL(origin).origin !== origin || !/^https?:\/\//.test(origin)) throw new Error('CATALOG_ALLOWED_ORIGINS must contain exact HTTP(S) origins without paths');
  }
  const { db, accessFile } = await initializeStore({ dataDir, localDir, seedPath });
  let shuttingDown = false;

  function send(response, status, value, extraHeaders = {}) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
    response.end(JSON.stringify(value));
  }
  function session(request) {
    const value = (request.headers.cookie ?? '').split(';').map((part) => part.trim()).find((part) => part.startsWith('ymx_session='))?.slice('ymx_session='.length);
    if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) return undefined;
    return db.prepare('SELECT username,token_hash FROM sessions WHERE token_hash=? AND expires_at>?').get(sha256(value), Date.now());
  }
  function requireAdmin(request) {
    const user = session(request);
    if (!user) error(401, 'Administrator login required');
    return user;
  }
  function setSessionCookie(response, token = '') {
    response.setHeader('Set-Cookie', `ymx_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? Math.floor(SESSION_AGE / 1000) : 0}${secureCookie ? '; Secure' : ''}`);
  }
  function ensureSkuAvailable(product, existingId) {
    const duplicate = db.prepare('SELECT id FROM products WHERE sku = ? COLLATE NOCASE').get(product.sku);
    if (duplicate && duplicate.id !== existingId) error(409, `SKU already exists: ${product.sku}`);
  }
  async function serveFile(request, response, root, relative, cache = 'public, max-age=3600') {
    const target = resolve(root, relative);
    if (!target.startsWith(`${resolve(root)}${sep}`)) return false;
    let fullPath, rootPath, details;
    try {
      [fullPath, rootPath] = await Promise.all([realpath(target), realpath(root)]);
      if (!fullPath.startsWith(`${rootPath}${sep}`)) return false;
      details = await stat(fullPath);
    } catch { return false; }
    if (!details.isFile()) return false;
    const contentType = MIME[extname(fullPath).toLowerCase()];
    if (!contentType) return false;
    response.writeHead(200, { 'Content-Type': contentType, 'Content-Length': details.size, 'Cache-Control': cache });
    if (request.method === 'HEAD') { response.end(); return true; }
    const stream = createReadStream(fullPath);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
    return true;
  }

  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    try {
      if (shuttingDown) error(503, 'Server is restarting');
      let url;
      try { url = new URL(request.url, 'http://localhost'); } catch { error(400, 'Invalid URL'); }
      const path = url.pathname;
      const method = request.method;
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !allowedOrigins.has(request.headers.origin)) error(403, 'Request origin is not allowed');

      if (path === '/api/health' && method === 'GET') return send(response, 200, { ok: true });
      if (path === '/api/catalog' && method === 'GET') return send(response, 200, { products: listProducts(db), settings: getSettings(db) });
      if (path === '/api/products' && method === 'GET') {
        const includeDrafts = url.searchParams.get('includeDrafts') === '1';
        if (includeDrafts) requireAdmin(request);
        return send(response, 200, { products: listProducts(db, includeDrafts) });
      }
      if (path === '/api/admin/session' && method === 'GET') {
        const user = session(request);
        return send(response, 200, { authenticated: Boolean(user), username: user?.username ?? null });
      }
      if (path === '/api/admin/login' && method === 'POST') {
        const input = await jsonBody(request, 4096);
        if (typeof input.username !== 'string' || input.username.length > 100 || typeof input.password !== 'string' || input.password.length > 1024) error(400, 'Invalid login credentials');
        const ip = request.socket.remoteAddress ?? 'unknown';
        const now = Date.now();
        const limit = db.prepare('SELECT * FROM login_limits WHERE ip=?').get(ip);
        if (limit?.blocked_until > now) return send(response, 429, { error: 'Too many login attempts. Try again later.' }, { 'Retry-After': String(Math.ceil((limit.blocked_until - now) / 1000)) });
        const attempts = limit && now - limit.window_start < 15 * 60 * 1000 ? limit.attempts + 1 : 1;
        const windowStart = attempts === 1 ? now : limit.window_start;
        const blockedUntil = attempts >= 5 ? now + 15 * 60 * 1000 : 0;
        // Count before the asynchronous password check, so concurrent requests cannot bypass the limit.
        db.prepare('INSERT INTO login_limits(ip,attempts,window_start,blocked_until) VALUES(?,?,?,?) ON CONFLICT(ip) DO UPDATE SET attempts=excluded.attempts,window_start=excluded.window_start,blocked_until=excluded.blocked_until').run(ip, attempts, windowStart, blockedUntil);
        const admin = db.prepare('SELECT username,password_hash FROM admins LIMIT 1').get();
        const valid = await verifyPassword(input.password, admin.password_hash);
        if (!valid || input.username !== admin.username) {
          audit(db, 'anonymous', 'admin.login_failed', { ip });
          error(401, 'Invalid username or password');
        }
        const token = randomBytes(32).toString('base64url');
        transaction(db, () => {
          if (db.prepare('SELECT password_hash FROM admins WHERE username=?').get(admin.username).password_hash !== admin.password_hash) error(401, 'Password has changed. Sign in again.');
          const previous = session(request);
          if (previous) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(previous.token_hash);
          db.prepare('DELETE FROM login_limits WHERE ip=?').run(ip);
          db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now);
          db.prepare('INSERT INTO sessions(token_hash,username,expires_at) VALUES(?,?,?)').run(sha256(token), admin.username, now + SESSION_AGE);
          audit(db, admin.username, 'admin.login', { ip });
        });
        setSessionCookie(response, token);
        return send(response, 200, { authenticated: true, username: admin.username });
      }
      if (path === '/api/admin/logout' && method === 'POST') {
        const user = requireAdmin(request);
        db.prepare('DELETE FROM sessions WHERE token_hash=?').run(user.token_hash);
        audit(db, user.username, 'admin.logout');
        setSessionCookie(response);
        return send(response, 200, { authenticated: false, username: null });
      }
      if (path === '/api/admin/change-password' && method === 'POST') {
        const user = requireAdmin(request);
        const input = await jsonBody(request, 4096);
        if (typeof input.currentPassword !== 'string' || input.currentPassword.length > 1024 || typeof input.newPassword !== 'string' || input.newPassword.length < 12 || input.newPassword.length > 1024) error(400, 'New password must contain 12–1024 characters');
        const admin = db.prepare('SELECT password_hash FROM admins WHERE username=?').get(user.username);
        if (!await verifyPassword(input.currentPassword, admin.password_hash)) error(401, 'Current password is incorrect');
        if (input.currentPassword === input.newPassword) error(400, 'New password must be different');
        const newHash = await hashPassword(input.newPassword);
        transaction(db, () => {
          // A concurrent password change must not restore credentials based on an obsolete password.
          const current = db.prepare('SELECT password_hash FROM admins WHERE username=?').get(user.username);
          if (current.password_hash !== admin.password_hash) error(409, 'Password has already changed. Sign in again.');
          db.prepare('UPDATE admins SET password_hash=? WHERE username=?').run(newHash, user.username);
          db.prepare('DELETE FROM sessions WHERE username=?').run(user.username);
          audit(db, user.username, 'admin.password_changed');
        });
        await mkdir(localDir, { recursive: true });
        await writeFile(join(localDir, 'admin-access.txt'), 'Administrator: admin\nThe initial password has been changed. Use your current administrator password.\n', { mode: 0o600 });
        setSessionCookie(response);
        return send(response, 200, { ok: true, authenticated: false });
      }
      if (path === '/api/products' && method === 'POST') {
        const user = requireAdmin(request);
        const product = validateProduct(await jsonBody(request), getSettings(db));
        if (getProduct(db, product.id)) error(409, 'Product id already exists');
        ensureSkuAvailable(product);
        transaction(db, () => { saveProduct(db, product); audit(db, user.username, 'product.created', { id: product.id, sku: product.sku }); });
        return send(response, 201, { product });
      }
      if (path.startsWith('/api/products/') && ['PUT', 'DELETE'].includes(method)) {
        const user = requireAdmin(request);
        let id;
        try { id = decodeURIComponent(path.slice('/api/products/'.length)); } catch { error(400, 'Invalid product id'); }
        const existing = getProduct(db, id);
        if (!existing) error(404, 'Product not found');
        if (method === 'PUT') {
          const product = validateProduct(await jsonBody(request), getSettings(db), existing);
          ensureSkuAvailable(product, existing.id);
          transaction(db, () => { saveProduct(db, product); audit(db, user.username, 'product.updated', { id: product.id, sku: product.sku }); });
          return send(response, 200, { product });
        }
        await createBackup(db, dataDir, 'before-product-delete');
        transaction(db, () => { db.prepare('DELETE FROM products WHERE id=?').run(id); audit(db, user.username, 'product.deleted', { id, sku: existing.sku }); });
        return send(response, 200, { ok: true });
      }
      if (path === '/api/settings' && method === 'PUT') {
        const user = requireAdmin(request);
        const settings = validateSettings(await jsonBody(request), getSettings(db));
        validateCategoryReferences(listProducts(db, true), settings);
        transaction(db, () => { saveSettings(db, settings); audit(db, user.username, 'settings.updated'); });
        return send(response, 200, { settings });
      }
      if (path === '/api/uploads' && method === 'POST') {
        const user = requireAdmin(request);
        const contentType = request.headers['content-type']?.split(';')[0].trim().toLowerCase();
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(contentType)) error(415, 'Only PNG, JPEG and WebP uploads are allowed');
        const body = await readBody(request, 8 * 1024 * 1024);
        const extension = imageExtension(body, contentType);
        const filename = `${randomUUID()}${extension}`;
        await writeFile(join(dataDir, 'media', filename), body, { flag: 'wx', mode: 0o600 });
        audit(db, user.username, 'media.uploaded', { filename, bytes: body.length });
        return send(response, 201, { url: `/media/${filename}` });
      }
      if (path === '/api/admin/export' && method === 'GET') {
        const user = requireAdmin(request);
        audit(db, user.username, 'catalog.exported');
        return send(response, 200, { schemaVersion: 1, exportedAt: new Date().toISOString(), products: listProducts(db, true), settings: getSettings(db) }, { 'Content-Disposition': 'attachment; filename="ymx-catalog-backup.json"' });
      }
      if (path === '/api/admin/import' && method === 'POST') {
        const user = requireAdmin(request);
        const input = await jsonBody(request, 24 * 1024 * 1024);
        if (!Array.isArray(input.products) || input.products.length > 20000) error(400, 'Import requires a products array of at most 20000 entries');
        if (input.schemaVersion !== undefined && input.schemaVersion !== 1) error(400, 'Unsupported import schemaVersion');
        await createBackup(db, dataDir, 'before-import');
        let imported;
        transaction(db, () => {
          const settings = input.settings === undefined ? getSettings(db) : validateSettings(input.settings, getSettings(db));
          const ids = new Set();
          const skus = new Set();
          imported = input.products.map((entry) => {
            const existing = entry && typeof entry.id === 'string' ? getProduct(db, entry.id) : undefined;
            const product = validateProduct(entry, settings, existing);
            if (ids.has(product.id) || skus.has(product.sku.toLowerCase())) error(400, 'Duplicate product id or SKU in import');
            ids.add(product.id); skus.add(product.sku.toLowerCase());
            ensureSkuAvailable(product, existing?.id);
            return product;
          });
          for (const product of imported) saveProduct(db, product);
          validateCategoryReferences(listProducts(db, true), settings);
          saveSettings(db, settings);
          audit(db, user.username, 'catalog.imported', { count: imported.length });
        });
        return send(response, 200, { imported: imported.length, products: listProducts(db, true), settings: getSettings(db) });
      }
      if (path === '/api/admin/backup' && method === 'POST') {
        const user = requireAdmin(request);
        const result = await createBackup(db, dataDir);
        audit(db, user.username, 'catalog.backup_requested', { name: result.name });
        return send(response, 201, { backup: result });
      }
      if (path.startsWith('/api/')) error(404, 'API endpoint not found');
      if (!['GET', 'HEAD'].includes(method)) error(405, 'Method not allowed');
      let decoded;
      try { decoded = decodeURIComponent(path); } catch { error(400, 'Invalid path'); }
      if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some((part) => part === '..' || part.startsWith('.'))) error(400, 'Invalid path');
      if (decoded.startsWith('/media/')) {
        if (!/^\/media\/[a-zA-Z0-9-]+\.(png|jpg|webp)$/.test(decoded)) error(404, 'Image not found');
        if (await serveFile(request, response, join(dataDir, 'media'), decoded.slice('/media/'.length))) return;
        error(404, 'Image not found');
      }
      if (decoded.startsWith('/catalog-products/')) {
        if (await serveFile(request, response, publicDir, decoded.slice(1))) return;
        error(404, 'Image not found');
      }
      if (await serveFile(request, response, distDir, decoded.slice(1), decoded.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')) return;
      if (!extname(decoded) && await serveFile(request, response, distDir, 'index.html', 'no-cache')) return;
      error(404, 'Not found. Build the frontend before starting production.');
    } catch (caught) {
      if (response.headersSent) { response.destroy(); return; }
      const status = caught instanceof ApiError ? caught.status : 500;
      if (status === 500) console.error(`[catalog] ${caught.code ?? caught.name ?? 'Error'} while handling ${request.method} request`);
      send(response, status, { error: status === 500 ? 'Internal server error' : caught.message });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.maxHeadersCount = 100;
  try {
    if (options.autoBackup !== false) await createBackup(db, dataDir, 'startup');
    await new Promise((resolveListening, reject) => { server.once('error', reject); server.listen(requestedPort, host, resolveListening); });
  } catch (failure) { db.close(); throw failure; }
  const port = server.address().port;
  for (const localHost of ['127.0.0.1', 'localhost']) {
    allowedOrigins.add(`http://${localHost}:${port}`);
    allowedOrigins.add(`http://${localHost}:5173`);
  }
  let backupTimer;
  if (options.autoBackup !== false) {
    backupTimer = setInterval(() => createBackup(db, dataDir, 'daily').catch(() => console.error('[catalog] Scheduled backup failed')), 24 * 60 * 60 * 1000);
    backupTimer.unref();
  }
  return {
    server, port, host, db, dataDir, accessFile,
    async close() {
      shuttingDown = true;
      clearInterval(backupTimer);
      await new Promise((done, reject) => server.close((err) => err ? reject(err) : done()));
      await waitForBackups();
      db.close();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  createCatalogServer().then((app) => {
    console.log(`YMX catalog: http://${app.host}:${app.port}`);
    if (app.accessFile) console.log(`Initial administrator credentials were saved locally: ${app.accessFile}`);
    console.log(`Database and uploaded images: ${app.dataDir}`);
    let closing = false;
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
      if (closing) return;
      closing = true;
      try { await app.close(); process.exitCode = 0; } catch { process.exitCode = 1; }
    });
  }).catch((failure) => { console.error(`Cannot start catalog server: ${failure.message}`); process.exitCode = 1; });
}
