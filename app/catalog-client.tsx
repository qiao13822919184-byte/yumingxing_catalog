import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { InquiryItem, Product, SiteSettings } from './catalog-types';
import { defaultSettings } from './site-defaults';
import { InquiryPanel } from './inquiry-panel';
import { catalogueAtBase } from './catalog-source';

const staticCatalogue = import.meta.env.MODE === 'pages';
const catalogueHome = import.meta.env.BASE_URL;

export function CatalogClient({ products, settings = defaultSettings }: { products: Product[]; settings?: SiteSettings }) {
  const [live, setLive] = useState(products);
  const [config, setConfig] = useState(() => staticCatalogue ? catalogueAtBase({ products: [], settings }, catalogueHome).settings : settings);
  const [lang, setLang] = useState<'en' | 'zh'>('en');
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [material, setMaterial] = useState('all');
  const [sort, setSort] = useState('collection');
  const [selected, setSelected] = useState<Product | null>(null);
  const [photo, setPhoto] = useState('');
  const [items, setItems] = useState<InquiryItem[]>([]);
  const [ready, setReady] = useState(false);
  const [inquiry, setInquiry] = useState(false);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [limit, setLimit] = useState(18);
  const detailRef = useRef<HTMLDialogElement>(null);
  const t = (en: string, zh: string) => lang === 'en' ? en : zh;
  const name = (p: Product) => lang === 'en' ? p.nameEn : p.nameZh || p.nameEn;
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('ymx-inquiry-v1') || '[]');
      if (Array.isArray(saved)) setItems(saved.filter(v => v && typeof v.id === 'string' && typeof v.sku === 'string').slice(0, 500).map(v => ({ id: v.id, sku: v.sku, quantity: String(v.quantity || ''), note: String(v.note || '') })));
    } catch { setNotice('Your saved list could not be read. / 无法读取本地清单。'); }
    setReady(true);
    const controller = new AbortController();
    fetch(staticCatalogue ? `${catalogueHome}catalog.json` : '/api/catalog', { signal: controller.signal, cache: 'no-cache' }).then(async r => { if (!r.ok) throw new Error(); return r.json(); }).then(data => { const catalogue = staticCatalogue ? catalogueAtBase(data, catalogueHome) : data; setLive(catalogue.products); setConfig(catalogue.settings); setLoading(false); }).catch(e => { if (e.name !== 'AbortError') { setFailed(true); setLoading(false); setNotice('The catalogue could not be loaded. Please refresh to try again. / 暂时无法加载产品目录，请刷新重试。'); } });
    return () => controller.abort();
  }, []);
  useEffect(() => { if (!ready) return; try { localStorage.setItem('ymx-inquiry-v1', JSON.stringify(items)); } catch { setNotice(lang === 'en' ? 'Your browser could not save this list. Export it before leaving.' : '浏览器无法保存清单，请在离开前导出。'); } }, [items, ready, lang]);
  useEffect(() => { document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN'; }, [lang]);
  useEffect(() => { if (selected) { setPhoto(selected.image); detailRef.current?.showModal(); } else detailRef.current?.close(); }, [selected]);
  const published = live.filter(p => p.published);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const result = live.filter(p => p.published && (category === 'all' || p.category === category) && (material === 'all' || p.components.some(c => c.material === material)) && (!q || [p.sku, p.catalogId, p.model, p.nameEn, p.nameZh, ...p.components.flatMap(c => [c.nameEn, c.nameZh])].join(' ').toLowerCase().includes(q)));
    return result.sort((a, b) => sort === 'code' ? a.sku.localeCompare(b.sku) : a.order - b.order);
  }, [live, category, material, query, sort]);
  const categories = config.categories;
  const pickCategory = (id: string) => { setCategory(id); setLimit(18); document.getElementById('collection')?.scrollIntoView({ behavior: 'smooth' }); };
  const toggle = (p: Product) => setItems(old => old.some(x => x.id === p.id) ? old.filter(x => x.id !== p.id) : [...old, { id: p.id, sku: p.sku, quantity: '', note: '' }]);
  const has = (p: Product) => items.some(x => x.id === p.id);
  const featured = published.find(p => p.category === 'Kitchenware') || published[0];
  return <main style={{ '--accent': config.accent, '--columns': config.columns } as CSSProperties}>
    <div className="utility"><span>STAINLESS STEEL · CUTLERY & KITCHENWARE</span><span>{t('A closer look. A better selection.', '看清产品，轻松选款。')}</span></div>
    <header className="site-header"><a href={catalogueHome} className="brand"><span className="brand-mark">Y<span>m</span></span><span>{config.brand}<small>{t('THE PRODUCT COLLECTION', '餐厨具产品图册')}</small></span></a><nav><a href="#collection">{t('Products', '产品目录')}</a><a href="#categories">{t('Collections', '产品分类')}</a></nav><div className="header-actions"><button className="language" onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}>{t('中文', 'EN')}</button><button className="list-button" onClick={() => setInquiry(true)}>{t('My inquiry', '了解清单')}<b>{items.length}</b></button></div></header>
    <section className="intro"><div className="intro-copy"><p className="eyebrow">THE {config.brand} EDIT / {new Date().getFullYear()}</p><h1>{t(config.headlineEn, config.headlineZh)}</h1><p>{t('Explore stainless steel cutlery and kitchenware. Curate your selection, then talk details with our team.', '探索不锈钢餐具与厨房用具。将心仪产品加入了解清单，再与我们沟通产品细节。')}</p><a href="#collection" className="text-link">{t('Explore the collection', '浏览产品系列')} <span>↗</span></a></div>{featured && <button className="hero-product" onClick={() => setSelected(featured)} aria-label={name(featured)}><span className="hero-index">01 / {categories.find(c => c.id === featured.category)?.nameEn.toUpperCase() || featured.category.toUpperCase()}</span><img src={featured.image} alt={name(featured)} fetchPriority="high"/><span className="hero-caption"><span>{t('The kitchen, considered.', '厨房里的日常美学。')}</span><b>↗</b></span></button>}</section>
    <section className="category-strip" id="categories" aria-label={t('Product categories', '产品分类')}>{categories.map((c, i) => <button key={c.id} onClick={() => pickCategory(c.id)} className={category === c.id ? 'chosen' : ''}><span className="category-number">0{i + 1}</span>{c.image && <img src={c.image} alt="" loading="lazy"/>}<span><strong>{lang === 'en' ? c.nameEn : c.nameZh}</strong><small>{lang === 'en' ? c.descriptionEn : c.descriptionZh}</small></span><b>↗</b></button>)}</section>
    <section className="catalog-section" id="collection"><div className="section-heading"><div><p className="eyebrow">FIND YOUR NEXT COLLECTION</p><h2>{t('The product library', '产品目录')}</h2></div><p>{t('Select with +. Enquire in one list.', '点击 + 选款，用一张清单沟通。')}</p></div>
      <div className="catalog-tools"><div className="category-tabs"><button className={category === 'all' ? 'active' : ''} onClick={() => { setCategory('all'); setLimit(18); }}>{t('All products', '全部产品')} <small>{published.length}</small></button>{categories.map(c => <button key={c.id} className={category === c.id ? 'active' : ''} onClick={() => { setCategory(c.id); setLimit(18); }}>{lang === 'en' ? c.nameEn : c.nameZh}</button>)}</div><label className="search"><span>⌕</span><input value={query} onChange={e => { setQuery(e.target.value); setLimit(18); }} placeholder={t('Search name, model or SKU', '搜索名称、型号或唯一识别码')} aria-label={t('Search products', '搜索产品')}/>{query && <button onClick={() => setQuery('')} aria-label={t('Clear search', '清空搜索')}>×</button>}</label></div>
      <div className="results-toolbar"><span>{visible.length} {t('products', '款产品')}{category !== 'all' && ` / ${categories.find(c => c.id === category)?.[lang === 'en' ? 'nameEn' : 'nameZh'] || category}`}</span><div><label>{t('Material', '材质')} <select value={material} onChange={e => { setMaterial(e.target.value); setLimit(18); }}><option value="all">{t('All', '全部')}</option>{[...new Set(published.flatMap(p => p.components.map(c => c.material)).filter(Boolean))].sort().map(m => <option key={m}>{m}</option>)}</select></label><label>{t('Sort', '排序')} <select value={sort} onChange={e => setSort(e.target.value)}><option value="collection">{t('Collection order', '目录顺序')}</option><option value="code">{t('SKU', '唯一识别码')}</option></select></label></div></div>
      {notice && <div role="status" className="notice">{notice}<button onClick={() => setNotice('')} aria-label="Close">×</button></div>}
      <div className="product-grid">{visible.slice(0, limit).map(p => <article className="product-card" key={p.id}><button className="product-image" onClick={() => setSelected(p)} aria-label={name(p)}><span className="product-code">{p.sku}</span><img src={p.image} alt={name(p)} loading="lazy"/><span className="image-action">{t('Explore details', '查看详情')} ↗</span></button><div className="product-info"><p className="product-category">{categories.find(c => c.id === p.category)?.[lang === 'en' ? 'nameEn' : 'nameZh'] || p.category}</p><button className="product-title" onClick={() => setSelected(p)}><h3>{name(p)}</h3></button><p className="product-model">{p.model || p.catalogId} <span>{[...new Set(p.components.map(c => c.material).filter(Boolean))].join(' / ')} {t('stainless steel', '不锈钢')}</span></p><button className={`add-button ${has(p) ? 'added' : ''}`} onClick={() => toggle(p)} aria-pressed={has(p)}><span>{has(p) ? t('Added to inquiry', '已加入了解清单') : t('Add to inquiry', '加入了解清单')}</span><b>{has(p) ? '✓' : '+'}</b></button></div></article>)}</div>
      {loading && <div className="empty-state" role="status">{t('Loading the collection…', '正在读取产品目录…')}</div>}
      {failed && <div className="empty-state"><button className="secondary" onClick={() => window.location.reload()}>{t('Reload catalogue', '重新加载目录')}</button></div>}
      {!loading && !failed && visible.length === 0 && <div className="empty-state"><h3>{t('No pieces found', '没有找到对应产品')}</h3><p>{t('Try a different name, category or material.', '换一个名称、分类或材质试试。')}</p><button className="secondary" onClick={() => { setQuery(''); setCategory('all'); setMaterial('all'); }}>{t('Reset filters', '重置筛选')}</button></div>}
      {visible.length > limit && <button className="load-more secondary" onClick={() => setLimit(limit + 18)}>{t('View more products', '查看更多产品')} <span>↓</span></button>}
    </section>
    <section className="inquiry-banner"><div><p className="eyebrow">LET’S TALK ABOUT YOUR SELECTION</p><h2>{t('Your next collection starts here.', '下一份产品组合，从这里开始。')}</h2><p>{t('Save your favourites. Share the details. Request a quotation.', '收藏心仪款式，分享产品明细，与业务员沟通报价。')}</p></div><button className="light-button" onClick={() => setInquiry(true)}>{t('Review my inquiry', '查看我的了解清单')} <span>↗</span></button></section>
    <footer><a href={catalogueHome} className="footer-brand">{config.brand}</a><p>{t('Stainless steel cutlery & kitchenware', '不锈钢餐具与厨房用具')}</p><a className="footer-whatsapp" href={`https://wa.me/${config.whatsapp}?text=${encodeURIComponent(t(`Hello ${config.brand}, I would like to know more about your products.`, `您好，我想进一步了解 ${config.brand} 的产品。`))}`} target="_blank" rel="noopener noreferrer">WhatsApp ↗</a><a href={staticCatalogue ? `${catalogueHome}admin/` : '/admin'}>{t('Catalogue management', '图册管理')}</a><span>© {new Date().getFullYear()} {config.brand}</span></footer>
    <button className="floating-list" onClick={() => setInquiry(true)} aria-label={t('Open inquiry list', '打开了解清单')}><span>☷</span> {t('My inquiry', '了解清单')} <b>{items.length}</b></button>
    <dialog ref={detailRef} className="detail-dialog" aria-label={selected ? name(selected) : t("Product details", "产品详情")} onCancel={() => setSelected(null)} onClick={e => { if (e.target === e.currentTarget) setSelected(null); }} onClose={() => setSelected(null)}>{selected && <div className="detail-body"><button className="close" onClick={() => setSelected(null)} aria-label={t('Close details', '关闭详情')}>×</button><div className="detail-gallery"><img className="detail-photo" src={photo || selected.image} alt={name(selected)}/><div className="thumbnails">{[selected.image, ...(selected.gallery || [])].filter((v, i, a) => v && a.indexOf(v) === i).map(src => <button key={src} className={photo === src ? 'active' : ''} onClick={() => setPhoto(src)}><img src={src} alt={t('Alternate view', '产品图片')}/></button>)}</div></div><div className="detail-copy"><p className="eyebrow">{selected.category}</p><h2>{name(selected)}</h2><div className="detail-codes"><span>SKU <b>{selected.sku}</b></span><span>{t('Source code', '原货号')} <b>{selected.catalogId}</b></span><span>{t('Model', '型号')} <b>{selected.model || '—'}</b></span></div><p>{t(selected.descriptionEn || '', selected.descriptionZh || '')}</p><button className={`primary ${has(selected) ? 'added' : ''}`} onClick={() => toggle(selected)}>{has(selected) ? t('✓ Added · click to remove', '✓ 已加入 · 点击移除') : t('+ Add to inquiry', '+ 加入了解清单')}</button>{selected.attributes?.length ? <dl className="attributes">{selected.attributes.map(a => <div key={a.id}><dt>{a.label}</dt><dd>{a.value}</dd></div>)}</dl> : null}<div className="spec-heading"><h3>{t('Components & specifications', '组件与产品参数')}</h3><span>{selected.components.length} {t('component types', '种组件')}</span></div><div className="table-scroll"><table><thead><tr>{[t('Component', '组件'), t('Size', '尺寸'), t('Material', '材质'), t('Weight (g)', '重量(g)'), t('Thickness (mm)', '厚度(mm)'), t('Qty/set', '数量/套')].map(v => <th key={v}>{v}</th>)}</tr></thead><tbody>{selected.components.map(c => <tr key={c.id}><td>{t(c.nameEn, c.nameZh || c.nameEn)}</td><td>{c.size || '—'}</td><td>{c.material || '—'}</td><td>{c.weightG || '—'}</td><td>{c.thicknessMm || '—'}</td><td>{c.quantity || '—'}</td></tr>)}</tbody></table></div><p className="detail-note">{t('Specifications are shown as recorded. Please confirm units, assortment and packaging with our team.', '参数按原始记录展示；尺寸单位、套装组合与包装请与业务员确认。')}</p>{selected.blocks?.map(b => <section className="detail-block" key={b.id}><h3>{b.title}</h3>{b.type === 'image' ? <img src={b.content} alt={b.title}/> : <p>{b.content}</p>}</section>)}</div></div>}</dialog>
    <InquiryPanel open={inquiry} onClose={() => setInquiry(false)} items={items} setItems={setItems} products={live} settings={config} lang={lang}/>
  </main>;
}
