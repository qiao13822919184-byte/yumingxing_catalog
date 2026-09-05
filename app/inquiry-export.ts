import type { InquiryItem, Product, SiteSettings } from './catalog-types';

export type InquiryIssue = { index: number; reason: 'missing' | 'unpublished' | 'sku-changed' | 'duplicate' | 'invalid-sku' };
export type InquiryRow = { item: InquiryItem; product: Product };
type ExportSettings = Pick<SiteSettings, 'brand' | 'whatsapp'>;

/** Pure validation shared by the dialog and every export path. Never silently drops an item. */
export function validateInquiry(items: InquiryItem[], products: Product[]) {
  const productById = new Map(products.map((product) => [product.id, product]));
  const skuCounts = new Map<string, number>();
  for (const product of products) {
    const sku = String(product.sku || '').trim();
    if (sku) skuCounts.set(sku, (skuCounts.get(sku) || 0) + 1);
  }
  const seenIds = new Set<string>();
  const seenSkus = new Set<string>();
  const rows: InquiryRow[] = [];
  const issues: InquiryIssue[] = [];
  items.forEach((item, index) => {
    const product = productById.get(item.id);
    let reason: InquiryIssue['reason'] | undefined;
    const sku = String(product?.sku || '').trim();
    if (!product) reason = 'missing';
    else if (!product.published) reason = 'unpublished';
    else if (!sku) reason = 'invalid-sku';
    else if (String(item.sku || '').trim() !== sku) reason = 'sku-changed';
    else if (seenIds.has(item.id) || seenSkus.has(sku) || (skuCounts.get(sku) || 0) > 1) reason = 'duplicate';
    if (reason) issues.push({ index, reason });
    else if (product) rows.push({ item, product });
    seenIds.add(item.id);
    if (sku) seenSkus.add(sku);
  });
  return { rows, issues };
}

function checkedRows(items: InquiryItem[], products: Product[]) {
  const result = validateInquiry(items, products);
  if (!items.length) throw new Error('The inquiry list is empty. / 了解清单为空。');
  if (result.issues.length) throw new Error('Remove unavailable, changed or duplicate products before exporting. / 请先移除不可用、SKU 已变更或重复的产品。');
  return result.rows;
}

/** Quote every field and neutralize formula prefixes, including prefixes hidden by whitespace. */
export function csvCell(value: unknown): string {
  let cell = value == null ? '' : String(value);
  cell = cell.replace(/\r\n|\r|\n/g, '\r\n');
  if (/^[\s\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]*[=+@-]/u.test(cell) || /^[\t\r\n]/u.test(cell)) cell = `'${cell}`;
  return `"${cell.replace(/"/g, '""')}"`;
}

export function inquiryFilename(extension: 'csv' | 'pdf', date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `YMX-inquiry-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.${extension}`;
}

