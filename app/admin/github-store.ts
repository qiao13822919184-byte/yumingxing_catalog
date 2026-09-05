import type { Product, SiteSettings, ComponentSpec } from '../catalog-types';

export const isGitHubAdmin = import.meta.env?.MODE === 'pages';
export const GITHUB_REPOSITORY = 'qiao13822919184-byte/yumingxing_catalog';
export const GITHUB_PUBLIC_URL = 'https://qiao13822919184-byte.github.io/yumingxing_catalog/';
const API = `https://api.github.com/repos/${GITHUB_REPOSITORY}`;
const CONTENT_PATH = 'content/catalog.json';
const MAX_IMAGE = 8 * 1024 * 1024;
type Catalog = { schemaVersion: 1; products: Product[]; settings: SiteSettings };
type TreeEntry = { path: string; type: string; sha: string };
type PendingImage = { bytes: Uint8Array; url: string };
type Options = { fetch?: typeof fetch; createObjectURL?: (blob: Blob) => string; revokeObjectURL?: (url: string) => void; randomUUID?: () => string };
type Deployment = { status: 'pending' | 'success' | 'failure' | 'unknown'; url: string; actionsUrl: string };
const copy = <T,>(value: T): T => structuredClone(value);
const fail = (message: string): never => { throw new Error(message); };
const object = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(`${label}格式无效。`);
  return value as Record<string, unknown>;
};
const text = (value: unknown, label: string, max = 500, required = false): string => {
  if (value === undefined) value = '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) return fail(`${label}格式或长度无效。`);
  const result = value.trim();
  if (required && !result) return fail(`请填写${label}。`);
  return result;
};
const list = (value: unknown, label: string, max = 1000): unknown[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) return fail(`${label}必须为数组，且最多 ${max} 项。`);
  return value;
};
const unique = (values: string[], label: string) => { if (new Set(values).size !== values.length) fail(`${label}重复。`); };
export function githubImagePath(value: unknown, label = '图片'): string {
  const path = text(value, label, 1500);
  if (path && (!/^\/(?:media|catalog-products)\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:png|jpe?g|webp)$/i.test(path) || path.includes('..'))) fail(`${label}路径无效，请上传 PNG、JPEG 或 WebP 图片。`);
  return path;
}
const repositoryImagePath = (path: string) => path.startsWith('/media/') ? `content${path}` : `public${path}`;

