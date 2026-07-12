// ==============================================================================
// 🔄 scripts/refresh-data.mjs — 假期数据刷新流水线(CI 联网运行,不进 npm 包)
// ==============================================================================
// 职责: 调 src/sources.js 抓上游 → 再生成 src/data/*.data.js。由
// .github/workflows/refresh-data.yml 每日调用;数据无变化时不落盘(不触发发版)。
// 抓取与解析逻辑全部住在 src/sources.js(与 providers 的 online 模式共用,单点修改);
// 本文件只负责【归档编排】: 合并语义 + 确定性序列化 + 落盘判断。
//
// 【归档铁律】只增不删,永不缩水:
//   · CN: 逐年抓;某年失败/404/空壳 → 保留归档既有;成功 → 该年整体替换(修正案要能覆盖)。
//   · HK: feed 是滚动窗口(今明两年),按日期逐条合并,历史日期永久保留 —— 本仓库即唯一存档。
//   · GB: gov.uk 多年滚动窗口,同 HK 逐条合并(按三分治域)。
//   · SG: 按年数据集可能下架,同 HK 逐条合并。
//
// 【确定性序列化】逐条一行、键序稳定,git diff 精确到"哪一天变了";
//   generatedAt 只在数据真变时更新,避免每日空转提交。
// 【schema 2 迁移】读取端对旧格式(v2.2 字符串 / {name,observed})容错归一
//   (src/schema.js 单一处),首刷自动把归档改写成 schema 2 —— 无需人工迁移数据文件。
// 【多语合并】HK 三语皆官方,按 日期×语言 粒度只增不删(某语言某天缺失不影响其它语言)。
// ==============================================================================

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchCnYear, fetchHkTrilingual, fetchGbDivisions, fetchSgDays } from '../src/sources.js';
import { SCHEMA_VERSION, normalizeDayEntry, dayEntryJson, sortLangKeys } from '../src/schema.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CN_YEAR_START = 2007; // holiday-cn 数据起点

// ── 确定性序列化(初版/种子数据也由同一函数生成,保证首刷不产生虚假 diff) ────────
function fileHead(comments) {
  return ['// 自动生成,勿手改。由 scripts/refresh-data.mjs 维护(每日流水线)。', ...comments];
}

export function serializeCnData(years, generatedAt) {
  const yearKeys = Object.keys(years).map(Number).sort((a, b) => a - b);
  const lines = fileHead([
    '// 数据源: NateScarlet/holiday-cn(国务院公告的机器可读版,简中官方)。',
    '// 语义: isOffDay=true 法定放假 / isOffDay=false 调休补班上班。规范见 docs/DATA-FORMAT.md(三态型)。'
  ]);
  lines.push('export const CN_DATA = {');
  lines.push(`  schema: ${SCHEMA_VERSION},`);
  lines.push('  source: "NateScarlet/holiday-cn",');
  lines.push(`  generatedAt: ${JSON.stringify(generatedAt)},`);
  lines.push('  officialLangs: ["sc"],');
  lines.push('  tz: "Asia/Shanghai",');
  lines.push('  ext: {},');
  lines.push('  years: {');
  for (const y of yearKeys) {
    lines.push(`    "${y}": [`);
    for (const d of years[y]) {
      const names = d.names && typeof d.names === 'object' ? d.names : (d.name != null ? { sc: d.name } : {});
      const namesParts = sortLangKeys(names).map(l => `${JSON.stringify(l)}: ${JSON.stringify(names[l])}`);
      lines.push(`      { "date": ${JSON.stringify(d.date)}, "isOffDay": ${d.isOffDay === true}, "names": { ${namesParts.join(', ')} } },`);
    }
    lines.push('    ],');
  }
  lines.push('  }');
  lines.push('};');
  return lines.join('\n') + '\n';
}

