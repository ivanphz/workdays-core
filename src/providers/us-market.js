// ==========================================
// 🇺🇸📈 providers/us-market.js — NYSE/Nasdaq 交易日历(数据集 'US-NYSE',纯算法、零联网)
// ==========================================
// 供 US:market 口径使用。与 us.js(银行/联邦)是两份不同日历,双向都有差异:
//   · NYSE 多休: Good Friday(复活节前周五) —— 非联邦假日,银行照常营业
//   · NYSE 少休: Columbus Day、Veterans Day 正常开市 —— 联邦假日,银行休
// NYSE observed 规则(与联邦不同):
//   · 假日落周日 → 次周一休市
//   · 假日落周六 → 前一个周五休市;【唯一例外】实务上只命中"元旦落周六":
//     前一日 12/31 是当月最后交易日 → 照常开市,不补休。
// 半日市(感恩节次日、平安夜等提前收盘)仍是开市日,不标记 → 判定为工作日。
// 复活节用 Anonymous Gregorian/Computus 算法离线推算,数据零依赖。
//
// ⚠️ 用途边界: 本日历回答"NYSE 这天开不开市"。【还款/转账请继续用 US(bank)】——
//    market 会把银行休息的 Columbus/Veterans 判为工作日,用于还款会踩空。
//    正因双向不同,US 刻意不提供全局默认口径切换,'US:market' 只允许条目级显式声明。
// 与原 us-market.js 的日期集合【逐日等价】(含 ±1 年冗余扩展,有测试钉死);
// 增强点同 us.js: 每个日期带 { name, observed, nominalDate }。

function nthWeekdayOfMonth(year, month0, weekday, n) {
  const first = new Date(Date.UTC(year, month0, 1));
  const firstDow = first.getUTCDay();
  const day = 1 + ((weekday - firstDow + 7) % 7) + (n - 1) * 7;
  return new Date(Date.UTC(year, month0, day));
}

function lastWeekdayOfMonth(year, month0, weekday) {
  const last = new Date(Date.UTC(year, month0 + 1, 0));
  const lastDow = last.getUTCDay();
  const day = last.getUTCDate() - ((lastDow - weekday + 7) % 7);
  return new Date(Date.UTC(year, month0, day));
}

/** 复活节(格里历,Anonymous/Computus 算法) → 当年复活节周日的 UTC 日期 */
function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month0 = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month0, day));
}

function toDateStr(dateUtc) {
  const pad = n => ('0' + n).slice(-2);
  return `${dateUtc.getUTCFullYear()}-${pad(dateUtc.getUTCMonth() + 1)}-${pad(dateUtc.getUTCDate())}`;
}

/** 生成某年 NYSE 全日休市记录: [{date, name, observed, nominalDate}] */
function nyseRecords(year) {
  const out = [];

  // 固定日期类: 按 NYSE observed 规则平移;isNewYear 标记元旦例外
  const addFixedNyse = (month0, day, name, isNewYear = false) => {
    const real = new Date(Date.UTC(year, month0, day));
    const realStr = toDateStr(real);
    out.push({ date: realStr, name, observed: false, nominalDate: null }); // 名义日若在周末本就非交易日,标了无害(与原实现一致)
    const dow = real.getUTCDay();
    if (dow === 0) {                                 // 周日 → 周一补休
      const mon = new Date(real.getTime()); mon.setUTCDate(mon.getUTCDate() + 1);
      out.push({ date: toDateStr(mon), name, observed: true, nominalDate: realStr });
    } else if (dow === 6 && !isNewYear) {            // 周六 → 周五补休;元旦例外(12/31 照常开市)
      const fri = new Date(real.getTime()); fri.setUTCDate(fri.getUTCDate() - 1);
      out.push({ date: toDateStr(fri), name, observed: true, nominalDate: realStr });
    }
  };
  const addFloating = (dateUtc, name) => out.push({ date: toDateStr(dateUtc), name, observed: false, nominalDate: null });

  addFixedNyse(0, 1, "New Year's Day", /* isNewYear */ true);
  addFloating(nthWeekdayOfMonth(year, 0, 1, 3), 'Martin Luther King Jr. Day');
  addFloating(nthWeekdayOfMonth(year, 1, 1, 3), "Washington's Birthday");
  const easter = easterSunday(year);
  const goodFriday = new Date(easter.getTime()); goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  addFloating(goodFriday, 'Good Friday');
  addFloating(lastWeekdayOfMonth(year, 4, 1), 'Memorial Day');
  addFixedNyse(5, 19, 'Juneteenth');
  addFixedNyse(6, 4, 'Independence Day');
  addFloating(nthWeekdayOfMonth(year, 8, 1, 1), 'Labor Day');
  addFloating(nthWeekdayOfMonth(year, 10, 4, 4), 'Thanksgiving');
  addFixedNyse(11, 25, 'Christmas Day');
  // 注意: 不含 Columbus Day / Veterans Day —— NYSE 这两天开市(银行休)。

  return out;
}

export function createUsMarketProvider() {
  const records = new Map();

  return {
    dataset: 'US-NYSE',
    officialLangs: ['en'], // 算法生成的名称即官方英文;简中/繁中译名走 translations.js

    async load(years) {
      // 多算前后一年,覆盖跨年平移的窗口边界(与原实现一致,成本为零)
      const expand = new Set(years.flatMap(y => [+y - 1, +y, +y + 1]));
      for (const y of expand) {
        for (const rec of nyseRecords(y)) {
          const exist = records.get(rec.date);
          if (!exist || (exist.observed && !rec.observed)) records.set(rec.date, rec);
        }
      }
      const rows = years.map(y => ({ year: +y, ok: true, mode: 'computed', source: 'algorithm(NYSE market)' }));
      return { rows, logs: ['[US-NYSE] algorithm(NYSE market)'] };
    },

    isOffDay(dateStr) {
      return records.has(dateStr);
    },

    fact(dateStr) {
      const r = records.get(dateStr);
      if (!r) return null;
      return { isHoliday: true, isMakeup: false, names: r.name != null ? { en: r.name } : {}, observed: r.observed, nominalDate: r.nominalDate };
    },

    days() {
      return [...records.values()]
        .map(r => ({ date: r.date, isOffDay: true, names: r.name != null ? { en: r.name } : {}, observed: r.observed }))
        .sort((a, b) => (a.date < b.date ? -1 : 1));
    }
  };
}
