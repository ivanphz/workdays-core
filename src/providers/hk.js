// ==========================================
// 🇭🇰 providers/hk.js — 香港公众假期(数据集 'HK')
// ==========================================
// 数据源: 香港政府 1823 官方 ics。为什么用它而不用苹果 HK_zh.ics(沿袭原实现的结论):
//   香港假期含农历(春节/清明/端午/中秋/重阳),无法纯算法生成,必须靠数据源;
//   1823 源每条都是真正法定公众假期、逐年展开、无 RRULE,干净可靠;
//   苹果源混入节气(银行照常上班)且带 RRULE,解析复杂易误判。
// URL 硬编码;直连官方 + 只读代理兜底。
//
// 与 reminder-hub 原 hk.js 的差异(刻意增强,行为超集):
//   · 按 VEVENT 块解析,同时抽取 SUMMARY 作为假期名(fact.name 需要);
//     解析前先做 ICS 行反折叠(RFC5545 折行 = CRLF + 一个空白)。
//   · 块解析一无所获时回退到原版"整文扫 DTSTART"正则 —— 健壮性只增不减。
//   · coverage 精确到年:政府源一般只覆盖今明两年,请求超范围的年份会如实报 fallback。

const HK_HOLIDAY_URLS = [
  'https://www.1823.gov.hk/common/ical/en.ics',
  'https://r.jina.ai/https://www.1823.gov.hk/common/ical/en.ics' // 只读代理兜底
];

/** RFC5545 反折叠: 行首空白的续行并回上一行 */
function unfold(text) {
  return String(text).replace(/\r?\n[ \t]/g, '');
}

/** 解析 ics → Map<'YYYY-MM-DD', name|null> */
function parseHkIcs(icsText) {
  const map = new Map();
  const t = unfold(icsText);

  for (const block of t.split(/BEGIN:VEVENT/).slice(1)) {
    const dm = /DTSTART[^:\r\n]*:(\d{8})/.exec(block);
    if (!dm) continue;
    const raw = dm[1];
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    const sm = /SUMMARY[^:\r\n]*:([^\r\n]*)/.exec(block);
    const name = sm ? sm[1].trim() || null : null;
    if (!map.has(date)) map.set(date, name);
  }

  // 兜底: 万一源格式怪异导致块解析全空,退回原版整文扫描(只有日期、无名称)
  if (map.size === 0) {
    const re = /DTSTART[^:\r\n]*:(\d{8})/g;
    let m;
    while ((m = re.exec(t)) !== null) {
      const raw = m[1];
      map.set(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`, null);
    }
  }
  return map;
}

export function createHkProvider() {
  // date -> name|null
  const holidays = new Map();

  return {
    dataset: 'HK',

    async load(years, { fetchImpl } = {}) {
      const f = fetchImpl || globalThis.fetch;
      const rows = [], logs = [];
      let fetchedHost = null;

      // 政府 ics 一份含多年数据,只拉一次;years 用于逐年判定覆盖度
      for (const url of HK_HOLIDAY_URLS) {
        try {
          const resp = await f(url);
          if (resp && resp.ok) {
            const parsed = parseHkIcs(await resp.text());
            if (parsed.size > 0) {
              for (const [d, name] of parsed) holidays.set(d, name);
              fetchedHost = new URL(url).host;
              break;
            }
          }
        } catch (e) { /* 尝试下一个入口 */ }
      }

      if (!fetchedHost) {
        for (const y of years) rows.push({ year: +y, ok: false, mode: 'fallback', source: 'HK fetch failed → weekend-only' });
        logs.push('[HK] fetch FAILED -> weekend-only fallback ⚠️');
        return { rows, logs };
      }

      // 逐年判定: 该年至少解析出 1 个假期 → 权威;否则(超出源覆盖范围) → 如实报 fallback
      for (const y of years) {
        const prefix = `${y}-`;
        const covered = [...holidays.keys()].some(d => d.startsWith(prefix));
        rows.push(covered
          ? { year: +y, ok: true, mode: 'authoritative', source: `1823.gov.hk via ${fetchedHost}` }
          : { year: +y, ok: false, mode: 'fallback', source: `1823.gov.hk feed does not cover ${y} → weekend-only` });
      }
      logs.push(`[HK] 1823.gov.hk via ${fetchedHost} (${holidays.size} days)`);
      return { rows, logs };
    },

    isOffDay(dateStr) {
      return holidays.has(dateStr);
    },

    fact(dateStr) {
      if (!holidays.has(dateStr)) return null;
      return { isHoliday: true, isMakeup: false, name: holidays.get(dateStr), observed: false, nominalDate: null };
    },

    days() {
      return [...holidays.entries()]
        .map(([date, name]) => ({ date, isOffDay: true, name }))
        .sort((a, b) => (a.date < b.date ? -1 : 1));
    }
  };
}
