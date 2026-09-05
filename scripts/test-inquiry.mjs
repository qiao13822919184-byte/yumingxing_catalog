/** Run with Node 24: node scripts/test-inquiry.mjs. No server or new dependencies required. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildImagePdf, buildInquiryCsv, buildWhatsAppInquiry, createInquiryCsv,
  csvCell, inquiryFilename, validateInquiry, whatsappNumber,
} from '../app/inquiry-export.ts';

const checks = [];
const test = (name, fn) => { fn(); checks.push(name); };
const exportedAt = new Date('2026-09-05T00:00:00Z');
const products = Array.from({ length: 110 }, (_, index) => ({
  id: `p-${index}`, sku: `YMX-${String(index + 1).padStart(4, '0')}`, order: index,
  catalogId: `原号${index}`, imageId: String(index), model: `MODEL-${index}`,
  category: 'Kitchenware', nameEn: 'Spoon, "Premium"', nameZh: '不锈钢汤匙',
  image: '/example.jpg', published: true, verificationStatus: 'original',
  descriptionEn: 'Line one\nLine two', descriptionZh: '产品中文说明',
  gallery: ['/example.jpg', '/detail.jpg'],
  components: [{ id: `c-${index}`, nameEn: 'Spoon', nameZh: '汤匙', material: '304', size: '20 cm', weightG: '55', thicknessMm: '2', quantity: '1', unit: 'pc' }],
  attributes: [{ id: 'finish', label: '表面工艺', value: '镜光' }, { id: 'package', label: '包装', value: '礼盒' }],
  blocks: [{ id: 'detail', type: 'text', title: '说明', content: 'Custom content / 自定义说明' }],
}));
const items = products.map((product, index) => ({
  id: product.id, sku: product.sku,
  quantity: index === 0 ? '=SUM(1,2)' : '500 sets',
  note: index === 0 ? '\t=HYPERLINK("https://example.test")\n第二行，备注' : `Buyer note ${index}`,
}));
const settings = { brand: 'Yumingxing', whatsapp: '8615992577610' };

// A strict parser for these always-quoted RFC 4180 cells, including quoted CRLFs.
function parseCsv(text) {
  assert.equal(text.charCodeAt(0), 0xfeff, 'UTF-8 BOM');
  const rows = [];
  let row = []; let cell = ''; let quoted = false;
  for (let index = 1; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(cell); cell = '';
    } else if (character === '\r' && text[index + 1] === '\n' && !quoted) {
      row.push(cell); rows.push(row); row = []; cell = ''; index++;
    } else cell += character;
  }
  assert.equal(quoted, false, 'Every quoted field closes');
  assert.equal(cell, '', 'CSV ends in CRLF');
  return rows;
}

const csv = buildInquiryCsv(items, products, settings, exportedAt);
const csvRows = parseCsv(csv);
const column = (label) => csvRows[0].indexOf(label);
test('110 unique SKUs, UTF-8 BOM, uniform columns and CRLF records', () => {
  assert.equal(csvRows.length, 111);
  assert.equal(new Set(csvRows.slice(1).map((row) => row[0])).size, 110);
  assert.ok(csvRows.every((row) => row.length === csvRows[0].length));
  assert.ok(!/(?<!\r)\n/.test(csv), 'No bare LF, including in cell contents');
  assert.equal(csvRows[1][column('Name EN / 英文名称')], 'Spoon, "Premium"');
  assert.equal(csvRows[1][column('Name ZH / 中文名称')], '不锈钢汤匙');
  assert.equal(csvRows[110][0], 'YMX-0110');
});
test('CSV formula injection defenses apply to every cell and whitespace prefix', () => {
  for (const prefix of ['=', '+', '-', '@', ' \t=', '\u200b=', '\ufeff=', '\n=']) {
    assert.ok(csvCell(`${prefix}dangerous`).startsWith('"\''), `Protected prefix ${JSON.stringify(prefix)}`);
  }
  assert.equal(csvCell('ordinary "text",中文'), '"ordinary ""text"",中文"');
  assert.equal(csvCell(null), '""');
  assert.equal(csvRows[1][column('Requested quantity / 意向数量')], "'=SUM(1,2)");
  assert.equal(csvRows[1][column('Buyer note / 买家备注')], '\'\t=HYPERLINK("https://example.test")\r\n第二行，备注');
  const unsafeProduct = { ...products[0], nameEn: '=FORMULA()', catalogId: '+CODE', attributes: [{ id: 'danger', label: '=Label', value: '-Formula' }] };
  const unsafeRows = parseCsv(buildInquiryCsv([items[0]], [unsafeProduct], { brand: '@BRAND', whatsapp: settings.whatsapp }));
  assert.ok(unsafeRows[1].includes("'=FORMULA()"));
  assert.ok(unsafeRows[1].includes("'+CODE"));
  assert.ok(unsafeRows[1].includes("'-Formula"));
  assert.ok(unsafeRows[1].includes("'@BRAND"));
});
test('Original code, model, all components, attributes and custom contents are retained', () => {
  const row = csvRows[1];
  assert.equal(row[column('Original catalog code / 原货号')], '原号0');
  assert.equal(row[column('Model / 型号')], 'MODEL-0');
  assert.deepEqual(JSON.parse(row[column('All components JSON / 全部组件')]), products[0].components);
  assert.deepEqual(JSON.parse(row[column('All attributes JSON / 全部自定义参数')]), products[0].attributes);
  assert.deepEqual(JSON.parse(row[column('Custom content JSON / 自定义内容')]), products[0].blocks);
  assert.equal(row[column('Attribute / 自定义参数: 表面工艺')], '镜光');
  assert.equal(row[column('Sales WhatsApp / 销售WhatsApp')], settings.whatsapp);
});
test('Attribute labels share one column across random IDs, whitespace and case without losing values', () => {
  const catalog = [
    { ...products[0], attributes: [
      { id: 'random-a', label: ' 包装 ', value: '礼盒' },
      { id: 'random-b', label: '包装', value: '外箱' },
      { id: 'random-c', label: ' Finish ', value: 'Mirror' },
    ] },
    { ...products[1], attributes: [
      { id: 'random-d', label: '包装', value: '彩盒' },
      { id: 'random-e', label: 'FINISH', value: 'Satin' },
    ] },
  ];
  const merged = parseCsv(buildInquiryCsv(items.slice(0, 2), catalog, settings, exportedAt));
  const attributeHeaders = merged[0].filter((label) => label.startsWith('Attribute / 自定义参数:'));
  assert.deepEqual(attributeHeaders, ['Attribute / 自定义参数: 包装', 'Attribute / 自定义参数: Finish']);
  const packageColumn = merged[0].indexOf('Attribute / 自定义参数: 包装');
  const finishColumn = merged[0].indexOf('Attribute / 自定义参数: Finish');
  const jsonColumn = merged[0].indexOf('All attributes JSON / 全部自定义参数');
  assert.equal(merged[1][packageColumn], '礼盒\r\n外箱');
  assert.equal(merged[2][packageColumn], '彩盒');
  assert.equal(merged[1][finishColumn], 'Mirror');
  assert.equal(merged[2][finishColumn], 'Satin');
  assert.deepEqual(JSON.parse(merged[1][jsonColumn]), catalog[0].attributes);
  assert.deepEqual(JSON.parse(merged[2][jsonColumn]), catalog[1].attributes);
  assert.ok(attributeHeaders.every((label) => !label.includes('random-')));
});
test('Unavailable, unpublished, changed and duplicate entries block export', () => {
  assert.equal(validateInquiry(items, products).issues.length, 0);
  const cases = [
    [items, products.slice(1), 'missing'],
    [items, [{ ...products[0], published: false }, ...products.slice(1)], 'unpublished'],
    [items, [{ ...products[0], sku: 'CHANGED' }, ...products.slice(1)], 'sku-changed'],
    [items, [{ ...products[0], sku: '' }, ...products.slice(1)], 'invalid-sku'],
    [[...items, items[0]], products, 'duplicate'],
    [[items[0]], [...products, { ...products[0], id: 'different-id' }], 'duplicate'],
  ];
  for (const [selection, catalog, reason] of cases) {
    assert.ok(validateInquiry(selection, catalog).issues.some((issue) => issue.reason === reason));
    assert.throws(() => buildInquiryCsv(selection, catalog, settings));
    assert.throws(() => buildWhatsAppInquiry(selection, catalog, settings, 'en'));
  }
  assert.throws(() => buildInquiryCsv([], products, settings));
});
test('Phone normalization, full WhatsApp text and explicit attachment fallback', () => {
  assert.equal(whatsappNumber('+86 (159) 9257-7610'), '8615992577610');
  assert.equal(whatsappNumber('0015992577610'), null);
  assert.equal(whatsappNumber('javascript:12345678'), null);
  assert.equal(whatsappNumber(''), null);
  assert.throws(() => buildWhatsAppInquiry(items, products, { ...settings, whatsapp: '123' }, 'en'));
  const large = buildWhatsAppInquiry(items, products, settings, 'zh');
  assert.equal(large.tooLong, true);
  for (const item of items) assert.ok(large.text.includes(item.sku));
  assert.ok(large.text.includes(items[0].note));
  assert.ok(large.attachmentUrl.startsWith('https://wa.me/8615992577610?text='));
  assert.ok(decodeURIComponent(large.attachmentUrl).includes('手动附上'));
  const small = buildWhatsAppInquiry([items[1]], products, settings, 'en');
  assert.equal(small.tooLong, false);
  assert.ok(small.text.includes('500 sets'));
  assert.ok(small.text.includes('Buyer note 1'));
});
test('CSV File is honestly named and carries a dated filename and MIME type', () => {
  const file = createInquiryCsv(items, products, settings, exportedAt);
  assert.ok(file.name.endsWith('.csv'));
  assert.ok(file.name.includes('2026-09-05'));
  assert.equal(file.type, 'text/csv;charset=utf-8');
  assert.ok(inquiryFilename('pdf', exportedAt).endsWith('.pdf'));
});

// Valid RGB 8 × 8 JPEG, generated once with Pillow; no Pillow dependency for this test.
const jpeg = new Uint8Array(Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==', 'base64'));
const pdf = buildImagePdf([jpeg, jpeg], 8, 8);
const pdfBytes = Buffer.from(await pdf.arrayBuffer());
const pdfText = pdfBytes.toString('latin1');
test('Real PDF page tree, image streams, stream lengths and byte-accurate xref', () => {
  assert.throws(() => buildImagePdf([]));
  assert.equal(pdf.type, 'application/pdf');
  assert.ok(pdfText.startsWith('%PDF-1.4'));
  assert.ok(pdfText.endsWith('%%EOF\n'));
  assert.ok(pdfText.includes('/Count 2'));
  assert.ok(pdfText.includes('/Kids [3 0 R 6 0 R]'));
  const xref = Number(pdfText.match(/startxref\n(\d+)/)[1]);
  assert.equal(pdfText.slice(xref, xref + 4), 'xref');
  const entries = pdfText.slice(xref).split('\n');
  for (let id = 1; id <= 8; id++) {
    const offset = Number(entries[id + 2].slice(0, 10));
    assert.ok(pdfText.slice(offset).startsWith(`${id} 0 obj`), `Object ${id} byte offset`);
  }
  const imageMatches = [...pdfText.matchAll(/\/Filter \/DCTDecode \/Length (\d+) >>\nstream\n/g)];
  assert.equal(imageMatches.length, 2);
  for (const match of imageMatches) {
    const offset = match.index + match[0].length;
    assert.equal(Number(match[1]), jpeg.byteLength);
    assert.deepEqual(pdfBytes.subarray(offset, offset + jpeg.byteLength), Buffer.from(jpeg));
    assert.equal(pdfText.slice(offset + jpeg.byteLength, offset + jpeg.byteLength + 10), '\nendstream');
  }
});

let parser = 'not available (structural assertions still passed)';
const temporaryRoot = path.resolve(os.tmpdir());
const temporaryDirectory = await mkdtemp(path.join(temporaryRoot, 'ymx-inquiry-test-'));
try {
  const filename = path.join(temporaryDirectory, 'inquiry-structure-test.pdf');
  await writeFile(filename, pdfBytes);
  const info = spawnSync('pdfinfo', [filename], { encoding: 'utf8', windowsHide: true });
  if (!info.error) {
    assert.equal(info.status, 0, info.stderr);
    assert.match(info.stdout, /Pages:\s+2/);
    assert.match(info.stdout, /PDF version:\s+1\.4/);
    parser = 'Poppler pdfinfo: valid 2-page A4 PDF 1.4';
    checks.push('Independent Poppler PDF parser');
    const rendered = spawnSync('pdftoppm', ['-f', '1', '-singlefile', '-scale-to', '64', '-png', filename, path.join(temporaryDirectory, 'page')], { encoding: 'utf8', windowsHide: true });
    if (!rendered.error) {
      assert.equal(rendered.status, 0, rendered.stderr);
      const png = await readFile(path.join(temporaryDirectory, 'page.png'));
      assert.equal(png.subarray(1, 4).toString(), 'PNG');
      checks.push('Independent Poppler JPEG-page rendering');
    }
  }
} finally {
  const resolved = path.resolve(temporaryDirectory);
  if (path.dirname(resolved) !== temporaryRoot || !path.basename(resolved).startsWith('ymx-inquiry-test-')) throw new Error('Unexpected temporary cleanup path');
  await rm(resolved, { recursive: true, force: true });
}

console.log(JSON.stringify({ result: 'PASS', checks, selectedProducts: 110, csvRows: csvRows.length, csvColumns: csvRows[0].length, pdf: parser, limitations: ['Canvas font rendering, real image loading, mobile downloads and the native share sheet require browser/device verification. PDF text is rasterized, so it is readable and printable but not searchable or selectable.'] }, null, 2));
