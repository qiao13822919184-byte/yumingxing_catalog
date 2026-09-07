import type { SiteSettings } from './catalog-types';
export const defaultSettings: SiteSettings = {
  brand: 'YUMINGXING', whatsapp: '8615992577610', headlineEn: 'Considered pieces.\nEveryday possibilities.', headlineZh: '精挑每一件，\n成就每一餐。', accent: '#b4472d', columns: 3,
  categories: [
    { id: 'Kitchenware', nameEn: 'Kitchen essentials', nameZh: '厨房用具', image: '/catalog-products/v9-ref-001-01.png', descriptionEn: 'From prep to serving.', descriptionZh: '从烹饪到盛餐。' },
    { id: 'Cutlery Sets', nameEn: 'Gift sets', nameZh: '餐具礼盒', image: '/catalog-products/v9-ref-008-01.jpeg', descriptionEn: '24-piece sets, your choice of packaging.', descriptionZh: '24件套，多种礼盒包装。' },
    { id: 'Cutlery Collections', nameEn: 'Cutlery collections', nameZh: '餐具系列', image: '/catalog-products/v9-ref-112-01.jpeg', descriptionEn: 'Coordinated designs and individual options.', descriptionZh: '系列搭配，组件可选。' },
    { id: 'Loose Cutlery', nameEn: 'Individual pieces', nameZh: '单品餐具', image: '/catalog-products/v9-ref-085-01.png', descriptionEn: 'Find your finishing touch.', descriptionZh: '找到合适的每一款。' },
  ],
};