function serializeListing(varName, meta, days, generatedAt) {
  const lines = fileHead(meta.comments);
  lines.push(`export const ${varName} = {`);
  lines.push(`  schema: ${SCHEMA_VERSION},`);
  lines.push(`  source: ${JSON.stringify(meta.source)},`);
  lines.push(`  generatedAt: ${JSON.stringify(generatedAt)},`);
  lines.push(`  officialLangs: ${JSON.stringify(meta.officialLangs)},`);
  lines.push(`  tz: ${JSON.stringify(meta.tz)},`);
  lines.push('  ext: {},');
  lines.push('  days: {');
  for (const d of Object.keys(days).sort()) {
    lines.push(`    ${JSON.stringify(d)}: ${dayEntryJson(days[d])},`);
  }
  lines.push('  }');
  lines.push('};');
  return lines.join('\n') + '\n';
}

export function serializeHkData(days, generatedAt) {
  return serializeListing('HK_DATA', {
    comments: ['// 数据源: 香港政府 1823 官方(三语 sc/tc/en 皆官方,三语全收)。滚动窗口 → 只增不删归档。规范见 docs/DATA-FORMAT.md。'],
    source: '1823.gov.hk (sc/tc/en)', officialLangs: ['sc', 'tc', 'en'], tz: 'Asia/Hong_Kong'
  }, days, generatedAt);
}

export function serializeSgData(days, generatedAt) {
  return serializeListing('SG_DATA', {
    comments: ['// 数据源: data.gov.sg(新加坡人力部 MOM,官方仅英文)。含官方补假日,只增不删归档。规范见 docs/DATA-FORMAT.md。'],
    source: 'data.gov.sg (MOM)', officialLangs: ['en'], tz: 'Asia/Singapore'
  }, days, generatedAt);
}

export function serializeGbData(divisions, generatedAt) {
  const lines = fileHead([
    '// 数据源: gov.uk/bank-holidays.json(英国政府官方,三分治域;替代日 observed:true,官方仅英文)。规范见 docs/DATA-FORMAT.md(分域变体)。'
  ]);
  lines.push('export const GB_DATA = {');
  lines.push(`  schema: ${SCHEMA_VERSION},`);
  lines.push('  source: "gov.uk/bank-holidays.json",');
  lines.push(`  generatedAt: ${JSON.stringify(generatedAt)},`);
  lines.push('  officialLangs: ["en"],');
  lines.push('  tz: "Europe/London",');
  lines.push('  ext: {},');
  lines.push('  divisions: {');
  for (const div of ['eaw', 'sct', 'nir']) {
    lines.push(`    "${div}": {`);
    for (const d of Object.keys(divisions[div] || {}).sort()) {
      lines.push(`      ${JSON.stringify(d)}: ${dayEntryJson(divisions[div][d])},`);
    }
    lines.push('    },');
  }
  lines.push('  }');
  lines.push('};');
  return lines.join('\n') + '\n';
}

/** 数据体指纹(不含 generatedAt),用于"真变了才落盘" */
const fingerprint = (obj) => JSON.stringify(obj);

