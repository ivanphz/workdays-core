// ==========================================
// 🇸🇬 providers/sg.js — 新加坡公众假期(数据集 'SG',通用归档引擎的薄配置)
// ==========================================
// 历法最杂(公历+农历+复活节+伊斯兰历+印度历+佛历),伊斯兰历/印度历为见月宣告制 →
// 必须官方数据(新国家三问见 DEVLOG)。落周日的官方补假日已在清单里,直接存档。
// 官方源仅英文(officialLangs:["en"]);简中/繁中译名由 translations.js 提供并在 hub 层合并。
// online 模式活抓 data.gov.sg(多步编排偏慢,订阅/服务场景建议默认 bundled)。

import { SG_DATA } from '../data/sg.data.js';
import { fetchSgDays } from '../sources.js';
import { createArchiveProvider } from './archive.js';

export function createSgProvider(data = SG_DATA) { // data 参数仅供测试注入
  return createArchiveProvider({
    dataset: 'SG', tag: 'SG', sourceName: 'data.gov.sg', legacyLang: 'en',
    data, sliceDays: d => d.days,
    fetchLive: f => fetchSgDays(f)
  });
}
