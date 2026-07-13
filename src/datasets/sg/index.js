// 🇸🇬 datasets/sg — 新加坡(清单型,官方仅英文;简繁译名见 translations)。见月宣告制 → 必须官方数据。
import { SG_DATA } from './data.js';
import { fetchSg } from './fetch.js';
import { createArchiveProvider } from '../_archive-provider.js';
import { SG_TRANSLATIONS } from './translations.js';

export default {
  code: 'sg',
  officialLangs: ['en'],
  translations: SG_TRANSLATIONS,
  regions: [{
    region: 'SG', alpha3: 'SGP', tz: 'Asia/Singapore',
    names: { sc: '新加坡', tc: '新加坡', en: 'Singapore' },
    defaultKind: 'public',
    kinds: { public: { dataset: 'SG' } }
  }],
  createProviders: () => ({ 'SG': createArchiveProvider({ dataset: 'SG', tag: 'SG', sourceName: 'MOM', legacyLang: 'en', data: SG_DATA, sliceDays: d => d.days }) }),
  fetch: (fetchImpl, years) => fetchSg(fetchImpl, years)
};