// 🇺🇸 datasets/us — 美国(算法型,零联网、零数据文件)。bank=联邦(联储清算口径),market=NYSE。
// 算法型数据集: 无 data.js、无 fetch,provider 自带纯算法生成。官方英文,简繁译名见 translations。
import { createUsProvider } from './provider.js';
import { createUsMarketProvider } from './provider-market.js';
import { US_TRANSLATIONS } from './translations.js';

export default {
  code: 'us',
  officialLangs: ['en'],
  translations: US_TRANSLATIONS,
  regions: [{
    region: 'US', alpha3: 'USA', tz: 'America/New_York',
    names: { sc: '美国', tc: '美國', en: 'United States' },
    defaultKind: 'bank',
    kinds: { bank: { dataset: 'US' }, market: { dataset: 'US-NYSE' } }
  }],
  createProviders: () => ({ 'US': createUsProvider(), 'US-NYSE': createUsMarketProvider() })
  // 无 fetch: 算法型数据集不参与流水线抓取
};