/** UTF-8 BOM CSV; exactly one row per unique SKU. No spreadsheet dependency required. */
export function buildInquiryCsv(items: InquiryItem[], products: Product[], settings: ExportSettings, date = new Date()): string {
  const rows = checkedRows(items, products);
  const attributes = new Map<string, string>();
  const attributeKey = (label: string) => label.trim().toLocaleLowerCase();
  for (const { product } of rows) for (const attr of product.attributes || []) {
    const key = attributeKey(attr.label);
    if (!attributes.has(key)) attributes.set(key, `Attribute / 自定义参数: ${attr.label.trim()}`);
  }
  const componentFields = [
    ['id', 'Component IDs / 组件ID'], ['nameEn', 'Component names EN / 组件英文名'],
    ['nameZh', 'Component names ZH / 组件中文名'], ['material', 'Material / 材质'],
    ['size', 'Size / 尺寸'], ['weightG', 'Weight g / 重量g'], ['thicknessMm', 'Thickness mm / 厚度mm'],
    ['quantity', 'Component quantity / 组件数量'], ['unit', 'Component unit / 组件单位'],
  ] as const;
  const header = [
    'SKU', 'Original catalog code / 原货号', 'Model / 型号', 'Name EN / 英文名称', 'Name ZH / 中文名称',
    'Requested quantity / 意向数量', 'Buyer note / 买家备注', 'Category / 分类',
    'Description EN / 英文说明', 'Description ZH / 中文说明',
    ...componentFields.map(([, label]) => label), 'All components JSON / 全部组件',
    ...attributes.values(), 'All attributes JSON / 全部自定义参数',
    'Custom content JSON / 自定义内容', 'Main image / 主图', 'Gallery images / 图集',
    'Product ID / 产品ID', 'Image ID / 图片ID', 'Verification status / 核验状态',
    'Brand / 品牌', 'Sales WhatsApp / 销售WhatsApp', 'Exported at / 导出时间',
  ];
  const data = rows.map(({ item, product }) => [
    product.sku, product.catalogId, product.model, product.nameEn, product.nameZh,
    item.quantity, item.note, product.category, product.descriptionEn, product.descriptionZh,
    ...componentFields.map(([field]) => product.components.map((component, index) => `${index + 1}. ${component[field] ?? ''}`).join('\n')),
    JSON.stringify(product.components),
    ...Array.from(attributes.keys(), (key) => (product.attributes || []).filter((attr) => attributeKey(attr.label) === key).map((attr) => attr.value).join('\n')),
    JSON.stringify(product.attributes || []), JSON.stringify(product.blocks || []), product.image,
    (product.gallery || []).join('\n'), product.id, product.imageId, product.verificationStatus,
    settings.brand, settings.whatsapp, date.toISOString(),
  ]);
  return '\ufeff' + [header, ...data].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function createInquiryCsv(items: InquiryItem[], products: Product[], settings: ExportSettings, date = new Date()): File {
  return new File([buildInquiryCsv(items, products, settings, date)], inquiryFilename('csv', date), { type: 'text/csv;charset=utf-8' });
}

export function downloadInquiryFile(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Mobile browsers may consume the URL after the click handler returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function whatsappNumber(raw: string): string | null {
  const value = String(raw || '').trim();
  if (!/^\+?[\d\s().-]+$/.test(value)) return null;
  const digits = value.replace(/\D/g, '');
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

export function buildWhatsAppInquiry(items: InquiryItem[], products: Product[], settings: ExportSettings, lang: 'en' | 'zh') {
  const rows = checkedRows(items, products);
  const number = whatsappNumber(settings.whatsapp);
  if (!number) throw new Error('Sales WhatsApp needs a valid phone number with country code. / 销售 WhatsApp 号码需包含有效国家区号。');
  const title = lang === 'zh' ? `您好，我想了解 ${settings.brand} 的以下 ${rows.length} 款产品：` : `Hello, I am interested in these ${rows.length} products from ${settings.brand}:`;
  const text = [title, ...rows.map(({ item, product }, index) => `${index + 1}. SKU: ${product.sku}\n${lang === 'zh' ? '意向数量' : 'Requested quantity'}: ${item.quantity || '—'}\n${lang === 'zh' ? '备注' : 'Note'}: ${item.note || '—'}`)].join('\n\n');
  const url = `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
  const attachmentText = lang === 'zh' ? `您好，我想了解 ${settings.brand} 的 ${rows.length} 款产品。我会手动附上导出的产品了解清单，请根据附件联系我。` : `Hello, I am interested in ${rows.length} products from ${settings.brand}. I will manually attach my exported product inquiry list. Please refer to the attachment.`;
  return { url, text, tooLong: url.length > 6_000, attachmentUrl: `https://wa.me/${number}?text=${encodeURIComponent(attachmentText)}` };
}

const WIDTH = 1240;
const HEIGHT = 1754;
const MARGIN = 62;
const BOTTOM = HEIGHT - 98;
const FONT = 'Arial, "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", sans-serif';
type TextCommand = { kind: 'text'; text: string; x: number; y: number; size: number; bold: boolean; color: string };
type ImageCommand = { kind: 'image'; src: string; x: number; y: number; width: number; height: number };
type RuleCommand = { kind: 'rule'; y: number };
type DrawCommand = TextCommand | ImageCommand | RuleCommand;
type PdfOptions = { date?: Date; signal?: AbortSignal; onProgress?: (done: number, total: number) => void };

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
}
const pauseForBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function wrapText(context: CanvasRenderingContext2D, value: unknown, width: number, size: number, bold = false): string[] {
  context.font = `${bold ? '600' : '400'} ${size}px ${FONT}`;
  const lines: string[] = [];
  for (const paragraph of String(value ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')) {
    if (!paragraph) { lines.push(''); continue; }
    let line = '';
    // Preserve words when they fit; split long tokens and CJK text at Unicode code points.
    for (const token of paragraph.match(/\s+|[^\s]+/gu) || []) {
      if (context.measureText(line + token).width <= width) { line += token; continue; }
      if (line) { lines.push(line.trimEnd()); line = ''; }
      if (context.measureText(token).width <= width) { line = token.trimStart(); continue; }
      for (const character of Array.from(token)) {
        if (line && context.measureText(line + character).width > width) { lines.push(line); line = ''; }
        line += character;
      }
    }
    if (line) lines.push(line.trimEnd());
  }
  return lines.length ? lines : [''];
}

function loadPicture(src: string, signal?: AbortSignal): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    let finished = false;
    const picture = new Image();
    picture.crossOrigin = 'anonymous';
    const finish = (result: HTMLImageElement | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      picture.onload = null;
      picture.onerror = null;
      if (!result) picture.src = '';
      resolve(result);
    };
    const abort = () => finish(null);
    const timer = setTimeout(() => finish(null), 4500);
    picture.onload = () => finish(picture.naturalWidth && picture.naturalHeight ? picture : null);
    picture.onerror = () => finish(null);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted || !src || !/^(https?:|blob:|data:image\/|\/|\.\/|[^:]+$)/i.test(src)) { finish(null); return; }
    picture.src = src;
  });
}

function jpegBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error('Unable to encode PDF page. / 无法生成 PDF 页面。')); return; }
      blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
    }, 'image/jpeg', 0.87);
  });
}

/** A standards-compliant PDF with one JPEG XObject per A4 page and byte-accurate xref. */
export function buildImagePdf(pages: Uint8Array[], width = WIDTH, height = HEIGHT): Blob {
  if (!pages.length) throw new Error('A PDF requires at least one page.');
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const offsets: number[] = [0];
  let length = 0;
  const add = (value: string | Uint8Array) => {
    const bytes = typeof value === 'string' ? encoder.encode(value) : value;
    // Own the backing ArrayBuffer so this also type-checks with modern DOM BlobPart definitions.
    const owned = new Uint8Array(bytes.byteLength);
    owned.set(bytes);
    parts.push(owned.buffer);
    length += bytes.byteLength;
  };
  const object = (id: number, body: string, stream?: Uint8Array) => {
    offsets[id] = length;
    add(`${id} 0 obj\n${body}`);
    if (stream) { add('\nstream\n'); add(stream); add('\nendstream'); }
    add('\nendobj\n');
  };
  add('%PDF-1.4\n%');
  add(new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3]));
  add('\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const ids = pages.map((_, index) => 3 + index * 3);
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${ids.map((id) => `${id} 0 R`).join(' ')}] >>`);
  pages.forEach((jpeg, index) => {
    const pageId = ids[index];
    object(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${pageId + 1} 0 R >> >> /Contents ${pageId + 2} 0 R >>`);
    object(pageId + 1, `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.byteLength} >>`, jpeg);
    const content = encoder.encode('q\n595.28 0 0 841.89 0 0 cm\n/Im0 Do\nQ\n');
    object(pageId + 2, `<< /Length ${content.byteLength} >>`, content);
  });
  const xrefAt = length;
  add(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (let index = 1; index < offsets.length; index++) add(`${String(offsets[index]).padStart(10, '0')} 00000 n \n`);
  add(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

/** Canvas embeds the browser's actual CJK glyphs, so recipients need no installed PDF font. */
export async function createInquiryPdf(items: InquiryItem[], products: Product[], settings: ExportSettings, options: PdfOptions = {}): Promise<File> {
  const rows = checkedRows(items, products);
  const date = options.date || new Date();
  const signal = options.signal;
  checkAbort(signal);
  if (document.fonts?.ready) await document.fonts.ready;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('This browser cannot create PDF pages. / 当前浏览器无法生成 PDF 页面。');
  const pages: DrawCommand[][] = [[]];
  let y = 178;
  let continuation = '';
  const push = (command: DrawCommand) => pages[pages.length - 1].push(command);
  const nextPage = () => {
    pages.push([]);
    y = 178;
    if (continuation) {
      // SKU is repeated on every continuation page. Long identifiers still wrap safely.
      for (const line of wrapText(context, `${continuation} — Continued / 续`, WIDTH - MARGIN * 2, 20, true)) {
        if (y > BOTTOM - 32) { pages.push([]); y = 178; }
        push({ kind: 'text', text: line, x: MARGIN, y, size: 20, bold: true, color: '#334b4b' });
        y += 29;
      }
      y += 10;
    }
  };
  const ensure = (height: number) => { if (y + height > BOTTOM) nextPage(); };
  const textBlock = (value: unknown, { size = 21, bold = false, color = '#223434', indent = 0, gap = 8 }: { size?: number; bold?: boolean; color?: string; indent?: number; gap?: number } = {}) => {
    const lines = wrapText(context, value, WIDTH - MARGIN * 2 - indent, size, bold);
    const lineHeight = Math.ceil(size * 1.46);
    for (const line of lines) {
      ensure(lineHeight);
      push({ kind: 'text', text: line, x: MARGIN + indent, y, size, bold, color });
      y += lineHeight;
    }
    y += gap;
  };
  textBlock(`Brand / 品牌: ${settings.brand}`, { size: 21, bold: true });
  textBlock(`Selected products / 已选产品: ${rows.length}   ·   Sales WhatsApp / 销售 WhatsApp: ${settings.whatsapp}`, { size: 19 });
  textBlock(`Generated / 生成时间: ${date.toLocaleString('en-GB', { hour12: false })} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`, { size: 18 });
  textBlock('Product inquiry only. Final specifications and quotation to be confirmed by sales. / 本清单用于产品了解，最终规格与报价请与销售确认。', { size: 18, color: '#647273', gap: 22 });
  for (let index = 0; index < rows.length; index++) {
    checkAbort(signal);
    const { item, product } = rows[index];
    continuation = '';
    ensure(370);
    push({ kind: 'rule', y });
    y += 22;
    textBlock(`${index + 1}. SKU: ${product.sku}`, { size: 26, bold: true });
    continuation = `SKU: ${product.sku}`;
    textBlock(product.nameEn, { size: 24, bold: true, gap: 3 });
    textBlock(product.nameZh, { size: 23, bold: true, gap: 12 });
    ensure(210);
    push({ kind: 'image', src: product.image, x: MARGIN, y, width: 330, height: 195 });
    y += 210;
    textBlock(`Original catalog code / 原货号: ${product.catalogId || '—'}    |    Model / 型号: ${product.model || '—'}`);
    textBlock(`Category / 分类: ${product.category || '—'}`);
    textBlock(`Requested quantity / 意向数量: ${item.quantity || '—'}`, { bold: true });
    textBlock(`Buyer note / 买家备注: ${item.note || '—'}`);
    if (product.descriptionEn) textBlock(`Description EN / 英文说明: ${product.descriptionEn}`, { size: 20 });
    if (product.descriptionZh) textBlock(`Description ZH / 中文说明: ${product.descriptionZh}`, { size: 20 });
    if (product.components.length) {
      ensure(100);
      textBlock('Component specifications / 组件规格', { size: 22, bold: true, gap: 10 });
      for (let componentIndex = 0; componentIndex < product.components.length; componentIndex++) {
        const component = product.components[componentIndex];
        ensure(100);
        textBlock(`${componentIndex + 1}. ${component.nameEn || '—'} / ${component.nameZh || '—'}`, { size: 20, bold: true, indent: 16 });
        textBlock(`Material / 材质: ${component.material || '—'}    ·    Size / 尺寸: ${component.size || '—'}`, { size: 19, indent: 16 });
        textBlock(`Weight / 重量 (g): ${component.weightG || '—'}    ·    Thickness / 厚度 (mm): ${component.thicknessMm || '—'}`, { size: 19, indent: 16 });
        textBlock(`Component quantity / 组件数量: ${component.quantity || '—'}    ·    Unit / 单位: ${component.unit || '—'}    ·    ID: ${component.id || '—'}`, { size: 19, indent: 16, gap: 12 });
      }
    }
    if (product.attributes?.length) {
      ensure(80);
      textBlock('Additional specifications / 自定义参数', { size: 22, bold: true });
      for (const attribute of product.attributes) textBlock(`${attribute.label}: ${attribute.value || '—'}`, { size: 20, indent: 16 });
    }
    if (product.blocks?.length) {
      ensure(80);
      textBlock('Additional product details / 补充产品信息', { size: 22, bold: true });
      for (const block of product.blocks) {
        if (block.title) textBlock(block.title, { size: 20, bold: true, indent: 16 });
        if (block.type === 'image') {
          ensure(226);
          push({ kind: 'image', src: block.content, x: MARGIN + 16, y, width: 450, height: 210 });
          y += 226;
          textBlock(`Image source / 图片来源: ${block.content}`, { size: 16, indent: 16, color: '#647273' });
        } else textBlock(block.content, { size: 20, indent: 16 });
      }
    }
    y += 24;
    if (index % 3 === 0) await pauseForBrowser();
  }
  const encodedPages: Uint8Array[] = [];
  try {
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      checkAbort(signal);
      const page = pages[pageIndex];
      // Load each page's pictures together; blocked remote images never prevent text export.
      const pictures = await Promise.all(page.map((command) => command.kind === 'image' ? loadPicture(command.src, signal) : Promise.resolve(null)));
      checkAbort(signal);
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, WIDTH, HEIGHT);
      context.textBaseline = 'top';
      context.fillStyle = '#173f3f';
      context.font = `600 28px ${FONT}`;
      context.fillText('PRODUCT INQUIRY / 产品了解清单', MARGIN, 53);
      context.font = `400 18px ${FONT}`;
      const shortBrand = Array.from(settings.brand).slice(0, 70).join('');
      context.fillText(shortBrand, MARGIN, 103, WIDTH - MARGIN * 2);
      context.strokeStyle = '#d5dfdc';
      context.beginPath(); context.moveTo(MARGIN, 142); context.lineTo(WIDTH - MARGIN, 142); context.stroke();
      page.forEach((command, commandIndex) => {
        if (command.kind === 'text') {
          context.font = `${command.bold ? '600' : '400'} ${command.size}px ${FONT}`;
          context.fillStyle = command.color;
          context.fillText(command.text, command.x, command.y);
        } else if (command.kind === 'rule') {
          context.strokeStyle = '#d5dfdc';
          context.beginPath(); context.moveTo(MARGIN, command.y); context.lineTo(WIDTH - MARGIN, command.y); context.stroke();
        } else {
          context.fillStyle = '#f6f7f3';
          context.fillRect(command.x, command.y, command.width, command.height);
          const picture = pictures[commandIndex];
          if (picture) {
            const scale = Math.min((command.width - 12) / picture.naturalWidth, (command.height - 12) / picture.naturalHeight);
            const w = picture.naturalWidth * scale; const h = picture.naturalHeight * scale;
            context.drawImage(picture, command.x + (command.width - w) / 2, command.y + (command.height - h) / 2, w, h);
          } else {
            context.fillStyle = '#647273'; context.font = `400 17px ${FONT}`;
            context.fillText('Image unavailable / 图片暂不可用', command.x + 12, command.y + 18);
          }
        }
      });
      context.fillStyle = '#647273';
      context.font = `400 17px ${FONT}`;
      context.fillText(`${date.toLocaleDateString('en-GB')}   ·   WhatsApp: ${settings.whatsapp}`, MARGIN, HEIGHT - 59, WIDTH - MARGIN * 2 - 195);
      context.textAlign = 'right';
      context.fillText(`Page / 页 ${pageIndex + 1} / ${pages.length}`, WIDTH - MARGIN, HEIGHT - 59);
      context.textAlign = 'left';
      encodedPages.push(await jpegBytes(canvas));
      options.onProgress?.(pageIndex + 1, pages.length);
      await pauseForBrowser();
    }
    checkAbort(signal);
    return new File([buildImagePdf(encodedPages)], inquiryFilename('pdf', date), { type: 'application/pdf' });
  } finally {
    // Release the large rendering surface promptly on mobile devices.
    canvas.width = 1;
    canvas.height = 1;
  }
}
