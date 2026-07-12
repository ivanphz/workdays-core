// ==========================================
// 🇺🇸 providers/us.js — 美国联邦/银行假期(数据集 'US',纯算法、零联网)
// ==========================================
// 为什么算法生成而不抓 ics(沿袭原实现的结论):
//   1. 联邦假期是纯规则 —— 固定日期(7/4)或"某月第N个星期几"(感恩节),不含农历,
//      完全可离线推算,不存在"源挂了降级"的问题。
//   2. 银行/ACH 清算只认这 11 个联邦假期;网上 ics 混入情人节/万圣节等民间节日,
//      拿来判工作日会大量误伤。
// observed(观察日)规则: 假期落周六 → 前移周五休;落周日 → 后移周一休。银行按 observed 休。
// 与原 us.js 的日期集合【逐日等价】(有测试钉死);增强点是每个日期带上
// { name, observed, nominalDate } 事实元数据 —— 提前量计算/提醒文案需要知道
// "这天休的其实是哪个节、名义日期是哪天"。
//
// ⚠️ 跨年边界(沿袭原行为): "次年元旦落周六 → 本年 12/31 休"这条 observed 记录,
//    由【加载次年】产生。窗口跨年时把两个年份都传给 createHolidayHub 即可
//    (reminder-hub 现有调用方式天然满足)。

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

function applyObservedRule(dateUtc) {
  const dow = dateUtc.getUTCDay();
  const shifted = new Date(dateUtc.getTime());
  if (dow === 6) shifted.setUTCDate(shifted.getUTCDate() - 1);      // 周六 -> 周五
  else if (dow === 0) shifted.setUTCDate(shifted.getUTCDate() + 1); // 周日 -> 周一
  return shifted;
}

function toDateStr(dateUtc) {
  const pad = n => ('0' + n).slice(-2);
  return `${dateUtc.getUTCFullYear()}-${pad(dateUtc.getUTCMonth() + 1)}-${pad(dateUtc.getUTCDate())}`;
}

/** 生成某年全部联邦假期记录: [{date, name, observed, nominalDate}] */
function usFederalRecords(year) {
  const out = [];
  // 固定日期类: 名义日 + observed 日都标休(名义日很多机构也关,两天都算 = 还款判定安全侧;与原实现一致)
  const addFixed = (month0, day, name) => {
    const real = new Date(Date.UTC(year, month0, day));
    const realStr = toDateStr(real);
    out.push({ date: realStr, name, observed: false, nominalDate: null });
    const obsStr = toDateStr(applyObservedRule(real));
    if (obsStr !== realStr) out.push({ date: obsStr, name, observed: true, nominalDate: realStr });
  };
  const addFloating = (dateUtc, name) => out.push({ date: toDateStr(dateUtc), name, observed: false, nominalDate: null });

  addFixed(0, 1, "New Year's Day");                                        // 1/1
  addFloating(nthWeekdayOfMonth(year, 0, 1, 3), 'Martin Luther King Jr. Day'); // 1月第3个周一
  addFloating(nthWeekdayOfMonth(year, 1, 1, 3), "Presidents' Day");            // 2月第3个周一
  addFloating(lastWeekdayOfMonth(year, 4, 1), 'Memorial Day');                 // 5月最后一个周一
  addFixed(5, 19, 'Juneteenth');                                           // 6/19
  addFixed(6, 4, 'Independence Day');                                      // 7/4
  addFloating(nthWeekdayOfMonth(year, 8, 1, 1), 'Labor Day');                  // 9月第1个周一
  addFloating(nthWeekdayOfMonth(year, 9, 1, 2), 'Columbus Day');               // 10月第2个周一
  addFixed(10, 11, 'Veterans Day');                                        // 11/11
  addFloating(nthWeekdayOfMonth(year, 10, 4, 4), 'Thanksgiving');              // 11月第4个周四
  addFixed(11, 25, 'Christmas Day');                                       // 12/25

  return out;
}

export function createUsProvider() {
  // date -> record;冲突时保留非 observed 记录(真实节日优先于顺延身份)
  const records = new Map();

  return {
    dataset: 'US',
    officialLangs: ['en'], // 算法生成的名称即官方英文;简中/繁中译名走 translations.js

    async load(years) {
      for (const y of years) {
        for (const rec of usFederalRecords(+y)) {
          const exist = records.get(rec.date);
          if (!exist || (exist.observed && !rec.observed)) records.set(rec.date, rec);
        }
      }
      const rows = years.map(y => ({ year: +y, ok: true, mode: 'computed', source: 'algorithm(US federal)' }));
      return { rows, logs: ['[US] algorithm(US federal)'] };
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
