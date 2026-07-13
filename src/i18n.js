// ==============================================================================
// 🌏 src/i18n.js — 名称多语合并与解析(译名表由数据集清单动态汇集)
// ==============================================================================
// v3 起译名从各 datasets/<code>/translations.js 汇集(index.js 构建后注入),
// 不再有中心 translations 文件 —— 一国译名随其文件夹走,解耦。
// 【标记规则】判官方/译名只看 lang ∈ officialLangs。合并同键官方值必胜。
// 【回落链】opts.lang → sc → tc → en → 首个官方语言 → 任意首个。

let TRANSLATIONS = {}; // { REGION: { 官方名: { lang: 译名 } } }

export function buildTranslations(manifests) {
  TRANSLATIONS = {};
  for (const m of Object.values(manifests)) {
    if (!m.translations) continue;
    for (const r of m.regions) {
      TRANSLATIONS[r.region] = { ...(TRANSLATIONS[r.region] || {}), ...m.translations };
    }
  }
}

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

export function pickName(names = {}, lang = null, officialLangs = []) {
  const chain = [lang, 'sc', 'tc', 'en', ...officialLangs].filter(Boolean);
  for (const l of chain) if (names[l] != null) return names[l];
  const rest = Object.values(names).filter(v => v != null);
  return rest.length ? rest[0] : null;
}
