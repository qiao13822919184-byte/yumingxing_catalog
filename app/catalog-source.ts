import type { Product, SiteSettings } from './catalog-types';

// Images in the saved catalogue keep their local paths. Prefix them once when
// reading a Pages snapshot so cards, details and PDF export use the same URLs.
export function catalogueAtBase(data: { products: Product[]; settings: SiteSettings }, base: string) {
  const imageUrl = (value: string) => value ? `${base}${value.replace(/^\/+/, '')}` : '';
  return {
    products: data.products.map(product => ({
      ...product,
      image: imageUrl(product.image),
      gallery: product.gallery?.map(imageUrl),
      blocks: product.blocks?.map(block => block.type === 'image' ? { ...block, content: imageUrl(block.content) } : block),
    })),
    settings: {
      ...data.settings,
      categories: data.settings.categories.map(category => ({ ...category, image: imageUrl(category.image) })),
    },
  };
}
