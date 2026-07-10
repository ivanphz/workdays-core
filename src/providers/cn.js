// ==========================================
// 🇨🇳 providers/cn.js — 中国大陆法定节假日(数据集 'CN')
// ==========================================
// 数据源: NateScarlet/holiday-cn(国务院发文的机器可读版)。两个消费项目原本各自
// 抓的就是这同一个源、同三个镜像 —— 本文件即"单一真相源"的合并落点。
// 数据含调休语义: isOffDay=true 放假 / isOffDay=false 补班上班(周末被官方标为工作日)。
// URL 硬编码(公共、不敏感,经拍板);源换址=改这里+发 patch 版,两个下游自动跟上。
//
// 与 reminder-hub 原 cn.js 的差异(刻意增强,行为超集):
//   · 除 isOffDay 外同时保存 name(假期名) —— alarm-api 的 isNamedHoliday 需要它。
//   · load 返回结构化 coverage rows(哪年拿到了权威数据、哪年降级),供 hub 汇总。
// 三态 lookup 语义逐字保留: true=放假 / false=补班上班 / undefined=数据没有(按周末兜底)。

const CN_HOLIDAY_URLS = [
  'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json',
  'https://fastly.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json',
  'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/{year}.json'
];

export function createCnProvider() {
  // date -> { off: boolean, name: string|null }
  const records = new Map();

  return {
    dataset: 'CN',

    /** @returns {{rows: Array, logs: string[]}} rows = coverage 行(按年);logs = 人类可读日志 */
    async load(years, { fetchImpl } = {}) {
      const f = fetchImpl || globalThis.fetch;
      const rows = [], logs = [];
      await Promise.all(years.map(async (year) => {
        for (const tpl of CN_HOLIDAY_URLS) {
          const url = tpl.replace('{year}', year);
          try {
            const resp = await f(url);
            if (resp && resp.ok) {
              const data = await resp.json();
              for (const d of (data.days || [])) {
                records.set(d.date, { off: d.isOffDay === true, name: d.name ?? null });
              }
              rows.push({ year: +year, ok: true, mode: 'authoritative', source: `holiday-cn via ${new URL(url).host}` });
              logs.push(`[CN ${year}] via ${new URL(url).host}`);
              return;
            }
          } catch (e) { /* 换下一个镜像 */ }
        }
        rows.push({ year: +year, ok: false, mode: 'fallback', source: 'all mirrors failed → weekend-only' });
        logs.push(`[CN ${year}] fetch FAILED -> weekend-only fallback ⚠️`);
      }));
      return { rows, logs };
    },

    /** 三态: true=法定放假 / false=调休补班上班 / undefined=无记录(调用方按周末兜底) */
    lookup(dateStr) {
      const r = records.get(dateStr);
      return r === undefined ? undefined : r.off;
    },

    /** 仅"明确放假"(不含补班) —— 对齐统一 provider 接口 */
    isOffDay(dateStr) {
      const r = records.get(dateStr);
      return r ? r.off === true : false;
    },

    /** 事实层记录。注意:补班日在两种 kind 下的 fact 相同(isMakeup:true),结论层才分岔 */
    fact(dateStr) {
      const r = records.get(dateStr);
      if (!r) return null;
      return { isHoliday: r.off, isMakeup: !r.off, name: r.name, observed: false, nominalDate: null };
    },

    /** legacy 形状: [{date, isOffDay, name}] 按日期升序 —— 与 holiday-cn 的 days[] 同形,专供 alarm-api 零改造迁移 */
    days() {
      return [...records.entries()]
        .map(([date, r]) => ({ date, isOffDay: r.off, name: r.name }))
        .sort((a, b) => (a.date < b.date ? -1 : 1));
    }
  };
}
