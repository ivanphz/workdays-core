// 🇨🇳 datasets/cn — 中国大陆(三态调休型)。自包含: 清单 + 数据 + provider + fetcher + 译名。
import { CN_DATA } from './data.js';
import { fetchCn } from './fetch.js';
import { createCnProvider } from './provider.js';
import { CN_TRANSLATIONS } from './translations.js';

export default {
  code: 'cn',
  officialLangs: ['sc'],
  translations: CN_TRANSLATIONS,
  regions: [{
    region: 'CN', alpha3: 'CHN', tz: 'Asia/Shanghai',
    names: { sc: '中国大陆', tc: '中國大陸', en: 'Chinese mainland' },
    defaultKind: 'bank',
    kinds: { bank: { dataset: 'CN' }, market: { dataset: 'CN' } }
  }],
  createProviders: () => ({ 'CN': createCnProvider(CN_DATA) }),
  fetch: (fetchImpl, years) => fetchCn(fetchImpl, years)
};
