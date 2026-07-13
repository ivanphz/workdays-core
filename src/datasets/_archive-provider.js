// ==============================================================================
// 🗃 src/providers/archive.js — 通用"官方清单存档"provider(全库唯一一份引擎)
// ==============================================================================
// 消费 docs/DATA-FORMAT.md 的【清单型】数据(schema 2),HK/SG/GB 三分域全部由它驱动 ——
// 从此"AI 照规范生成一个国家" = 一个数据文件 + tokens 表一行 + 注册两行,零 provider 代码。
// 各国差异全部收进配置: { dataset, tag, sourceName, legacyLang, data, sliceDays, fetchLive }。
//   · legacyLang: 旧格式(v2.2 字符串 / {name,observed})条目的已知语言,读取时容错归一
//     (schema.js 单一处),流水线首刷会把文件改写成 schema 2 —— 迁移期每步可部署。
//   · fetchLive(fetchImpl): online 模式的活抓函数,返回 {date: 条目}(任意历史形态皆可,
//     进来即归一);失败返 null → 退用归档,永不比默认差。
//   · officialLangs 取自数据文件声明(可多个,如 HK 三语皆官方);旧文件缺失时退 [legacyLang]。

import { normalizeDayEntry } from '../schema.js';

export function createArchiveProvider({ dataset, tag, sourceName, legacyLang, data, sliceDays }) {
  // date -> 归一化条目 { names, observed, ... }(仅索引请求年份)
  const holidays = new Map();

  return {
    dataset,
    officialLangs: Array.isArray(data.officialLangs) && data.officialLangs.length ? data.officialLangs : [legacyLang],

    async load(years, ctx = {}) {
      const rows = [], logs = [];
      let live = null;
      // ctx.live: loader 已抓好的活数据 {date: 条目}(在线/流水线共用同一 fetcher)
      if (ctx.live) {
        live = {};
        for (const [d, e] of Object.entries(ctx.live)) live[d] = normalizeDayEntry(e, legacyLang);
        logs.push(`[${tag}] online:注入 ${Object.keys(live).length} 天`);
      }
      const bundledRaw = sliceDays(data) || {};
      const bundledDates = Object.keys(bundledRaw);
      logs.push(bundledDates.length
        ? `[${tag}] vendored ${sourceName}(归档 ${bundledDates.length} 天,generated ${data.generatedAt})`
        : `[${tag}] 归档为空(尚未首次运行 Refresh workflow)⚠️`);
      for (const y of years) {
        const prefix = `${y}-`;
        let count = 0, fromLive = false;
        if (live) {
          for (const d of Object.keys(live)) {
            if (d.startsWith(prefix)) { holidays.set(d, live[d]); count++; }
          }
          fromLive = count > 0;
        }
        if (count === 0) {
          for (const d of bundledDates) {
            if (d.startsWith(prefix)) { holidays.set(d, normalizeDayEntry(bundledRaw[d], legacyLang)); count++; }
          }
        }
        rows.push(count > 0
          ? (fromLive
            ? { year: +y, ok: true, mode: 'online', source: `${sourceName} live` }
            : { year: +y, ok: true, mode: 'bundled', source: `${sourceName} vendored (generated ${data.generatedAt})` })
          : { year: +y, ok: false, mode: 'fallback', source: `archive does not cover ${y} → weekend-only` });
        if (count === 0) logs.push(`[${tag} ${y}] 归档缺失 -> weekend-only fallback ⚠️`);
      }
      return { rows, logs };
    },

    isOffDay(dateStr) {
      return holidays.has(dateStr);
    },

    /** 原始事实(names 为官方多语对象;译名合并发生在 hub 的 i18n 层,不在这里) */
    fact(dateStr) {
      const e = holidays.get(dateStr);
      if (!e) return null;
      return { isHoliday: true, isMakeup: false, names: e.names, observed: e.observed === true, nominalDate: e.nominalDate ?? null };
    },

    days() {
      return [...holidays.entries()]
        .map(([date, e]) => ({ date, isOffDay: true, names: e.names, observed: e.observed === true }))
        .sort((a, b) => (a.date < b.date ? -1 : 1));
    }
  };
}
