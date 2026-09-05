import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Product, ComponentSpec } from '../catalog-types';

export type Attribute = { id: string; label: string; value: string };
export type Block = { id: string; type: 'text' | 'image'; title: string; content: string };
export type ProductRecord = Product & { sku: string; descriptionEn?: string; descriptionZh?: string; gallery?: string[]; attributes?: Attribute[]; blocks?: Block[] };
export type Category = { id: string; nameEn: string; nameZh: string; image: string; descriptionEn: string; descriptionZh: string };
export type Settings = { brand: string; whatsapp: string; headlineEn: string; headlineZh: string; accent: string; columns: number; categories: Category[] };
export type Notice = { kind: 'success' | 'error' | 'info'; text: string };
export const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
export const emptyComponent = (): ComponentSpec => ({ id: makeId('component'), nameEn: '', nameZh: '', material: '', size: '', weightG: '', thicknessMm: '', quantity: '', unit: 'pcs' });
export function reorder<T>(items: T[], index: number, direction: number): T[] {
  const next = [...items]; const destination = index + direction;
  if (destination < 0 || destination >= items.length) return next;
  [next[index], next[destination]] = [next[destination], next[index]]; return next;
}
export function quantitySummary(components: ComponentSpec[]) {
  if (!components.length) return '尚无组件';
  if (components.some(component => !component.quantity.trim() || !Number.isFinite(Number(component.quantity)) || Number(component.quantity) < 0)) return '数量未填完整';
  const totals = new Map<string, number>();
  for (const component of components) {
    const number = Number(component.quantity);
    if (component.quantity.trim() && Number.isFinite(number) && number >= 0) totals.set(component.unit || '件', (totals.get(component.unit || '件') || 0) + number);
  }
  return [...totals].map(([unit, number]) => `${number} ${unit}`).join(' / ') || '数量待填写';
}
export function Field({ label, value, onChange, wide = false, multiline = false, hint, ...props }: { label: string; value: string; onChange: (value: string) => void; wide?: boolean; multiline?: boolean; hint?: string; placeholder?: string; type?: string; readOnly?: boolean; disabled?: boolean; autoComplete?: string; required?: boolean }) {
  const { type, ...common } = props;
  return <label className={`adm-field ${wide ? 'wide' : ''}`}><span>{label}</span>{multiline ? <textarea {...common} value={value} onChange={event => onChange(event.target.value)} rows={4} /> : <input {...common} type={type || 'text'} value={value} onChange={event => onChange(event.target.value)} />}{hint && <small>{hint}</small>}</label>;
}
export function UploadButton({ label, onFiles, multiple = false, disabled = false }: { label: string; onFiles: (files: File[]) => void; multiple?: boolean; disabled?: boolean }) {
  return <label className={`adm-btn adm-upload ${disabled ? 'disabled' : ''}`}><Icon name="upload" />{label}<input type="file" accept="image/png,image/jpeg,image/webp" multiple={multiple} disabled={disabled} onChange={event => { const files = [...(event.target.files || [])]; event.currentTarget.value = ''; if (files.length) onFiles(files); }} /></label>;
}
export function ImageOrPlaceholder({ src, label = '暂无图片', alt = '产品图片' }: { src: string; label?: string; alt?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return src && !failed ? <img src={src} alt={alt} onError={() => setFailed(true)} loading="lazy" /> : <div className="adm-image-placeholder"><Icon name="image" /><span>{failed ? '图片暂不可用' : label}</span></div>;
}
export function Brand() { return <div className="adm-brand"><span className="adm-brand-mark">y<span>m</span></span><div><b>YUMINGXING</b><small>CATALOGUE STUDIO</small></div></div>; }
export function Stat({ label, number, description }: { label: string; number: number; description: string }) { return <div className="adm-stat"><span>{label}<small>{description}</small></span><strong>{String(number).padStart(2, '0')}</strong></div>; }
export function SectionHeading({ number, title, description }: { number: string; title: string; description?: string }) { return <div className="adm-section-heading"><div><span>{number}</span><h3>{title}</h3></div>{description && <p>{description}</p>}</div>; }
export function NoticeBanner({ notice, onClose }: { notice: Notice; onClose?: () => void }) { return <div className={`adm-notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}><Icon name={notice.kind === 'success' ? 'check' : 'info'} /><p>{notice.text}</p>{onClose && <button aria-label="关闭提示" onClick={onClose}>×</button>}</div>; }
export function OrderActions({ index, length, onMove, onDelete, label }: { index: number; length: number; onMove: (direction: number) => void; onDelete?: () => void; label: string }) {
  return <div className="adm-order-actions"><button type="button" className="adm-icon-button" title="上移" aria-label={`${label}上移`} disabled={index === 0} onClick={() => onMove(-1)}>↑</button><button type="button" className="adm-icon-button" title="下移" aria-label={`${label}下移`} disabled={index === length - 1} onClick={() => onMove(1)}>↓</button>{onDelete && <button type="button" className="adm-icon-button danger" title="删除" aria-label={`删除${label}`} onClick={onDelete}><Icon name="trash" /></button>}</div>;
}
export function ProductPreview({ product, categories, images, imageIndex, onImageIndex, accent }: { product: ProductRecord; categories: Category[]; images: string[]; imageIndex: number; onImageIndex: (index: number) => void; accent: string }) {
  return <article className="adm-product-preview" style={{ '--preview-accent': accent } as CSSProperties}>
    <div className="adm-preview-image"><ImageOrPlaceholder alt={product.nameZh || product.nameEn || '未命名产品'} src={images[imageIndex] || images[0] || ''} label="产品主图预览" /><span className={`adm-tag ${product.published ? 'live' : 'draft'}`}>{product.published ? '上架预览' : '草稿预览'}</span></div>
    {images.length > 1 && <div className="adm-preview-thumbs">{images.map((src, index) => <button key={`${src}-${index}`} className={imageIndex === index ? 'active' : ''} aria-label={`预览图片 ${index + 1}`} onClick={() => onImageIndex(index)}><img src={src} alt={`产品角度 ${index + 1}`} /></button>)}</div>}
    <div className="adm-preview-product-content"><div className="adm-preview-category">{categories.find(item => item.id === product.category)?.nameEn || 'PRODUCT COLLECTION'}</div><h2>{product.nameEn || 'English product name'}</h2><h3>{product.nameZh || '中文产品名称'}</h3><div className="adm-preview-codes"><b>{product.sku || 'SKU'}</b>{product.catalogId && <span>原货号 {product.catalogId}</span>}{product.model && <span>型号 {product.model}</span>}</div>
      {(product.descriptionEn || product.descriptionZh) && <div className="adm-preview-description">{product.descriptionEn && <p>{product.descriptionEn}</p>}{product.descriptionZh && <p>{product.descriptionZh}</p>}</div>}
      <div className="adm-preview-metrics"><span><b>{product.components.length}</b> 组件种类</span><span><b>{quantitySummary(product.components)}</b> 每套数量</span></div>
      {!!product.components.length && <section className="adm-preview-specs"><h4>COMPONENTS & SPECIFICATIONS</h4>{product.components.map((component, index) => <div className="adm-preview-component" key={component.id}><b>{component.nameEn || component.nameZh || `Component ${index + 1}`}<span>{component.quantity || '—'} {component.unit}</span></b>{component.nameZh && <small>{component.nameZh}</small>}<dl>{[['Material / 材质', component.material], ['Size / 尺寸', component.size], ['Weight / 单件重量', component.weightG ? `${component.weightG} g` : ''], ['Thickness / 厚度', component.thicknessMm ? `${component.thicknessMm} mm` : '']].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></div>)}</section>}
      {!!product.attributes?.length && <section className="adm-preview-attributes"><h4>PRODUCT DETAILS</h4><dl>{product.attributes.map(attribute => <div key={attribute.id}><dt>{attribute.label || '属性名称'}</dt><dd>{attribute.value || '—'}</dd></div>)}</dl></section>}
      {!!product.blocks?.length && <section className="adm-preview-blocks">{product.blocks.map(block => <div key={block.id}>{block.title && <h4>{block.title}</h4>}{block.type === 'image' ? <ImageOrPlaceholder alt={block.title || '产品详情图片'} src={block.content} label="详情图片" /> : <p>{block.content || '段落内容预览…'}</p>}</div>)}</section>}
      <div className="adm-preview-inquiry"><Icon name="plus" />加入询盘清单</div><p className="adm-preview-footnote">内容预览 · 保存后同步至公开图册</p>
    </div>
  </article>;
}
export function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    layers: <><path d="m12 3 10 5-10 5L2 8l10-5Z" /><path d="m2 12 10 5 10-5M2 16l10 5 10-5" /></>,
    design: <><path d="m15 3 6 6-12 12H3v-6L15 3Z" /><path d="m12 6 6 6M3 15l6 6" /></>,
    shield: <><path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Z" /><path d="m8 12 3 3 5-6" /></>,
    external: <><path d="M14 3h7v7M21 3 11 13" /><path d="M10 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6" /></>,
    logout: <path d="M9 3H4v18h5M10 12h11m-5-5 5 5-5 5" />,
    plus: <path d="M12 5v14M5 12h14" />,
    save: <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z" /><path d="M7 3v6h10V3M7 21v-8h10v8" /></>,
    trash: <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8" cy="8" r="1.5" /><path d="m21 15-5-5L5 21" /></>,
    upload: <path d="M12 16V3m-5 5 5-5 5 5M3 15v6h18v-6" />,
    download: <path d="M12 3v13m-5-5 5 5 5-5M3 15v6h18v-6" />,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7v1" /></>,
    check: <path d="m4 12 5 5L20 6" />,
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>,
  };
  return <svg className="adm-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.grid}</svg>;
}