// ── 主流程 ───────────────────────────────────────────────────────────────────
async function main() {
  const generatedAt = new Date().toISOString();
  let changed = 0;

  // CN: 既有归档打底,抓到的年份整体替换,抓不到的保留
  const { CN_DATA } = await import('../src/data/cn.data.js');
  // 读取归一: 旧格式 {name} → {names:{sc}}(schema.js 单一处逻辑的 CN 三态变体)
  const cnYears = {};
  for (const [y, list] of Object.entries(CN_DATA.years || {})) {
    cnYears[y] = list.map(d => ({
      date: d.date, isOffDay: d.isOffDay === true,
      names: d.names && typeof d.names === 'object' ? { ...d.names } : (d.name != null ? { sc: d.name } : {})
    }));
  }
  const endYear = new Date().getUTCFullYear() + 2;
  for (let y = CN_YEAR_START; y <= endYear; y++) {
    const fetched = await fetchCnYear(y);
    if (fetched) cnYears[y] = fetched;
    else if (!cnYears[y]) console.log(`[CN ${y}] 上游无数据(未公告或抓取失败),跳过`);
  }
  if (fingerprint(cnYears) !== fingerprint(CN_DATA.years)) {
    writeFileSync(join(ROOT, 'src/data/cn.data.js'), serializeCnData(cnYears, generatedAt));
    console.log('[CN] 归档已更新');
    changed++;
  } else {
    console.log('[CN] 无变化');
  }

  // HK: 三语全收,按 日期×语言 粒度只增不删(某语言窗口内的新值覆盖同语言旧值)
  const { HK_DATA } = await import('../src/data/hk.data.js');
  const hkDays = {};
  for (const [d, e] of Object.entries(HK_DATA.days || {})) hkDays[d] = normalizeDayEntry(e, 'sc');
  const fetchedHk = await fetchHkTrilingual();
  if (fetchedHk) {
    for (const [date, entry] of Object.entries(fetchedHk)) {
      const cur = hkDays[date];
      hkDays[date] = cur
        ? { ...cur, names: { ...cur.names, ...entry.names } }
        : normalizeDayEntry(entry, 'sc');
    }
  } else {
    console.log('[HK] 抓取失败,保留既有归档');
  }
  if (fingerprint(hkDays) !== fingerprint(HK_DATA.days)) {
    writeFileSync(join(ROOT, 'src/data/hk.data.js'), serializeHkData(hkDays, generatedAt));
    console.log('[HK] 归档已更新');
    changed++;
  } else {
    console.log('[HK] 无变化');
  }

  // GB: 三分治域逐条合并,只增不删
  const { GB_DATA } = await import('../src/data/gb.data.js');
  const gbDivisions = { eaw: {}, sct: {}, nir: {} };
  for (const div of ['eaw', 'sct', 'nir']) {
    for (const [d, e] of Object.entries(GB_DATA.divisions?.[div] || {})) gbDivisions[div][d] = normalizeDayEntry(e, 'en');
  }
  const fetchedGb = await fetchGbDivisions();
  if (fetchedGb) {
    for (const div of ['eaw', 'sct', 'nir']) {
      for (const [date, rec] of Object.entries(fetchedGb[div])) {
        const norm = normalizeDayEntry(rec, 'en');
        const cur = gbDivisions[div][date];
        gbDivisions[div][date] = cur ? { ...cur, ...norm, names: { ...cur.names, ...norm.names } } : norm;
      }
    }
  } else {
    console.log('[GB] 抓取失败,保留既有归档');
  }
  if (fingerprint(gbDivisions) !== fingerprint(GB_DATA.divisions)) {
    writeFileSync(join(ROOT, 'src/data/gb.data.js'), serializeGbData(gbDivisions, generatedAt));
    console.log('[GB] 归档已更新');
    changed++;
  } else {
    console.log('[GB] 无变化');
  }

  // SG: 逐条合并,只增不删
  const { SG_DATA } = await import('../src/data/sg.data.js');
  const sgDays = {};
  for (const [d, e] of Object.entries(SG_DATA.days || {})) sgDays[d] = normalizeDayEntry(e, 'en');
  const fetchedSg = await fetchSgDays();
  if (fetchedSg) {
    for (const [date, name] of Object.entries(fetchedSg)) {
      const norm = normalizeDayEntry(name, 'en');
      const cur = sgDays[date];
      sgDays[date] = cur ? { ...cur, ...norm, names: { ...cur.names, ...norm.names } } : norm;
    }
  } else {
    console.log('[SG] 抓取失败,保留既有归档');
  }
  if (fingerprint(sgDays) !== fingerprint(SG_DATA.days)) {
    writeFileSync(join(ROOT, 'src/data/sg.data.js'), serializeSgData(sgDays, generatedAt));
    console.log('[SG] 归档已更新');
    changed++;
  } else {
    console.log('[SG] 无变化');
  }

  console.log(changed ? `完成:${changed} 个数据模块有更新` : '完成:数据无变化,未落盘');
}

// 仅作为脚本直跑时执行 main;被 test/ 或种子脚本 import 序列化函数时不执行
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e); process.exit(1); });
}
