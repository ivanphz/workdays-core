// ==========================================
// 🇬🇧 providers/gb.js — 英国 bank holiday(GB-EAW/GB-SCT/GB-NIR,通用归档引擎的薄配置)
// ==========================================
// 基线规则可算,但王室公告裁量层(加冕/婚礼/葬礼,平均两三年一次)把它踢回数据阵营
// (新国家三问见 DEVLOG)。三分治域假期互不相同,kind 承载(england 默认/scotland/ni)。
// 伦敦证交所≈E&W,不设 market。observed: gov.uk 直接给替代日(substitute day)→ true,
// 官方不给名义日 → nominalDate null。官方源仅英文;简中/繁中译名走 translations.js。

import { GB_DATA } from '../data/gb.data.js';
import { fetchGbDivisions } from '../sources.js';
import { createArchiveProvider } from './archive.js';

const DATASET_OF_DIVISION = { eaw: 'GB-EAW', sct: 'GB-SCT', nir: 'GB-NIR' };

export function createGbProvider(division, data = GB_DATA) { // data 参数仅供测试注入
  return createArchiveProvider({
    dataset: DATASET_OF_DIVISION[division], tag: `GB:${division}`, sourceName: 'gov.uk', legacyLang: 'en',
    data, sliceDays: d => (d.divisions || {})[division],
    fetchLive: async (f) => {
      const all = await fetchGbDivisions(f);
      return all ? all[division] : null;
    }
  });
}
