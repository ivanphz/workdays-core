// ==========================================
// 🇭🇰 providers/hk.js — 香港公众假期(数据集 'HK',通用归档引擎的薄配置)
// ==========================================
// 三语(简/繁/英)皆为官方(officialLangs 由数据文件声明),流水线三语全收。
// 归档以官方历史快照做种(data.gov.hk 存档的 1823 sc.json,2018 起),此后只增不删累积 ——
// 1823 feed 是滚动窗口,本仓库即唯一历史存档。假期含农历,必须官方数据(新国家三问见 DEVLOG)。
// online 模式活抓 1823 三语(sources.fetchHkTrilingual)。旧格式(纯字符串=sc)容错读取。

import { HK_DATA } from '../data/hk.data.js';
import { fetchHkTrilingual } from '../sources.js';
import { createArchiveProvider } from './archive.js';

export function createHkProvider(data = HK_DATA) { // data 参数仅供测试注入
  return createArchiveProvider({
    dataset: 'HK', tag: 'HK', sourceName: '1823.gov.hk', legacyLang: 'sc',
    data, sliceDays: d => d.days,
    fetchLive: f => fetchHkTrilingual(f)
  });
}
