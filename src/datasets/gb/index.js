// 🇬🇧 datasets/gb — 英国(清单型,三分治域=三 dataset;官方仅英文)。王室公告裁量 → 必须官方数据。
// 一个数据集文件夹声明多 region-kind → 多 dataset,是"分域即口径"的落地(见 DATASET-GUIDE.md)。
import { GB_DATA } from './data.js';
import { fetchGb } from './fetch.js';
import { createArchiveProvider } from '../_archive-provider.js';
import { GB_TRANSLATIONS } from './translations.js';

const mkProv = (dsId, division) => createArchiveProvider({
  dataset: dsId, tag: `GB:${division}`, sourceName: 'gov.uk', legacyLang: 'en',
  data: GB_DATA, sliceDays: d => (d.divisions || {})[division]
});

export default {
  code: 'gb',
  officialLangs: ['en'],
  translations: GB_TRANSLATIONS,
  regions: [{
    region: 'GB', alpha3: 'GBR', tz: 'Europe/London',
    names: { sc: '英国', tc: '英國', en: 'United Kingdom' },
    defaultKind: 'england',
    kinds: {
      england:  { dataset: 'GB-EAW' },
      scotland: { dataset: 'GB-SCT' },
      ni:       { dataset: 'GB-NIR' }
    }
  }],
  createProviders: () => ({
    'GB-EAW': mkProv('GB-EAW', 'eaw'),
    'GB-SCT': mkProv('GB-SCT', 'sct'),
    'GB-NIR': mkProv('GB-NIR', 'nir')
  }),
  fetch: (fetchImpl) => fetchGb(fetchImpl)
};
