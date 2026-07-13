// 🇨🇳 CN provider — 三态调休型(自持,不走通用归档引擎)。只查表,抓取由 fetch.js 独立完成。
import { normalizeDayEntry } from '../../schema.js';

export function createCnProvider(data) {
  const records = new Map();
  const namesOf = (d) => (d.names && typeof d.names === 'object') ? { ...d.names } : (d.name != null ? { sc: d.name } : {});
  return {
    dataset: 'CN',
    officialLangs: Array.isArray(data.officialLangs) && data.officialLangs.length ? data.officialLangs : ['sc'],
    async load(years, ctx = {}) {
      const rows = [], logs = [];
      // ctx.live: loader 已抓好的年份数据 {year: [entries]} 或按日期(此处 CN 用年桶)
      const live = ctx.live || null;
      if (live) logs.push(`[CN] online:注入 ${Object.keys(live).length} 年`);
      logs.push(`[CN] vendored holiday-cn(归档 ${Object.keys(data.years).length} 年,generated ${data.generatedAt})`);
      for (const y of years) {
        const list = (live && live[y]) || data.years[y];
        if (list && list.length) {
          for (const d of list) records.set(d.date, { off: d.isOffDay === true, names: namesOf(d) });
          rows.push({ year: +y, ok: true, mode: (live && live[y]) ? 'online' : 'bundled', source: (live && live[y]) ? 'holiday-cn live' : `vendored (generated ${data.generatedAt})` });
        } else {
          rows.push({ year: +y, ok: false, mode: 'fallback', source: 'not in archive → weekend-only' });
          logs.push(`[CN ${y}] 归档缺失 -> weekend-only fallback ⚠️`);
        }
      }
      return { rows, logs };
    },
    lookup(dateStr) { const r = records.get(dateStr); return r === undefined ? undefined : r.off; },
    isOffDay(dateStr) { const r = records.get(dateStr); return r ? r.off === true : false; },
    fact(dateStr) { const r = records.get(dateStr); if (!r) return null; return { isHoliday: r.off, isMakeup: !r.off, names: r.names, observed: false, nominalDate: null }; },
    days() { return [...records.entries()].map(([date, r]) => ({ date, isOffDay: r.off, names: r.names, observed: false })).sort((a, b) => (a.date < b.date ? -1 : 1)); }
  };
}