function validateSettings(input: unknown, previous?: SiteSettings): SiteSettings {
  const data = { ...previous, ...object(input, '页面设置') };
  const categories = list(data.categories, '分类', 200).map(entry => {
    const category = object(entry, '分类');
    return { id: text(category.id, '分类 ID', 100, true), nameEn: text(category.nameEn, '分类英文名', 150, true), nameZh: text(category.nameZh, '分类中文名', 150), image: githubImagePath(category.image), descriptionEn: text(category.descriptionEn, '分类描述', 3000), descriptionZh: text(category.descriptionZh, '分类描述', 3000) };
  });
  unique(categories.map(category => category.id.toLowerCase()), '分类 ID');
  const whatsapp = text(data.whatsapp, 'WhatsApp 号码', 15, true);
  if (!/^[1-9][0-9]{6,14}$/.test(whatsapp)) fail('WhatsApp 号码须为含国家区号的 7–15 位数字，不带 +。');
  const accent = text(data.accent, '强调色', 7, true);
  if (!/^#[0-9a-f]{6}$/i.test(accent)) fail('强调色须为 6 位十六进制颜色。');
  if (typeof data.columns !== 'number' || !Number.isInteger(data.columns) || data.columns < 2 || data.columns > 5) fail('产品列数须为 2–5 的整数。');
  return { brand: text(data.brand, '品牌', 100, true), whatsapp, headlineEn: text(data.headlineEn, '英文标题', 300), headlineZh: text(data.headlineZh, '中文标题', 300), accent, columns: data.columns as number, categories };
}

function validateProduct(input: unknown, settings: SiteSettings, uuid: () => string, existing?: Product): Product {
  const source = object(input, '产品');
  if (existing && source.id !== undefined && source.id !== existing.id) fail('既有产品 ID 不能更改。');
  if (existing && source.sku !== undefined && source.sku !== existing.sku) fail('既有产品 SKU 不能更改。');
  const data = { id: uuid(), order: 0, category: settings.categories[0]?.id ?? '', published: false, verificationStatus: 'Needs confirmation', ...existing, ...source } as Record<string, unknown>;
  const id = text(data.id, '产品 ID', 160, true), sku = text(data.sku, 'SKU', 120, true);
  if (/[\r\n\t]/.test(id + sku)) fail('产品 ID 和 SKU 不可包含换行或制表符。');
  if (typeof data.order !== 'number' || !Number.isSafeInteger(data.order) || data.order < 0) fail('展示顺序须为非负整数。');
  if (typeof data.published !== 'boolean') fail('上架状态格式无效。');
  if (!['Verified', 'Needs confirmation', 'Reference only'].includes(String(data.verificationStatus))) fail('资料核验状态无效。');
  if (data.published && data.verificationStatus !== 'Verified') fail('仅资料已核验（Verified）的产品可上架。');
  const category = text(data.category, '分类', 100, true);
  if (!settings.categories.some(entry => entry.id === category)) fail('产品引用的分类不存在，请先创建分类。');
  const components = list(data.components, '组件').map(entry => {
    const component = object(entry, '组件');
    const result = { id: text(component.id ?? uuid(), '组件 ID', 160, true) } as ComponentSpec;
    for (const key of ['nameEn', 'nameZh', 'material', 'size', 'weightG', 'thicknessMm', 'quantity', 'unit'] as const) result[key] = text(component[key], `组件 ${key}`, 1000);
    return result;
  });
  unique(components.map(component => component.id), '组件 ID');
  const attributes = list(data.attributes, '自定义属性').map(entry => {
    const attribute = object(entry, '自定义属性');
    return { id: text(attribute.id ?? uuid(), '属性 ID', 160, true), label: text(attribute.label, '属性名', 300, true), value: text(attribute.value, '属性值', 3000) };
  });
  unique(attributes.map(attribute => attribute.id), '属性 ID');
  const blocks = list(data.blocks, '详情区块', 300).map(entry => {
    const block = object(entry, '详情区块');
    if (block.type !== 'text' && block.type !== 'image') fail('详情区块须为 text 或 image。');
    return { id: text(block.id ?? uuid(), '区块 ID', 160, true), type: block.type as 'text' | 'image', title: text(block.title, '区块标题', 300), content: block.type === 'image' ? githubImagePath(block.content, '详情图片') : text(block.content, '详情文字', 20000) };
  });
  unique(blocks.map(block => block.id), '区块 ID');
  const result: Product = { id, sku, order: data.order as number, category, published: data.published as boolean, verificationStatus: data.verificationStatus as string, components, attributes, blocks, image: githubImagePath(data.image), gallery: list(data.gallery, '图库', 200).map(path => githubImagePath(path)), catalogId: text(data.catalogId, '原货号', 500), imageId: text(data.imageId, '图片编号', 500), model: text(data.model, '型号', 500), nameEn: text(data.nameEn, '英文名称', 500), nameZh: text(data.nameZh, '中文名称', 500), descriptionEn: text(data.descriptionEn, '英文说明', 20000), descriptionZh: text(data.descriptionZh, '中文说明', 20000) };
  if (result.published && (!result.nameEn || !result.image)) fail('已上架产品须有英文名称和主图。');
  return result;
}

function validateAll(products: Product[], settings: SiteSettings) {
  unique(products.map(product => product.id), '产品 ID');
  unique(products.map(product => product.sku.toLowerCase()), 'SKU');
  const missing = products.find(product => !settings.categories.some(category => category.id === product.category));
  if (missing) fail(`分类仍被 SKU ${missing.sku} 使用，请先调整其分类。`);
}
function referencedImages(catalog: Catalog): Set<string> {
  const paths = new Set(catalog.settings.categories.map(category => category.image).filter(Boolean));
  for (const product of catalog.products) for (const path of [product.image, ...(product.gallery ?? []), ...(product.blocks ?? []).filter(block => block.type === 'image').map(block => block.content)]) if (path) paths.add(path);
  return paths;
}
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
  return btoa(binary);
}
function decodeContent(content: string): string { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(content.replace(/\s/g, '')), char => char.charCodeAt(0))); }

