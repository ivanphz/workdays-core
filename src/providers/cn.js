// ==========================================
// 🇨🇳 providers/cn.js — 中国大陆法定节假日(数据集 'CN')
// ==========================================
// 数据模式(v2.2,ctx.dataSource):
//   · 'bundled'(默认,写死): 查打包归档 src/data/cn.data.js(每日流水线维护,零联网)。
//   · 'online'(可选): 逐年活抓 holiday-cn(源逻辑在 src/sources.js,与流水线同一份);
//     抓到的年份【整年替换】归档口径(修正案即时生效),抓不到的年份退用归档 —— 永不比默认差。
// 为什么默认离线(v2 决策,详见 DEVLOG): CN 假期没有算法,是国务院公告的人为决定;
// 运行时联网的失败模式是"静默按周末猜",打包数据的失败模式是"最多旧一天"且流水线红灯可见。
// 数据含调休语义: isOffDay=true 放假 / isOffDay=false 补班上班。
// 三态 lookup: true=放假 / false=补班上班 / undefined=无记录(按周末兜底)。
//
// ⚠️ 年桶边界(上游即如此,沿袭): "YYYY" 桶内可能含相邻年份日期(如 2007 桶里有
//    2006-12-30/31 的元旦跨年补班),整桶索引与逐年抓取逐语义等价,多出的记录无害。

import { CN_DATA } from '../data/cn.data.js';
import { fetchCnYear } from '../sources.js';

export function createCnProvider(data = CN_DATA) { // data 参数仅供测试注入
  // date -> { off: boolean, names: {lang: name} }
  const records = new Map();
  // 条目容错: schema2 {names:{sc}} / 旧格式 {name}(=sc)
  const namesOf = (d) => (d.names && typeof d.names === 'object') ? { ...d.names } : (d.name != null ? { sc: d.name } : {});

  return {
    dataset: 'CN',
    officialLangs: Array.isArray(data.officialLangs) && data.officialLangs.length ? data.officialLangs : ['sc'],

    async load(years, ctx = {}) {
      const rows = [], logs = [];
      const live = {};
      if (ctx.dataSource === 'online') {
        for (const y of years) {
          const days = await fetchCnYear(y, ctx.fetchImpl);
          if (days) live[y] = days;
        }
        const ok = Object.keys(live).length;
        logs.push(`[CN] online:抓取 ${ok}/${years.length} 年成功${ok < years.length ? ',其余退用归档' : ''}`);
      }
      logs.push(`[CN] vendored holiday-cn(归档 ${Object.keys(data.years).length} 年,generated ${data.generatedAt})`);
      for (const y of years) {
        const list = live[y] || data.years[y];
        if (list && list.length) {
          for (const d of list) records.set(d.date, { off: d.isOffDay === true, names: namesOf(d) });
          rows.push(live[y]
            ? { year: +y, ok: true, mode: 'online', source: 'holiday-cn live' }
            : { year: +y, ok: true, mode: 'bundled', source: `holiday-cn vendored (generated ${data.generatedAt})` });
        } else {
          rows.push({ year: +y, ok: false, mode: 'fallback', source: 'not in vendored archive → weekend-only' });
          logs.push(`[CN ${y}] 归档缺失(公告未发或未刷新)-> weekend-only fallback ⚠️`);
        }
      }
      return { rows, logs };
    },

    /** 三态: true=法定放假 / false=调休补班上班 / undefined=无记录(调用方按周末兜底) */
    lookup(dateStr) {
      const r = records.get(dateStr);
      return r === undefined ? undefined : r.off;
    },

    isOffDay(dateStr) {
      const r = records.get(dateStr);
      return r ? r.off === true : false;
    },

    /** 事实层记录(names 为官方多语对象;译名合并在 hub 的 i18n 层)。补班日两 kind 事实相同 */
    fact(dateStr) {
      const r = records.get(dateStr);
      if (!r) return null;
      return { isHoliday: r.off, isMakeup: !r.off, names: r.names, observed: false, nominalDate: null };
    },

    /** 原始清单: [{date, isOffDay, names, observed}] 升序(legacy 单名解析由 hub.listDays 完成) */
    days() {
      return [...records.entries()]
        .map(([date, r]) => ({ date, isOffDay: r.off, names: r.names, observed: false }))
        .sort((a, b) => (a.date < b.date ? -1 : 1));
    }
  };
}
