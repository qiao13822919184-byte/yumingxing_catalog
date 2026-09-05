import { useEffect, useMemo, useRef, useState } from 'react';
import { Brand, Field, Icon, ImageOrPlaceholder, NoticeBanner, Stat, makeId } from './admin-components';
import type { ProductRecord, Settings, Notice } from './admin-components';
import { ProductEditor } from './product-editor';
import { SettingsWorkspace } from './settings-workspace';
import { adminRequest as githubRequest, adminUpload as githubUpload, githubDeployment, githubState, isGitHubAdmin, publishGitHub } from './github-store';
import './admin.css';

type Workspace = 'products' | 'categories' | 'design' | 'backup';
const defaultSettings: Settings = { brand: 'YUMINGXING', whatsapp: '', headlineEn: 'Made for the everyday table.', headlineZh: '为日常餐桌，带来不凡品质。', accent: '#b56a42', columns: 3, categories: [] };
const clone = <T,>(value: T): T => structuredClone(value);
async function request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  if (isGitHubAdmin) return githubRequest<T>(url, method, body);
  const response = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || (response.status === 401 ? '登录已过期，请重新登录；当前草稿仍保留在页面中。' : `请求失败 (${response.status})，请稍后重试。`));
  return data as T;
}
async function adminUpload(file: File): Promise<string> {
  if (isGitHubAdmin) return githubUpload(file);
  const response = await fetch('/api/uploads', { method: 'POST', headers: { 'content-type': file.type }, credentials: 'same-origin', body: file });
  const data = await response.json().catch(() => ({})) as { url?: string; error?: string };
  if (!response.ok || !data.url) throw new Error(data.error || '图片上传失败');
  return data.url;
}
const catalogHref = import.meta.env.BASE_URL;
const repositoryHref = 'https://github.com/qiao13822919184-byte/yumingxing_catalog';
const tokenHref = 'https://github.com/settings/personal-access-tokens/new';
const actionsHref = `${repositoryHref}/actions`;
type Deployment = { sha: string; status: 'pending' | 'success' | 'failure' | 'unknown' } | null;
function downloadJson(data: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const navItems: { id: Workspace; label: string; description: string; icon: string }[] = [
  { id: 'products', label: '产品管理', description: '产品资料与上架', icon: 'grid' },
  { id: 'categories', label: '分类管理', description: '分类与封面图片', icon: 'layers' },
  { id: 'design', label: '页面设计', description: '品牌与图册外观', icon: 'design' },
  { id: 'backup', label: '备份与安全', description: '数据与管理账号', icon: 'shield' },
];
export function AdminClient() {
  const [session, setSession] = useState<'loading' | 'guest' | 'authenticated'>('loading');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [settingsDraft, setSettingsDraft] = useState<Settings>(defaultSettings);
  const [draft, setDraft] = useState<ProductRecord | null>(null);
  const [baseline, setBaseline] = useState('');
  const [section, setSection] = useState<Workspace>('products');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [cloud, setCloud] = useState(githubState);
  const [deployment, setDeployment] = useState<Deployment>(null);
  const [reconnect, setReconnect] = useState(false);
  const [token, setToken] = useState('');
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', repeat: '' });
  const productDirty = !!draft && JSON.stringify(draft) !== baseline;
  const settingsDirty = JSON.stringify(settingsDraft) !== JSON.stringify(settings);
  const hasUnsaved = productDirty || settingsDirty;
  const operationLock = useRef(false);
  const isExisting = !!draft && products.some(product => product.id === draft.id);
  function notify(text: string, kind: Notice['kind'] = 'info') { setNotice({ text, kind }); }
  function selectDraft(product: ProductRecord | null) { const next = product ? clone(product) : null; setDraft(next); setBaseline(next ? JSON.stringify(next) : ''); }
  async function loadData() {
    const [productData, catalogData] = await Promise.all([request<{ products: ProductRecord[] }>('/api/products?includeDrafts=1'), request<{ settings: Settings }>('/api/catalog')]);
    const next = productData.products || []; const nextSettings = { ...defaultSettings, ...catalogData.settings };
    setProducts(next); setSettings(clone(nextSettings)); setSettingsDraft(clone(nextSettings)); selectDraft(next[0] || null); setLoaded(true);
  }
  useEffect(() => {
    let alive = true;
    void request<{ authenticated: boolean; username?: string }>('/api/admin/session').then(async data => {
      if (!alive) return;
      if (!data.authenticated) { setSession('guest'); return; }
      setUsername(data.username || 'admin'); setSession('authenticated');
      try { await loadData(); } catch (error) { if (alive) notify(error instanceof Error ? error.message : '数据读取失败。', 'error'); }
    }).catch(error => { if (alive) { setSession('guest'); notify(error instanceof Error ? error.message : '连接失败。', 'error'); } });
    return () => { alive = false; };
  }, []);
  useEffect(() => { const handler = (event: BeforeUnloadEvent) => { if (hasUnsaved || (isGitHubAdmin && cloud.pending)) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler); }, [hasUnsaved, cloud.pending]);
  useEffect(() => {
    if (!isGitHubAdmin || !deployment || deployment.status !== 'pending') return;
    let cancelled = false; let timeout: ReturnType<typeof setTimeout>;
    const sha = deployment.sha;
    async function check() {
      try {
        const result = await githubDeployment(sha);
        if (cancelled) return;
        setCloud(githubState());
        if (result.status !== 'pending') { setDeployment({ sha, status: result.status }); return; }
      } catch { if (!cancelled) { setDeployment({ sha, status: 'unknown' }); return; } }
      if (!cancelled) timeout = setTimeout(() => void check(), 8000);
    }
    timeout = setTimeout(() => void check(), 3000);
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [deployment?.sha, deployment?.status]);
  async function run(label: string, action: () => Promise<void>) {
    if (operationLock.current) return; operationLock.current = true; setBusy(label); setNotice(null);
    try { await action(); } catch (error) { notify(error instanceof Error ? error.message : '操作失败，编辑内容已保留。', 'error'); }
    finally { operationLock.current = false; setBusy(''); setCloud(githubState()); }
  }
  function mayLeave() { return !busy && (!(hasUnsaved || (isGitHubAdmin && cloud.pending)) || window.confirm('有未保存或尚未发布的修改。退出后会丢弃这些内容，请先下载编辑草稿或完成发布。仍要退出吗？')); }
  async function login() {
    const submittedToken = token.trim(); const submittedPassword = password;
    setToken(''); setPassword('');
    await run(isGitHubAdmin ? '正在连接 GitHub' : '正在登录', async () => {
      const data = await request<{ username?: string }>('/api/admin/login', 'POST', isGitHubAdmin ? { token: submittedToken } : { username, password: submittedPassword });
      setUsername(data.username || username); setSession('authenticated'); setReconnect(false);
      if (!loaded) await loadData();
      else notify('已重新连接，当前编辑和暂存内容均已保留。', 'success');
    });
  }
  async function publish() {
    if (hasUnsaved) { notify('请先暂存当前产品或页面修改，再发布到网站。', 'info'); return; }
    await run('正在提交发布', async () => {
      const result = await publishGitHub();
      setDeployment({ sha: result.sha, status: 'pending' });
      notify('修改已提交到 GitHub，正在等待网站构建发布。此时前台可能仍显示上个版本。', 'info');
    });
  }
  function exportEditingDraft() {
    const next = clone(products);
    if (draft && productDirty) { const index = next.findIndex(product => product.id === draft.id); if (index < 0) next.push(clone(draft)); else next[index] = clone(draft); }
    downloadJson({ schemaVersion: 1, products: next, settings: clone(settingsDraft) }, `yumingxing-editing-draft-${new Date().toISOString().slice(0, 10)}.json`);
    notify('已下载当前编辑草稿（包含未暂存的表单内容）。JSON 不含图片文件；尚未发布的新图片仍在当前页面内存中，请保留原图，勿刷新页面。', 'info');
  }
  function mayDiscard(all = false) { if (busy) return false; return !(all ? hasUnsaved : productDirty) || window.confirm('有尚未保存的修改。离开后将丢弃这些修改，确定继续吗？'); }
  function switchSection(next: Workspace) {
    if (next === section || !mayDiscard(true)) return;
    if (productDirty) selectDraft(products.find(product => product.id === draft?.id) || products[0] || null);
    if (settingsDirty) setSettingsDraft(clone(settings)); setSection(next); setNotice(null);
  }
  function update<K extends keyof ProductRecord>(key: K, value: ProductRecord[K]) { setDraft(current => current ? { ...current, [key]: value } : current); }
  function updateSettings<K extends keyof Settings>(key: K, value: Settings[K]) { setSettingsDraft(current => ({ ...current, [key]: value })); }
  function addProduct() {
    if (!mayDiscard()) return;
    setDraft({ id: makeId('product'), sku: `YMX-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, order: Math.max(0, ...products.map(product => product.order || 0)) + 1, catalogId: '', imageId: '', model: '', category: settings.categories[0]?.id || '', nameEn: '', nameZh: '', image: '', published: false, verificationStatus: 'Needs confirmation', components: [], gallery: [], attributes: [], blocks: [], descriptionEn: '', descriptionZh: '' });
    setBaseline(''); setNotice(null);
  }
  async function saveProduct() {
    if (!draft) return;
    if (!draft.sku.trim()) { notify('请填写唯一 SKU。', 'error'); return; }
    if (!draft.catalogId.trim()) { notify('请填写原货号 / 图册编号。', 'error'); return; }
    if (products.some(product => product.id !== draft.id && product.sku?.trim().toLowerCase() === draft.sku.trim().toLowerCase())) { notify('此 SKU 已被使用，请填写其他唯一 SKU。', 'error'); return; }
    if (!draft.nameEn.trim() || !draft.nameZh.trim()) { notify('请填写中英文产品名称。', 'error'); return; }
    if (!settings.categories.some(category => category.id === draft.category)) { notify('请选择有效分类；可先在分类管理中创建。', 'error'); return; }
    if (draft.published && (!draft.image || draft.verificationStatus !== 'Verified')) { notify('上架前请上传主图，并确认产品资料（Verified）。', 'error'); return; }
    const submitted = clone(draft);
    await run('正在保存产品', async () => {
      const data = await request<{ product: ProductRecord }>(isExisting ? `/api/products/${encodeURIComponent(submitted.id)}` : '/api/products', isExisting ? 'PUT' : 'POST', submitted);
      setProducts(current => current.some(product => product.id === data.product.id) ? current.map(product => product.id === data.product.id ? data.product : product) : [...current, data.product]); selectDraft(data.product);
      notify(isGitHubAdmin ? '产品已暂存到当前页面，点击上方「发布到网站」后才会提交 GitHub。' : data.product.published ? '产品已保存，公开图册已同步。' : '草稿已保存，尚未在公开图册展示。', 'success');
    });
  }
  async function removeProduct() {
    if (!draft || busy || !window.confirm(`确定${isExisting ? '删除产品' : '丢弃新产品'}「${draft.nameZh || draft.nameEn || '未命名产品'}」？${productDirty ? '未保存的修改也将丢弃。' : ''}${isExisting ? (isGitHubAdmin ? '删除将在下次发布时生效。' : '此操作无法撤销。') : ''}`)) return;
    if (!isExisting) { selectDraft(products[0] || null); notify('新产品草稿已丢弃。'); return; }
    const id = draft.id;
    await run('正在删除产品', async () => { await request(`/api/products/${encodeURIComponent(id)}`, 'DELETE'); const remaining = products.filter(product => product.id !== id); setProducts(remaining); selectDraft(remaining[0] || null); notify(isGitHubAdmin ? '删除操作已暂存，发布后才会更新网站。' : '产品已删除。', 'success'); });
  }
  async function uploadImages(files: File[], onUploaded: (urls: string[]) => void) {
    if (!files.length) return;
    await run('正在上传图片', async () => {
      const urls: string[] = [];
      for (const file of files) {
        if (!file.type.startsWith('image/')) throw new Error('请选择图片文件。');
        try { urls.push(await adminUpload(file)); }
        catch (error) { if (urls.length) onUploaded(urls); throw new Error(`${error instanceof Error ? error.message : '图片上传失败'}${urls.length ? `；已添加 ${urls.length} 张，其余可重试。` : '，当前草稿仍保留。'}`); }
      }
      onUploaded(urls); notify(isGitHubAdmin ? `已添加 ${urls.length} 张图片，请先暂存资料，再发布到网站。` : `已上传 ${urls.length} 张图片。保存后生效。`, 'success');
    });
  }
  async function saveSettings() {
    if (!settingsDraft.brand.trim() || !settingsDraft.headlineEn.trim() || !settingsDraft.headlineZh.trim()) { notify('品牌名称和中英文首页标题不能为空。', 'error'); return; }
    if (!/^#[0-9a-f]{6}$/i.test(settingsDraft.accent)) { notify('强调色请使用 6 位十六进制格式，例如 #b56a42。', 'error'); return; }
    if (settingsDraft.categories.some(category => !category.nameEn.trim() || !category.nameZh.trim())) { notify('每个分类都需要中英文名称。', 'error'); return; }
    const whatsapp = settingsDraft.whatsapp.trim();
    if (whatsapp && !/^\+?[\d\s()-]+$/.test(whatsapp)) { notify('WhatsApp 号码仅接受数字、开头的 + 和分隔空格、括号、连字符。', 'error'); return; }
    const normalizedWhatsapp = whatsapp.replace(/[^\d]/g, '');
    if (normalizedWhatsapp && !/^\d{7,15}$/.test(normalizedWhatsapp)) { notify('请填写带国家区号的 WhatsApp 号码，共 7–15 位数字。', 'error'); return; }
    const submitted = { ...clone(settingsDraft), whatsapp: normalizedWhatsapp };
    await run('正在保存设置', async () => { const data = await request<{ settings?: Settings }>('/api/settings', 'PUT', submitted); const next = data.settings || submitted; setSettings(clone(next)); setSettingsDraft(clone(next)); notify(isGitHubAdmin ? '设置已暂存，请点击「发布到网站」更新公开图册。' : '设置已保存，公开图册已同步。', 'success'); });
  }
  async function exportBackup() {
    await run('正在导出备份', async () => {
      const data = await request('/api/admin/export');
      downloadJson(data, `yumingxing-catalog-${new Date().toISOString().slice(0, 10)}.json`);
      notify(isGitHubAdmin ? '已下载暂存资料的 JSON 备份。图片需另行保留，未暂存的表单内容可通过「下载编辑草稿」备份。' : 'JSON 备份已下载。请同时备份 data/media 文件夹中的上传图片与 public/catalog-products 原始图片。', 'success');
    });
  }
  async function importBackup(file: File) {
    if (!mayDiscard(true)) return;
    await run('正在导入备份', async () => {
      const payload = JSON.parse(await file.text()) as { products?: unknown[]; settings?: unknown };
      if (!payload || !Array.isArray(payload.products)) throw new Error('备份格式无效：JSON 必须包含 products 数组。');
      if (!window.confirm(`将导入 ${payload.products.length} 个产品：相同 ID 的记录会被更新，新记录会被添加。${payload.settings ? '备份中的页面设置也会覆盖现有设置。' : ''}是否继续？`)) return;
      await request('/api/admin/import', 'POST', payload); await loadData(); notify(`已导入 ${payload.products.length} 个产品。请检查资料、图片路径和上架状态。${isGitHubAdmin ? '导入内容已暂存，尚未发布。' : ''}`, 'success');
    });
  }
  async function changePassword() {
    if (!passwordForm.current || passwordForm.next.length < 12) { notify('请填写当前密码；新密码至少 12 个字符。', 'error'); return; }
    if (passwordForm.next !== passwordForm.repeat) { notify('两次新密码不一致。', 'error'); return; }
    await run('正在修改密码', async () => { await request('/api/admin/change-password', 'POST', { currentPassword: passwordForm.current, newPassword: passwordForm.next }); setPasswordForm({ current: '', next: '', repeat: '' }); setSession('guest'); setLoaded(false); selectDraft(null); setSection('products'); notify('管理密码已更新，请使用新密码重新登录。', 'success'); });
  }
  const filtered = useMemo(() => products.filter(product => {
    const matchesText = [product.nameEn, product.nameZh, product.sku, product.catalogId, product.model].some(value => (value || '').toLowerCase().includes(query.toLowerCase().trim()));
    return matchesText && (filter === 'all' || (filter === 'published' ? product.published : filter === 'draft' ? !product.published : product.verificationStatus !== 'Verified'));
  }).sort((a, b) => (a.order || 0) - (b.order || 0)), [products, query, filter]);
  const totalPublished = products.filter(product => product.published).length;
  const cloudBar = isGitHubAdmin && <section className={`adm-cloud-publish ${cloud.pending ? 'pending' : ''}`} aria-label="网站发布">
    <div className="adm-cloud-heading"><div><span className="adm-eyebrow">EDIT · STAGE · PUBLISH</span><h2>{cloud.pending ? '有暂存修改，尚未发布' : 'GitHub 线上工作台'}</h2><p>修改资料 → 暂存产品或设置 → 发布到网站。暂存内容只保留在当前页面内存中。</p></div><button className="adm-btn adm-primary" disabled={!!busy || !loaded || !cloud.pending || hasUnsaved || deployment?.status === 'pending'} title={hasUnsaved ? '请先暂存当前表单修改' : '将暂存修改提交到 GitHub 并启动网站发布'} onClick={() => void publish()}><Icon name="upload" />{busy === '正在提交发布' ? '正在提交…' : '发布到网站'}</button></div>
    {hasUnsaved && <p className="adm-cloud-editing">当前表单有未暂存内容，请先点击「暂存」再发布。</p>}
    {deployment && <div className={`adm-cloud-deployment ${deployment.status}`} role="status"><span>{deployment.status === 'pending' ? '已提交 GitHub，正在等待网站部署完成…' : deployment.status === 'success' ? '网站部署成功，本次提交已上线。' : deployment.status === 'failure' ? '网站部署未成功，提交仍保存在 GitHub；可在发布记录中查看原因并重新运行。' : '提交已保存在 GitHub，暂时无法确认网站是否完成更新。请查看发布记录。'}</span><a href={actionsHref} target="_blank" rel="noreferrer">查看发布记录 ↗</a>{deployment.status !== 'pending' && deployment.status !== 'success' && <button className="adm-text-button" disabled={!!busy} onClick={() => setDeployment({ ...deployment, status: 'pending' })}>重新检查</button>}</div>}
    <div className="adm-cloud-tools"><span>仓库版本 <a href={cloud.commitSha ? `${repositoryHref}/commit/${cloud.commitSha}` : repositoryHref} target="_blank" rel="noreferrer">{cloud.commitSha ? cloud.commitSha.slice(0, 7) : '待连接'}</a></span><button type="button" disabled={!!busy || !loaded} onClick={exportEditingDraft}>下载编辑草稿</button><button type="button" disabled={!!busy} onClick={() => { setReconnect(value => !value); setToken(''); }}>重新连接 GitHub</button><a href={`${repositoryHref}/commits/main/`} target="_blank" rel="noreferrer">版本历史 ↗</a></div>
    <p className="adm-cloud-public-note">此仓库为公开仓库。发布会保存完整管理资料；草稿产品虽不展示在图册前台，仍可能从仓库读取。请勿填写报价、客户资料或其他私密信息。</p>
    {reconnect && <form className="adm-reconnect-form" onSubmit={event => { event.preventDefault(); void login(); }}><div><h3>更换令牌，保留当前编辑</h3><p>连接过期或权限不足时可在此重试；若发生版本冲突，先下载编辑草稿，再重新打开管理入口读取最新资料并导入合并。</p></div><Field label="新的 GitHub 访问令牌" value={token} onChange={setToken} type="password" autoComplete="off" disabled={!!busy} required /><button className="adm-btn" disabled={!!busy}>连接并保留草稿</button></form>}
  </section>;

  if (session === 'loading') return <div className="adm-loading"><Brand /><div className="adm-spinner" /><p>{isGitHubAdmin ? '正在准备线上工作台…' : '正在连接本地图册…'}</p></div>;
  if (session === 'guest') return <main className="adm-login"><section className="adm-login-story"><Brand /><div><span className="adm-eyebrow">CATALOGUE STUDIO</span><h1>好产品，<br />值得被看见。</h1><p>从一张产品图片，到一份专业图册。<br />在这里整理每一处细节，让采购沟通更简单。</p><div className="adm-login-chips"><span>产品管理</span><span>双语图册</span><span>{isGitHubAdmin ? 'GitHub 发布' : '本地存储'}</span></div></div><small>YUMINGXING · CATALOGUE MANAGEMENT</small></section><section className="adm-login-form"><a className="adm-back-link" href={catalogHref}>← 返回公开图册</a><form onSubmit={event => { event.preventDefault(); void login(); }}><span className="adm-eyebrow">YOUR WORKSPACE</span><h2>{isGitHubAdmin ? '连接线上图册工作台' : '欢迎回到图册工作台'}</h2><p>{isGitHubAdmin ? '使用 GitHub 访问令牌管理产品，修改后统一发布。' : '登录后管理产品、分类与图册页面。'}</p>{notice && <NoticeBanner notice={notice} />}<>{isGitHubAdmin ? <Field label="GitHub 访问令牌" value={token} onChange={setToken} type="password" autoComplete="off" required disabled={!!busy} placeholder="github_pat_…" hint="仅在当前页面内存中使用，不会写入仓库、网址或浏览器存储。" /> : <><Field label="管理账号" value={username} onChange={setUsername} autoComplete="username" required disabled={!!busy} /><Field label="管理密码" value={password} onChange={setPassword} type="password" autoComplete="current-password" required disabled={!!busy} /></>}</><button className="adm-btn adm-primary adm-login-submit" disabled={!!busy}>{busy || (isGitHubAdmin ? '连接 GitHub 并进入后台' : '进入管理后台')}<span>→</span></button><>{isGitHubAdmin ? <TokenHelp /> : <div className="adm-login-help"><Icon name="shield" /><div>默认账号为 <b>admin</b>。<br />初始密码请查看项目文件 <code>.local/admin-access.txt</code>。</div></div>}</></form><small className="adm-login-footer">{isGitHubAdmin ? '关闭或刷新页面后需重新连接 · 请及时发布修改' : '管理入口独立登录 · 产品资料保存在本机'}</small></section></main>;
  return <div className="adm-app"><aside className="adm-nav"><a className="adm-brand-link" href={catalogHref} target="_blank" rel="noreferrer"><Brand /></a><div className="adm-nav-caption">CATALOGUE STUDIO</div><nav>{navItems.map(item => <button key={item.id} className={section === item.id ? 'active' : ''} disabled={!!busy} onClick={() => switchSection(item.id)}><Icon name={item.icon} /><span><b>{item.label}</b><small>{item.description}</small></span>{section === item.id && <i />}</button>)}</nav><div className="adm-nav-bottom"><div className="adm-local-indicator"><i />{isGitHubAdmin ? 'GitHub 工作区' : '本地工作区'}<span>{isGitHubAdmin ? 'ONLINE' : 'LOCAL'}</span></div><a href={catalogHref} target="_blank" rel="noreferrer"><Icon name="external" />打开公开图册 ↗</a><div className="adm-account"><div className="adm-avatar">A</div><span><b>{username}</b><small>图册管理员</small></span><button title="退出登录" aria-label="退出登录" disabled={!!busy} onClick={() => { if (!mayLeave()) return; void run('正在退出', async () => { await request('/api/admin/logout', 'POST'); setSession('guest'); selectDraft(null); setSettingsDraft(clone(settings)); setLoaded(false); setProducts([]); setToken(''); setReconnect(false); setDeployment(null); }); }}><Icon name="logout" /></button></div></div></aside>
    <main className="adm-main"><header className="adm-topbar"><div><span>工作区</span><i>/</i><b>{navItems.find(item => item.id === section)?.label}</b></div><div className="adm-top-status">{busy ? <><span className="adm-mini-spinner" />{busy}…</> : hasUnsaved ? <><i className="unsaved" /> 有未保存的修改</> : <><i className={isGitHubAdmin && cloud.pending ? 'unsaved' : ''} />{isGitHubAdmin ? cloud.pending ? '有待发布的修改' : '已载入仓库资料' : '所有修改已保存'}</>}</div></header><div className="adm-content"><div className="adm-page-heading"><div><span className="adm-eyebrow">{section === 'products' ? 'PRODUCT LIBRARY' : section === 'categories' ? 'COLLECTIONS' : section === 'design' ? 'BRAND & APPEARANCE' : 'DATA & SECURITY'}</span><h1>{navItems.find(item => item.id === section)?.label}</h1><p>{section === 'products' ? '让每一件产品，都有清晰完整的表达。' : section === 'categories' ? '用清晰的产品分类，帮助客户更快找到所需。' : section === 'design' ? '让图册的每个细节，都体现你的品牌。' : '妥善保存产品资料，管理工作区访问权限。'}</p></div>{section === 'products' ? <button className="adm-btn adm-primary" onClick={addProduct} disabled={!!busy || !loaded}><Icon name="plus" />新建产品</button> : section === 'categories' || section === 'design' ? <button className="adm-btn adm-primary" onClick={() => void saveSettings()} disabled={!!busy || !loaded || !settingsDirty}><Icon name="save" />{isGitHubAdmin ? '暂存' : '保存'}{section === 'categories' ? '分类' : '设计'}</button> : <a className="adm-btn" href={catalogHref} target="_blank" rel="noreferrer">查看图册 ↗</a>}</div>
      {cloudBar}{notice && <NoticeBanner notice={notice} onClose={() => setNotice(null)} />}
      {!loaded ? <div className="adm-empty adm-card"><Icon name="layers" /><h3>正在读取图册数据</h3><p>如果连接中断，可重试加载。</p><button className="adm-btn" disabled={!!busy} onClick={() => void run('正在读取数据', loadData)}>重新加载</button></div> : section === 'products' ? <><div className="adm-stats"><Stat label="全部产品" number={products.length} description="ALL PRODUCTS" /><Stat label="已上架" number={totalPublished} description="PUBLISHED" /><Stat label="草稿" number={products.length - totalPublished} description="DRAFTS" /><Stat label="产品分类" number={settings.categories.length} description="COLLECTIONS" /></div><div className="adm-product-workspace"><aside className="adm-product-list-panel"><div className="adm-list-heading"><b>产品列表</b><span>{filtered.length} 个结果</span></div><div className="adm-search"><Icon name="search" /><input aria-label="搜索产品" placeholder="名称 / SKU / 原货号" value={query} onChange={event => setQuery(event.target.value)} /></div><div className="adm-list-filters"><select aria-label="筛选产品状态" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">全部状态</option><option value="published">已上架</option><option value="draft">草稿 / 已下架</option><option value="unverified">资料待确认</option></select><span>按展示顺序</span></div><div className="adm-product-list">{draft && !isExisting && <button className="adm-product-row selected" disabled><ImageOrPlaceholder alt={draft.nameZh || draft.nameEn || '未命名产品'} src={draft.image} /><span><b>{draft.nameZh || '未保存的新产品'}</b><small>{draft.sku}</small><em className="adm-tag draft">新建草稿</em></span></button>}{filtered.map(product => <button key={product.id} className={`adm-product-row ${draft?.id === product.id ? 'selected' : ''}`} disabled={!!busy} onClick={() => { if (product.id === draft?.id || !mayDiscard()) return; selectDraft(product); setNotice(null); }}><ImageOrPlaceholder alt={product.nameZh || product.nameEn || '未命名产品'} src={product.image} /><span><b>{product.nameZh || product.nameEn || '未命名产品'}</b><small>{product.sku || product.catalogId}</small><em className={`adm-tag ${product.published ? 'live' : 'draft'}`}>{product.published ? '已上架' : '草稿'}</em>{product.verificationStatus !== 'Verified' && <em className="adm-tag unverified">待确认</em>}</span><span className="adm-row-arrow">›</span></button>)}{!filtered.length && <div className="adm-list-empty">没有找到匹配的产品。</div>}</div></aside>{draft ? <ProductEditor key={draft.id} draft={draft} settings={settings} busy={!!busy} dirty={productDirty} isExisting={isExisting} update={update} onSave={() => void saveProduct()} onDelete={() => void removeProduct()} onUpload={(files, callback) => void uploadImages(files, callback)} /> : <div className="adm-empty adm-card"><Icon name="grid" /><h3>开始整理你的产品</h3><p>新建一个产品，上传图片并填写资料。</p><button className="adm-btn adm-primary" onClick={addProduct}>新建产品</button></div>}</div></> : section === 'categories' || section === 'design' ? <SettingsWorkspace section={section} settings={settingsDraft} products={products} busy={!!busy} update={updateSettings} notify={notify} onUpload={(files, callback) => void uploadImages(files, callback)} /> : <div className="adm-backup-grid"><section className="adm-card"><div className="adm-card-heading"><div><h2>图册数据备份</h2><p>让每一次整理，都得到妥善保留。</p></div><Icon name="download" /></div><div className="adm-backup-body"><div className="adm-backup-illustration"><Icon name="layers" /><span>CATALOGUE<br /><b>JSON BACKUP</b></span><i>↓</i></div><h3>导出完整图册资料</h3><p>备份包含产品、组件、图库路径、图文详情与页面设置。可在迁移设备或重要修改前导出留存。</p><button className="adm-btn adm-primary" disabled={!!busy} onClick={() => void exportBackup()}><Icon name="download" />导出 JSON 备份</button>{!isGitHubAdmin && <button className="adm-btn adm-full-backup" disabled={!!busy} onClick={() => void run('正在创建完整备份', async () => { const data = await request<{ backup: { name: string; createdAt: string } }>('/api/admin/backup', 'POST'); notify(`完整备份已创建：data/backups/${data.backup.name}`, 'success'); })}><Icon name="layers" />本地完整备份（含图片）</button>}<div className="adm-backup-note"><Icon name="info" /><p><b>JSON 不包含实际图片文件。</b><br />{isGitHubAdmin ? <>已发布图片保存在 GitHub 仓库。尚未发布的新图片仅在当前页面内存中，务必保留原图。可从 GitHub 下载整个仓库备份已提交的资料和图片。</> : <>请同时备份项目中的 <code>data/media</code> 文件夹；原始 <code>public/catalog-products</code> 图片也应随项目保留。完整迁移可直接复制整个项目目录。</>}</p></div><div className="adm-backup-import"><h3>恢复 / 合并备份</h3><p>相同产品 ID 会被更新，新产品会被加入。若备份包含页面设置，将覆盖当前设置。建议先导出现有数据。</p><label className={`adm-btn adm-upload ${busy ? 'disabled' : ''}`}><Icon name="upload" />选择 JSON 并导入<input type="file" accept=".json,application/json" disabled={!!busy} onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (file) void importBackup(file); }} /></label></div></div></section><section className="adm-card"><div className="adm-card-heading"><div><h2>管理员安全</h2><p>管理账号：{username}</p></div><Icon name="shield" /></div>{isGitHubAdmin ? <div className="adm-password-form"><div className="adm-security-symbol"><Icon name="shield" /></div><h3>GitHub 管理权限</h3><p>此线上后台使用 GitHub 访问令牌，不使用本机 admin 密码。令牌仅用于当前页面与 GitHub API 的请求。</p><TokenHelp /><a className="adm-btn" href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noreferrer">管理 / 撤销访问令牌 ↗</a><a className="adm-btn" href={`${repositoryHref}/commits/main/`} target="_blank" rel="noreferrer">查看图册版本历史 ↗</a><button className="adm-btn" disabled={!!busy} onClick={exportEditingDraft}>下载含未暂存内容的编辑草稿</button><p className="adm-subtle">离开、关闭或刷新页面前，请完成发布或下载编辑草稿。页面不会自动存储令牌或编辑资料。</p></div> : <form className="adm-password-form" onSubmit={event => { event.preventDefault(); void changePassword(); }}><div className="adm-security-symbol"><Icon name="shield" /></div><h3>更新管理密码</h3><p>使用至少 12 个字符的新密码。更新后需重新登录。</p><Field label="当前密码" value={passwordForm.current} onChange={value => setPasswordForm(current => ({ ...current, current: value }))} type="password" autoComplete="current-password" disabled={!!busy} required /><Field label="新密码" value={passwordForm.next} onChange={value => setPasswordForm(current => ({ ...current, next: value }))} type="password" autoComplete="new-password" disabled={!!busy} required /><Field label="再次输入新密码" value={passwordForm.repeat} onChange={value => setPasswordForm(current => ({ ...current, repeat: value }))} type="password" autoComplete="new-password" disabled={!!busy} required /><button className="adm-btn adm-primary" disabled={!!busy}>保存新密码</button><p className="adm-subtle">初始访问信息位于 <code>.local/admin-access.txt</code>。修改后请妥善保存你的新密码。</p></form>}</section></div>}
      <footer className="adm-workspace-footer"><span>{settings.brand} · CATALOGUE STUDIO</span><span>专注产品表达，让询盘更简单。</span></footer></div></main></div>;
}
export default AdminClient;

function TokenHelp() {
  return <div className="adm-token-help"><h3>首次连接：创建专用访问令牌</h3><ol><li>使用有权管理此仓库的 GitHub 账号，<a href={tokenHref} target="_blank" rel="noreferrer">创建 fine-grained personal access token ↗</a>，设置合适的到期时间。</li><li>Resource owner 选择仓库所有者；Repository access 选择 <b>Only select repositories</b>，仅勾选 <b>yumingxing_catalog</b>。</li><li>Repository permissions 中将 <b>Contents</b> 设为 <b>Read and write</b>，Metadata 保留默认。不需要 Workflows 权限。</li><li>复制生成的令牌，粘贴到上方密码框。令牌提交后输入框会清空；请自行妥善保管。</li></ol></div>;
}
