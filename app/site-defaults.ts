import type { SiteSettings } from './catalog-types';
export const defaultSettings: SiteSettings = {
  brand: 'YUMINGXING', whatsapp: '8615992577610', headlineEn: 'Considered pieces.\nEveryday possibilities.', headlineZh: '精挑每一件，\n成就每一餐。', accent: '#b4472d', columns: 3,
  categories: [
    { id: 'Kitchenware', nameEn: 'Kitchen essentials', nameZh: '厨房用具', image: '/catalog-products/001-img-kitup-007.png', descriptionEn: 'From prep to serving.', descriptionZh: '从烹饪到盛餐。' },
    { id: 'Cutlery Sets', nameEn: 'Cutlery collections', nameZh: '餐具套装', image: '/catalog-products/014-img-cut-053.png', descriptionEn: 'Made to come together.', descriptionZh: '为完整餐桌而搭配。' },
    { id: 'Loose Cutlery', nameEn: 'Individual pieces', nameZh: '单品餐具', image: '/catalog-products/071-img-n304-001.jpg', descriptionEn: 'Find your finishing touch.', descriptionZh: '找到合适的每一款。' },
  ],
};
