// ==============================================================================
// 🌏 src/i18n.js — 名称的多语合并与解析(全库唯一一处)
// ==============================================================================
// 两层数据:
//   · 归档 names(机器领地): 只含【官方发布】的语言版本,谁是官方由数据文件的
//     officialLangs 数组声明(可以多个 —— 香港 sc/tc/en 三语皆官方)。
//   · 译名表(人的领地,本文件下方 TRANSLATIONS 或 src/data/translations.js):
//     人工/AI 维护的准确对应翻译,方便本地人阅读。
// 【标记规则】消费方判定一个语言值是官方还是译名,只看一条: lang ∈ officialLangs ?
//   官方 : 译名。合并时同键冲突【官方值必胜】。
// 【解析回落链】opts.lang → sc → tc → en → 首个官方语言 → 任意首个。

import { TRANSLATIONS } from './data/translations.js';

/**
 * 归档官方名 ∪ 译名 → 完整 names 对象(官方值覆盖同键译名)。
 * 译名匹配键 = 官方名字符串精确匹配(先按 officialLangs 顺序试,再试任意值)。
 */
export function mergeNames(region, names = {}, officialLangs = []) {
  const table = TRANSLATIONS[region] || {};
  let tr = null;
  for (const l of officialLangs) {
    const n = names[l];
    if (n != null && table[n]) { tr = table[n]; break; }
  }
  if (!tr) {
    for (const n of Object.values(names)) {
      if (n != null && table[n]) { tr = table[n]; break; }
    }
  }
  return tr ? { ...tr, ...names } : { ...names };
}

/** 按语言解析出单一名称字符串(fact.name / listDays.name / ICS SUMMARY 共用) */
export function pickName(names = {}, lang = null, officialLangs = []) {
  const chain = [lang, 'sc', 'tc', 'en', ...officialLangs].filter(Boolean);
  for (const l of chain) {
    if (names[l] != null) return names[l];
  }
  const rest = Object.values(names).filter(v => v != null);
  return rest.length ? rest[0] : null;
}
