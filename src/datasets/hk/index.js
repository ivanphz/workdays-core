// 🇭🇰 datasets/hk — 香港(清单型,三语皆官方)。1823 官方 JSON+ICS 双源,滚动窗口只增不删。
import { HK_DATA } from './data.js';
import { fetchHk } from './fetch.js';
import { createArchiveProvider } from '../_archive-provider.js';

export default {
  code: 'hk',
  officialLangs: ['sc', 'tc', 'en'],
  regions: [{
    region: 'HK', alpha3: 'HKG', tz: 'Asia/Hong_Kong',
    names: { sc: '香港', tc: '香港', en: 'Hong Kong' },
    defaultKind: 'public',
    kinds: { public: { dataset: 'HK' } }
  }],
  createProviders: () => ({ 'HK': createArchiveProvider({ dataset: 'HK', tag: 'HK', sourceName: '1823.gov.hk', legacyLang: 'sc', data: HK_DATA, sliceDays: d => d.days }) }),
  fetch: (fetchImpl) => fetchHk(fetchImpl)
};
