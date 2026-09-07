import { randomUUID } from 'node:crypto';

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const fail = (message) => { throw new ApiError(400, message); };
const object = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
};
const text = (value, label, max = 500, required = false) => {
  if (value === undefined) value = '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) fail(`Invalid ${label}`);
  const result = value.trim();
  if (required && !result) fail(`${label} is required`);
  return result;
};
const array = (value, label, limit = 1000) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > limit) fail(`Invalid ${label}`);
  return value;
};
const unique = (values, label) => {
  if (new Set(values).size !== values.length) fail(`Duplicate ${label}`);
};

export function imageUrl(value, label = 'image') {
  const url = text(value, label, 1500);
  if (!url) return '';
  // Images are supplied by this installation. Remote URLs and active formats are not accepted.
  if (!/^\/(?:media|catalog-products)\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:png|jpe?g|webp)$/i.test(url) || url.includes('..')) fail(`Invalid ${label}: use an uploaded image`);
  return url;
}

export const DEFAULT_SETTINGS = {
  brand: 'YUMINGXING', whatsapp: '8615992577610',
  headlineEn: 'Considered pieces.\nEveryday possibilities.', headlineZh: '精挑每一件，\n成就每一餐。',
  accent: '#b4472d', columns: 3,
  categories: [
    { id: 'Kitchenware', nameEn: 'Kitchen essentials', nameZh: '厨房用具', image: '/catalog-products/v9-ref-001-01.png', descriptionEn: 'From prep to serving.', descriptionZh: '从烹饪到盛餐。' },
    { id: 'Cutlery Sets', nameEn: 'Gift sets', nameZh: '餐具礼盒', image: '/catalog-products/v9-ref-008-01.jpeg', descriptionEn: '24-piece sets, your choice of packaging.', descriptionZh: '24件套，多种礼盒包装。' },
    { id: 'Cutlery Collections', nameEn: 'Cutlery collections', nameZh: '餐具系列', image: '/catalog-products/v9-ref-112-01.jpeg', descriptionEn: 'Coordinated designs and individual options.', descriptionZh: '系列搭配，组件可选。' },
    { id: 'Loose Cutlery', nameEn: 'Individual pieces', nameZh: '单品餐具', image: '/catalog-products/v9-ref-085-01.png', descriptionEn: 'Find your finishing touch.', descriptionZh: '找到合适的每一款。' },
  ],
};

export function validateSettings(input, previous = DEFAULT_SETTINGS) {
  object(input, 'settings');
  const data = { ...previous, ...input };
  const categories = array(data.categories, 'categories', 200).map((entry) => {
    object(entry, 'category');
    return {
      id: text(entry.id, 'category id', 100, true),
      nameEn: text(entry.nameEn, 'category nameEn', 150, true),
      nameZh: text(entry.nameZh, 'category nameZh', 150),
      image: imageUrl(entry.image, 'category image'),
      descriptionEn: text(entry.descriptionEn, 'category descriptionEn', 3000),
      descriptionZh: text(entry.descriptionZh, 'category descriptionZh', 3000),
    };
  });
  unique(categories.map((c) => c.id.toLowerCase()), 'category id');
  if (!/^[1-9][0-9]{6,14}$/.test(data.whatsapp)) fail('WhatsApp number must contain 7–15 international digits, without +');
  if (!/^#[a-fA-F0-9]{6}$/.test(data.accent)) fail('Invalid accent color');
  if (!Number.isInteger(data.columns) || data.columns < 2 || data.columns > 5) fail('columns must be an integer from 2 to 5');
  return {
    brand: text(data.brand, 'brand', 100, true), whatsapp: data.whatsapp,
    headlineEn: text(data.headlineEn, 'headlineEn', 300), headlineZh: text(data.headlineZh, 'headlineZh', 300),
    accent: data.accent, columns: data.columns, categories,
  };
}

export function validateProduct(input, settings, existing) {
  object(input, 'product');
  if (existing && input.id !== undefined && input.id !== existing.id) fail('Product id cannot be changed');
  if (existing && input.sku !== undefined && input.sku !== existing.sku) fail('SKU cannot be changed after creation');
  const data = {
    id: randomUUID(), order: 0, catalogId: '', imageId: '', model: '', nameEn: '', nameZh: '',
    category: settings.categories[0]?.id ?? '', image: '', published: false,
    verificationStatus: 'Needs confirmation', components: [], gallery: [], attributes: [], blocks: [],
    ...existing, ...input,
  };
  const id = text(data.id, 'product id', 160, true);
  const sku = text(data.sku, 'SKU', 120, true);
  if (/[\r\n\t]/.test(id + sku)) fail('Product id and SKU must be single-line');
  if (!Number.isSafeInteger(data.order) || data.order < 0) fail('order must be a non-negative integer');
  if (typeof data.published !== 'boolean') fail('published must be a boolean');
  if (!['Verified', 'Needs confirmation', 'Reference only'].includes(data.verificationStatus)) fail('Invalid verificationStatus');
  if (data.published && data.verificationStatus !== 'Verified') fail('Only Verified products may be published');
  if (!settings.categories.some((category) => category.id === data.category)) fail('Product category does not exist');
  const components = array(data.components, 'components').map((component) => {
    object(component, 'component');
    const result = { id: text(component.id ?? randomUUID(), 'component id', 160, true) };
    for (const key of ['nameEn', 'nameZh', 'material', 'size', 'weightG', 'thicknessMm', 'quantity', 'unit']) result[key] = text(component[key], `component ${key}`, 1000);
    return result;
  });
  unique(components.map((c) => c.id), 'component id');
  const attributes = array(data.attributes, 'attributes').map((attribute) => {
    object(attribute, 'attribute');
    return { id: text(attribute.id ?? randomUUID(), 'attribute id', 160, true), label: text(attribute.label, 'attribute label', 300, true), value: text(attribute.value, 'attribute value', 3000) };
  });
  unique(attributes.map((a) => a.id), 'attribute id');
  const blocks = array(data.blocks, 'blocks', 300).map((block) => {
    object(block, 'block');
    if (!['text', 'image'].includes(block.type)) fail('Block type must be text or image');
    return {
      id: text(block.id ?? randomUUID(), 'block id', 160, true), type: block.type,
      title: text(block.title, 'block title', 300),
      content: block.type === 'image' ? imageUrl(block.content, 'block image') : text(block.content, 'block content', 20000),
    };
  });
  unique(blocks.map((b) => b.id), 'block id');
  const result = {
    id, sku, order: data.order, category: data.category, image: imageUrl(data.image),
    published: data.published, verificationStatus: data.verificationStatus, components,
    gallery: array(data.gallery, 'gallery', 200).map((url) => imageUrl(url, 'gallery image')),
    attributes, blocks,
  };
  for (const key of ['catalogId', 'imageId', 'model', 'nameEn', 'nameZh']) result[key] = text(data[key], key, 500);
  for (const key of ['descriptionEn', 'descriptionZh']) result[key] = text(data[key], key, 20000);
  if (result.published && (!result.nameEn || !result.image)) fail('Published products require nameEn and image');
  return result;
}

export function validateCategoryReferences(products, settings) {
  const ids = new Set(settings.categories.map((category) => category.id));
  const referenced = products.find((product) => !ids.has(product.category));
  if (referenced) throw new ApiError(409, `Category is still referenced by SKU ${referenced.sku}; migrate its products before removing or changing the category id`);
}
