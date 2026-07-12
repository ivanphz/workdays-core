// ==============================================================================
// 📐 src/schema.js — 数据文件规范 v2(schema: 2)的常量与条目归一化(全库唯一一处)
// ==============================================================================
// 完整规范(字段表 / AI 生成手册 / 自检清单)见 docs/DATA-FORMAT.md,本文件是其代码化。
// 被 providers(读取端)与 scripts/refresh-data.mjs(写入端)共用,读写同源。

export const SCHEMA_VERSION = 2;

/**
 * 条目归一化:把任意历史形态的"某一天"统一成 schema 2 条目
 *   { names: {lang: name}, observed: boolean, ...其余键原样保留(预留字段,读取方忽略未知键) }
 * 容忍的输入形态:
 *   · schema 2:   { names: {...}, observed?, ... }        → 原样(补 observed 默认 false)
 *   · v2.2 字符串: "假期名"                                 → { names: { [legacyLang]: 名 } }
 *   · v2.2 GB 型: { name: "...", observed: bool }          → { names: { [legacyLang]: 名 }, observed }
 *   · null/无名:                                           → { names: {}, observed: false }
 * legacyLang = 该数据集旧格式的已知语言(HK 种子=sc,GB/SG=en),由各 provider 声明。
 */
export function normalizeDayEntry(raw, legacyLang = 'en') {
  if (raw == null) return { names: {}, observed: false };
  if (typeof raw === 'string') return { names: { [legacyLang]: raw }, observed: false };
  if (typeof raw === 'object') {
    if (raw.names && typeof raw.names === 'object') {
      return { observed: false, ...raw, names: { ...raw.names } };
    }
    // v2.2 GB 型 { name, observed }
    const { name, ...rest } = raw;
    return { observed: false, ...rest, names: name != null ? { [legacyLang]: name } : {} };
  }
  return { names: {}, observed: false };
}

/** 语言键的确定性排序:铁律序在前(sc>tc>en),其余字母序 —— 序列化与展示共用 */
export function sortLangKeys(names) {
  const pri = ['sc', 'tc', 'en'];
  return Object.keys(names).sort((a, b) => {
    const ia = pri.indexOf(a), ib = pri.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a < b ? -1 : 1;
  });
}

/** 条目 → 确定性 JSON 片段(逐条一行用;names 键序稳定,已知键序固定,未知键字母序保留) */
export function dayEntryJson(entry) {
  const e = normalizeDayEntry(entry);
  const parts = [];
  const namesParts = sortLangKeys(e.names).map(l => `${JSON.stringify(l)}: ${JSON.stringify(e.names[l])}`);
  parts.push(`"names": { ${namesParts.join(', ')} }`);
  parts.push(`"observed": ${e.observed === true}`);
  for (const k of Object.keys(e).filter(k => k !== 'names' && k !== 'observed').sort()) {
    parts.push(`${JSON.stringify(k)}: ${JSON.stringify(e[k])}`);
  }
  return `{ ${parts.join(', ')} }`;
}