/** Credentials and draft media live only in this closure, never in storage or a URL. */
export function createGitHubStore(options: Options = {}) {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const uuid = options.randomUUID ?? (() => crypto.randomUUID());
  const createUrl = options.createObjectURL ?? (blob => URL.createObjectURL(blob));
  const revokeUrl = options.revokeObjectURL ?? (url => URL.revokeObjectURL(url));
  let token = '', username = '', baseSha = '', baseTree = '', baseline = '', publishing = false;
  let lastPublishedSha: string | null = null;
  let pushPermission: 'confirmed' | 'unverified' = 'unverified';
  let workspace: Catalog | null = null;
  let files = new Map<string, TreeEntry>();
  const media = new Map<string, PendingImage>();
  const originalSkus = new Map<string, string>();
  function authenticated() { if (!token || !workspace) fail('请先使用 GitHub 访问令牌登录。'); }
  function mutable() { authenticated(); if (publishing) fail('正在发布，请等待完成后再编辑。'); }
  function state() { return { pending: !!workspace && JSON.stringify(workspace) !== baseline, commitSha: baseSha, lastPublishedSha, username, authenticated: !!token && !!workspace, pushPermission }; }
  function clear() { token = ''; username = ''; workspace = null; baseSha = ''; baseTree = ''; baseline = ''; lastPublishedSha = null; files.clear(); originalSkus.clear(); for (const item of media.values()) revokeUrl(item.url); media.clear(); }
  async function api<T>(path: string, method = 'GET', body?: unknown, credential = token): Promise<T> {
    if (!credential) fail('请先登录 GitHub。');
    // Only fixed GitHub API paths are accepted; redirects cannot forward the token.
    if ((path !== '' && !path.startsWith('/')) || path.includes('://') || path.includes('..')) fail('GitHub 请求路径无效。');
    const url = path === '/user' ? 'https://api.github.com/user' : `${API}${path}`;
    let response: Response;
    try { response = await fetcher(url, { method, cache: 'no-store', redirect: 'error', credentials: 'omit', headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${credential}`, 'X-GitHub-Api-Version': '2022-11-28', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
    catch { return fail('无法连接 GitHub，请检查网络后重试；编辑内容仍保留。'); }
    if (!response.ok) {
      if (response.status === 401) { if (credential === token) token = ''; fail('GitHub 令牌无效或已过期，请重新登录；编辑内容仍保留。'); }
      if (response.status === 403) fail('GitHub 拒绝请求：请检查令牌的仓库 Contents 读写权限、有效期与 API 额度；编辑内容仍保留。');
      if (response.status === 404) fail('GitHub 资源不可访问，请确认令牌授权了本仓库及所需权限；编辑内容仍保留。');
      if (response.status === 409 || response.status === 422) fail('GitHub 拒绝更新：远端可能已有新提交或分支受保护；编辑内容仍保留，请先导出备份再重新载入。');
      fail(`GitHub 请求失败（${response.status}），编辑内容仍保留，请稍后重试。`);
    }
    return (response.status === 204 ? {} : await response.json()) as T;
  }
  async function login(body: unknown) {
    if (publishing) fail('请等待发布完成。');
    const candidate = text(object(body, '登录信息').token, 'GitHub 访问令牌', 500, true);
    if (!/^(?:github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9]+)$/.test(candidate)) fail('请输入 GitHub Personal Access Token（github_pat_ 或 ghp_ 开头），不是账号密码。');
    const user = await api<{ login: string }>('/user', 'GET', undefined, candidate);
    const repository = await api<{ full_name: string; archived?: boolean; permissions?: { push?: boolean } }>('', 'GET', undefined, candidate);
    if (repository.full_name !== GITHUB_REPOSITORY || repository.archived || repository.permissions?.push === false) fail('当前 GitHub 账号不能修改指定仓库。');
    // Re-authentication after a 401 preserves the current workspace and its base commit.
    if (workspace) { token = candidate; username = user.login; pushPermission = repository.permissions?.push ? 'confirmed' : 'unverified'; return { authenticated: true, username }; }
    const ref = await api<{ object: { sha: string } }>('/git/ref/heads/main', 'GET', undefined, candidate);
    const commit = await api<{ tree: { sha: string } }>(`/git/commits/${ref.object.sha}`, 'GET', undefined, candidate);
    const tree = await api<{ truncated: boolean; tree: TreeEntry[] }>(`/git/trees/${commit.tree.sha}?recursive=1`, 'GET', undefined, candidate);
    if (tree.truncated) fail('仓库文件过多，无法完整校验图片，请联系维护人员。');
    const catalogEntry = tree.tree.find(entry => entry.path === CONTENT_PATH && entry.type === 'blob');
    if (!catalogEntry) return fail('仓库尚未配置线上管理资料 content/catalog.json。');
    const blob = await api<{ content: string; encoding: string; size: number }>(`/git/blobs/${catalogEntry.sha}`, 'GET', undefined, candidate);
    if (blob.encoding !== 'base64' || blob.size > 20 * 1024 * 1024) fail('图册资料编码或大小无效。');
    let source: Record<string, unknown>;
    try { source = object(JSON.parse(decodeContent(blob.content)), '图册'); } catch { return fail('仓库图册 JSON 格式无效，请检查 content/catalog.json。'); }
    if (source.schemaVersion !== 1) fail('图册资料版本不支持。');
    const settings = validateSettings(source.settings);
    const products = list(source.products, '产品', 10000).map(product => validateProduct(product, settings, uuid));
    validateAll(products, settings);
    workspace = { schemaVersion: 1, products, settings }; baseline = JSON.stringify(workspace);
    baseSha = ref.object.sha; baseTree = commit.tree.sha; files = new Map(tree.tree.map(entry => [entry.path, entry]));
    for (const product of products) originalSkus.set(product.id, product.sku);
    token = candidate; username = user.login; pushPermission = repository.permissions?.push ? 'confirmed' : 'unverified';
    return { authenticated: true, username };
  }
  function checkedProduct(input: unknown, settings: SiteSettings, existing?: Product) {
    const product = validateProduct(input, settings, uuid, existing);
    if (originalSkus.has(product.id) && originalSkus.get(product.id) !== product.sku) fail('既有产品 SKU 不能更改。');
    return product;
  }
  function validateImages(catalog: Catalog) {
    for (const path of referencedImages(catalog)) if (!media.has(path) && files.get(repositoryImagePath(path))?.type !== 'blob') fail(`图片不存在：${path}。请重新上传图片后保存。`);
  }
  async function request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
    method = method.toUpperCase();
    if (url === '/api/admin/session' && method === 'GET') return { authenticated: !!token && !!workspace, username } as T;
    if (url === '/api/admin/login' && method === 'POST') return await login(body) as T;
    if (url === '/api/admin/logout' && method === 'POST') { if (publishing) fail('请等待发布完成后退出。'); clear(); return { ok: true } as T; }
    if (url === '/api/admin/export' && method === 'GET' && workspace) return copy(workspace) as T;
    authenticated();
    const catalog = workspace!;
    if (method !== 'GET') mutable();
    if ((url === '/api/catalog' || url === '/api/products' || url === '/api/products?includeDrafts=1') && method === 'GET') return copy({ products: catalog.products, settings: catalog.settings }) as T;
    if (url === '/api/admin/export' && method === 'GET') return copy(catalog) as T;
    if (url === '/api/products' && method === 'POST') {
      const product = checkedProduct(body, catalog.settings); const products = [...catalog.products, product];
      validateAll(products, catalog.settings); validateImages({ ...catalog, products }); catalog.products = products; return copy({ product }) as T;
    }
    if (url.startsWith('/api/products/') && ['PUT', 'DELETE'].includes(method)) {
      let id: string; try { id = decodeURIComponent(url.slice('/api/products/'.length)); } catch { return fail('产品 ID 编码无效。'); }
      const existing = catalog.products.find(product => product.id === id); if (!existing) return fail('产品不存在。');
      if (method === 'DELETE') { catalog.products = catalog.products.filter(product => product.id !== id); return { ok: true } as T; }
      const product = checkedProduct(body, catalog.settings, existing), products = catalog.products.map(item => item.id === id ? product : item);
      validateAll(products, catalog.settings); validateImages({ ...catalog, products }); catalog.products = products; return copy({ product }) as T;
    }
    if (url === '/api/settings' && method === 'PUT') {
      const settings = validateSettings(body, catalog.settings); validateAll(catalog.products, settings); validateImages({ ...catalog, settings }); catalog.settings = settings; return copy({ settings }) as T;
    }
    if (url === '/api/admin/import' && method === 'POST') {
      const data = object(body, '备份');
      if (data.schemaVersion !== undefined && data.schemaVersion !== 1) fail('备份版本不支持。');
      if (!Array.isArray(data.products)) fail('备份须包含 products 数组。');
      const settings = data.settings === undefined ? catalog.settings : validateSettings(data.settings);
      const incoming = list(data.products, '产品', 10000).map(input => { const source = object(input, '产品'); return checkedProduct(source, settings, catalog.products.find(product => product.id === source.id)); });
      unique(incoming.map(product => product.id), '导入产品 ID');
      const merged = new Map(catalog.products.map(product => [product.id, product])); for (const product of incoming) merged.set(product.id, product);
      const products = [...merged.values()]; validateAll(products, settings);
      validateImages({ schemaVersion: 1, products, settings });
      workspace = { schemaVersion: 1, products, settings }; return copy({ imported: incoming.length, products, settings }) as T;
    }
    return fail('GitHub 线上后台不支持此本地操作。');
  }
  async function upload(file: File): Promise<string> {
    mutable();
    if (!file.size || file.size > MAX_IMAGE) fail('图片须大于 0 且不超过 8 MB。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const png = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
    const jpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const webp = bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP';
    const extension = png && file.type === 'image/png' ? 'png' : jpeg && file.type === 'image/jpeg' ? 'jpg' : webp && file.type === 'image/webp' ? 'webp' : '';
    if (!extension) fail('图片内容须与 PNG、JPEG 或 WebP 文件类型一致。');
    mutable();
    const path = `/media/${uuid()}.${extension}`; media.set(path, { bytes, url: createUrl(file) }); return path;
  }
  function imageUrl(path: string): string {
    if (!path) return '';
    try { githubImagePath(path); } catch { return ''; }
    const pending = media.get(path); if (pending) return pending.url;
    return `https://raw.githubusercontent.com/${GITHUB_REPOSITORY}/${baseSha || 'main'}/${repositoryImagePath(path)}`;
  }
  async function publish(): Promise<{ sha: string; url: string }> {
    mutable();
    if (!state().pending) fail('没有待发布的修改，请先保存产品或页面设置。');
    publishing = true;
    try {
      const catalog = copy(workspace!); validateAll(catalog.products, catalog.settings);
      const content = `${JSON.stringify(catalog, null, 2)}\n`;
      if (new TextEncoder().encode(content).length > 20 * 1024 * 1024) fail('图册资料超过 20 MB，请减少过长文字后再发布。');
      if (content.includes(token)) fail('资料包含当前访问令牌，请移除后再发布。');
      const references = referencedImages(catalog);
      for (const path of references) if (!media.has(path) && files.get(repositoryImagePath(path))?.type !== 'blob') fail(`图片不存在：${path}。请重新上传图片后发布。`);
      const current = await api<{ object: { sha: string } }>('/git/ref/heads/main');
      if (current.object.sha !== baseSha) fail('仓库已有其他新提交，为避免覆盖，本次未发布。编辑内容仍保留；请导出备份，退出并重新登录后合并修改。');
      const tree: { path: string; mode: string; type: string; sha: string }[] = [];
      const catalogBlob = await api<{ sha: string }>('/git/blobs', 'POST', { content, encoding: 'utf-8' });
      tree.push({ path: CONTENT_PATH, mode: '100644', type: 'blob', sha: catalogBlob.sha });
      for (const path of references) {
        const pending = media.get(path); if (!pending?.bytes.length) continue;
        const blob = await api<{ sha: string }>('/git/blobs', 'POST', { content: bytesToBase64(pending.bytes), encoding: 'base64' });
        tree.push({ path: repositoryImagePath(path), mode: '100644', type: 'blob', sha: blob.sha });
      }
      const newTree = await api<{ sha: string }>('/git/trees', 'POST', { base_tree: baseTree, tree });
      const commit = await api<{ sha: string }>('/git/commits', 'POST', { message: 'Publish catalogue changes from online admin', tree: newTree.sha, parents: [baseSha] });
      // A single fast-forward update makes JSON and selected media visible atomically.
      // A concurrent push after the preflight check is rejected by force:false.
      await api('/git/refs/heads/main', 'PATCH', { sha: commit.sha, force: false });
      baseSha = commit.sha; baseTree = newTree.sha; baseline = JSON.stringify(workspace); lastPublishedSha = commit.sha;
      for (const entry of tree) files.set(entry.path, entry);
      for (const product of catalog.products) originalSkus.set(product.id, product.sku);
      // Keep object URLs until logout: currently rendered previews remain valid during CDN propagation.
      for (const path of references) { const pending = media.get(path); if (pending) pending.bytes = new Uint8Array(); }
      return { sha: commit.sha, url: GITHUB_PUBLIC_URL };
    } finally { publishing = false; }
  }
  async function deployment(sha: string): Promise<Deployment> {
    authenticated();
    if (!/^[0-9a-f]{40}$/i.test(sha)) fail('发布提交编号无效。');
    const result: Deployment = { status: 'pending', url: GITHUB_PUBLIC_URL, actionsUrl: `https://github.com/${GITHUB_REPOSITORY}/actions` };
    try {
      // This repository is public; deployment checks need no token or extra Actions scope.
      const response = await fetcher(`${API}/actions/runs?head_sha=${sha}&per_page=100`, { cache: 'no-store', redirect: 'error', credentials: 'omit', headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
      if (!response.ok) return { ...result, status: 'unknown' };
      const data = await response.json() as { workflow_runs: { id: number; name: string; path: string; status: string; conclusion: string | null; html_url: string }[] };
      const run = data.workflow_runs.find(item => /pages/i.test(item.path) || /pages/i.test(item.name));
      if (!run) return result;
      result.actionsUrl = run.html_url.startsWith(`https://github.com/${GITHUB_REPOSITORY}/actions/runs/`) ? run.html_url : result.actionsUrl;
      if (run.status === 'completed') result.status = run.conclusion === 'success' ? 'success' : 'failure';
      return result;
    } catch { return { ...result, status: 'unknown' }; }
  }
  return { request, upload, imageUrl, publish, state, deployment };
}

const store = createGitHubStore();
export const adminRequest = store.request;
export const adminUpload = store.upload;
export const adminImageUrl = store.imageUrl;
export const publishGitHub = store.publish;
export const githubState = store.state;
export const githubDeployment = store.deployment;
