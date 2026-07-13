// 🇨🇳 CN fetcher — holiday-cn 三镜像,逐年抓;返回 {year: [schema2 entries]} | null。
// 契约: async fetch(fetchImpl) → { <按年或按日期的活数据> } | null;失败返 null,绝不抛错。
const MIRRORS = [
  'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json',
  'https://fastly.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json',
  'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/{year}.json'
];

async function fetchYear(year, f) {
  for (const tpl of MIRRORS) {
    try {
      const resp = await f(tpl.replace('{year}', year));
      if (resp && resp.ok) {
        const data = await resp.json();
        const days = (data.days || []).map(d => ({ date: d.date, isOffDay: d.isOffDay === true, names: d.name != null ? { sc: d.name } : {} }));
        return days.length > 0 ? days : null;
      }
    } catch (e) { /* 下一个镜像 */ }
  }
  return null;
}

/** @param years 需要的年份数组(流水线传全范围;在线模式传当前窗口) */
export async function fetchCn(fetchImpl, years) {
  const f = fetchImpl || globalThis.fetch;
  const now = new Date().getUTCFullYear();
  const list = years && years.length ? years : Array.from({ length: now + 2 - 2007 + 1 }, (_, i) => 2007 + i);
  const out = {};
  for (const y of list) {
    const days = await fetchYear(y, f);
    if (days) out[y] = days;
  }
  return Object.keys(out).length ? out : null;
}
