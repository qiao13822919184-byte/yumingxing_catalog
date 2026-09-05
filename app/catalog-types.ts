export type ComponentSpec = {
  id: string;
  nameEn: string;
  nameZh: string;
  material: string;
  size: string;
  weightG: string;
  thicknessMm: string;
  quantity: string;
  unit: string;
};

export type Product = {
  sku: string;
  id: string;
  order: number;
  catalogId: string;
  imageId: string;
  model: string;
  category: string;
  nameEn: string;
  nameZh: string;
  image: string;
  published: boolean;
  verificationStatus: string;
  components: ComponentSpec[];
  descriptionEn?: string;
  descriptionZh?: string;
  gallery?: string[];
  attributes?: { id: string; label: string; value: string }[];
  blocks?: { id: string; type: 'text' | 'image'; title: string; content: string }[];
};

export type Category = { id: string; nameEn: string; nameZh: string; image: string; descriptionEn: string; descriptionZh: string };
export type SiteSettings = { brand: string; whatsapp: string; headlineEn: string; headlineZh: string; accent: string; columns: number; categories: Category[] };
export type InquiryItem = { id: string; sku: string; quantity: string; note: string };
