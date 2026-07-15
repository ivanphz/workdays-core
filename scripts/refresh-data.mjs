// ==============================================================================
// 🔄 scripts/refresh-data.mjs — 通用数据刷新流水线(遍历数据集,零单国逻辑)
// ==============================================================================
// v3: 中心脚本不再含任何单国抓取代码。它遍历所有数据集,调各自 index.js 的 fetch(),
// 把活数据按【只增不删】合并进各自 datasets/<code>/data.js。加新国 = 放文件夹,本脚本零改动。
// 某数据集 fetch 抛错/返回 null → 跳过该国,保留既有归档,不影响其它国(故障隔离)。
//
// 序列化函数(serializeXxData)保留导出,供各数据集的种子生成与本脚本共用;
// 规范见 docs/DATA-FORMAT.md,契约见 docs/DATASET-GUIDE.md。

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SCHEMA_VERSION, normalizeDayEntry, dayEntryJson, sortLangKeys } from '../src/schema.js';
import { loadDatasets } from '../src/datasets/_loader.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── 确定性序列化(种子与流水线共用;逐条一行,git diff 精确到天)────────────────
function fileHead(comments) {
  return ['// 自动生成,勿手改。由 scripts/refresh-data.mjs 维护(每日流水线)。', ...comments];
}
export function serializeCnData(years, generatedAt) {
  const yearKeys = Object.keys(years).map(Number).sort((a, b) => a - b);
  const lines = fileHead([
    '// 数据源: NateScarlet/holiday-cn(国务院公告的机器可读版,简中官方)。',
    '// 语义: isOffDay=true 法定放假 / isOffDay=false 调休补班上班。规范见 docs/DATA-FORMAT.md(三态型)。'
  ]);
  lines.push('export const CN_DATA = {', `  schema: ${SCHEMA_VERSION},`, '  source: "NateScarlet/holiday-cn",',
    `  generatedAt: ${JSON.stringify(generatedAt)},`, '  officialLangs: ["sc"],', '  tz: "Asia/Shanghai",', '  ext: {},', '  years: {');
  for (const y of yearKeys) {
    lines.push(`    "${y}": [`);
    for (const d of years[y]) {
      const names = d.names && typeof d.names === 'object' ? d.names : (d.name != null ? { sc: d.name } : {});
      const np = sortLangKeys(names).map(l => `${JSON.stringify(l)}: ${JSON.stringify(names[l])}`);
      lines.push(`      { "date": ${JSON.stringify(d.date)}, "isOffDay": ${d.isOffDay === true}, "names": { ${np.join(', ')} } },`);
    }
    lines.push('    ],');
  }
  lines.push('  }', '};');
  return lines.join('\n') + '\n';
}
function serializeListing(varName, meta, days, generatedAt) {
  const lines = fileHead(meta.comments);
  lines.push(`export const ${varName} = {`, `  schema: ${SCHEMA_VERSION},`, `  source: ${JSON.stringify(meta.source)},`,
    `  generatedAt: ${JSON.stringify(generatedAt)},`, `  officialLangs: ${JSON.stringify(meta.officialLangs)},`,
    `  tz: ${JSON.stringify(meta.tz)},`, '  ext: {},', '  days: {');
  for (const d of Object.keys(days).sort()) lines.push(`    ${JSON.stringify(d)}: ${dayEntryJson(days[d])},`);
  lines.push('  }', '};');
  return lines.join('\n') + '\n';
}
export function serializeHkData(days, generatedAt) {
  return serializeListing('HK_DATA', { comments: ['// 数据源: 香港政府 1823 官方(三语 sc/tc/en 皆官方,三语全收)。滚动窗口 → 只增不删归档。规范见 docs/DATA-FORMAT.md。'], source: '1823.gov.hk (sc/tc/en)', officialLangs: ['sc', 'tc', 'en'], tz: 'Asia/Hong_Kong' }, days, generatedAt);
}
export function serializeSgData(days, generatedAt) {
  return serializeListing('SG_DATA', { comments: ['// 数据源: data.gov.sg(新加坡人力部 MOM,官方仅英文)。含官方补假日,只增不删归档。规范见 docs/DATA-FORMAT.md。'], source: 'data.gov.sg (MOM)', officialLangs: ['en'], tz: 'Asia/Singapore' }, days, generatedAt);
}
export function serializeGbData(divisions, generatedAt) {
  const lines = fileHead(['// 数据源: gov.uk/bank-holidays.json(英国政府官方,三分治域;替代日 observed:true,官方仅英文)。规范见 docs/DATA-FORMAT.md(分域变体)。']);
  lines.push('export const GB_DATA = {', `  schema: ${SCHEMA_VERSION},`, '  source: "gov.uk/bank-holidays.json",',
    `  generatedAt: ${JSON.stringify(generatedAt)},`, '  officialLangs: ["en"],', '  tz: "Europe/London",', '  ext: {},', '  divisions: {');
  for (const div of ['eaw', 'sct', 'nir']) {
    lines.push(`    "${div}": {`);
    for (const d of Object.keys(divisions[div] || {}).sort()) lines.push(`      ${JSON.stringify(d)}: ${dayEntryJson(divisions[div][d])},`);
    lines.push('    },');
  }
  lines.push('  }', '};');
  return lines.join('\n') + '\n';
}

// 数据集 code → 该国 data.js 的写入器(序列化形制 + 合并策略)。加新国在此登记一行。
// merge(existing, fetched) → 合并后的数据体; serialize(body, ts) → 文件文本; path
const WRITERS = {
  cn: {
    path: 'src/datasets/cn/data.js',
    body: (data) => { const y = {}; for (const [yr, list] of Object.entries(data.years || {})) y[yr] = list.map(d => ({ date: d.date, isOffDay: d.isOffDay === true, names: d.names && typeof d.names === 'object' ? { ...d.names } : (d.name != null ? { sc: d.name } : {}) })); return y; },
    merge: (existing, fetched) => { const y = { ...existing }; if (fetched) for (const [yr, list] of Object.entries(fetched)) y[yr] = list; return y; }, // 整年替换
    serialize: (y, ts) => serializeCnData(y, ts)
  },
  hk: {
    path: 'src/datasets/hk/data.js',
    body: (data) => { const o = {}; for (const [d, e] of Object.entries(data.days || {})) o[d] = normalizeDayEntry(e, 'sc'); return o; },
    merge: (existing, fetched) => { const o = { ...existing }; if (fetched) for (const [d, e] of Object.entries(fetched)) { const cur = o[d]; o[d] = cur ? { ...cur, names: { ...cur.names, ...e.names } } : normalizeDayEntry(e, 'sc'); } return o; }, // 日期×语言只增不删
    serialize: (o, ts) => serializeHkData(o, ts)
  },
  sg: {
    path: 'src/datasets/sg/data.js',
    body: (data) => { const o = {}; for (const [d, e] of Object.entries(data.days || {})) o[d] = normalizeDayEntry(e, 'en'); return o; },
    merge: (existing, fetched) => { const o = { ...existing }; if (fetched) for (const [d, e] of Object.entries(fetched)) { const n = normalizeDayEntry(e, 'en'); const cur = o[d]; o[d] = cur ? { ...cur, ...n, names: { ...cur.names, ...n.names } } : n; } return o; },
    serialize: (o, ts) => serializeSgData(o, ts)
  },
  gb: {
    path: 'src/datasets/gb/data.js',
    body: (data) => { const D = { eaw: {}, sct: {}, nir: {} }; for (const div of ['eaw', 'sct', 'nir']) for (const [d, e] of Object.entries(data.divisions?.[div] || {})) D[div][d] = normalizeDayEntry(e, 'en'); return D; },
    merge: (existing, fetched) => { const D = { eaw: { ...existing.eaw }, sct: { ...existing.sct }, nir: { ...existing.nir } }; if (fetched) { const dsToDiv = { 'GB-EAW': 'eaw', 'GB-SCT': 'sct', 'GB-NIR': 'nir' }; for (const [dsId, days] of Object.entries(fetched)) { const div = dsToDiv[dsId]; if (!div) continue; for (const [d, e] of Object.entries(days)) { const n = normalizeDayEntry(e, 'en'); const cur = D[div][d]; D[div][d] = cur ? { ...cur, ...n, names: { ...cur.names, ...n.names } } : n; } } } return D; },
    serialize: (D, ts) => serializeGbData(D, ts)
  }
  // us: 算法型,无 WRITER(不参与刷新)
};

async function main() {
  const generatedAt = new Date().toISOString();
  const { manifests, errors } = await loadDatasets();
  for (const e of errors) console.log(e); // 坏数据集告警,继续处理其余
  let changed = 0;

  for (const [code, m] of Object.entries(manifests)) {
    const writer = WRITERS[code];
    if (!writer || !m.fetch) { console.log(`[${code}] 无 fetcher/writer(算法型或未登记),跳过`); continue; }
    // 读现有 data.js
    let existingData;
    try {
      const mod = await import(`../${writer.path}?t=${Date.now()}`);
      existingData = mod[Object.keys(mod).find(k => k.endsWith('_DATA'))];
    } catch (e) { console.log(`[${code}] 读取现有数据失败: ${e.message}`); continue; }
    const existingBody = writer.body(existingData);
    // 抓取(容错)
    let fetched = null;
    // 【年份范围归数据集自己定】流水线不传 years:各数据集的数据起点不同(CN 2007、HK/SG 2018),
    // 中心不该替各国拍板。按年源的 fetch 在 years 缺省时用自己的全量范围(见 DATASET-GUIDE §4);
    // 整份源(HK/GB)本就忽略此参数。在线模式才按需传窗口年份(那里只要当前几年,不要全量)。
    try { fetched = await m.fetch(); }
    catch (e) { console.log(`[${code}] fetch 抛错,保留既有归档 → ${e.message}`); }
    if (!fetched) console.log(`[${code}] fetch 无数据,保留既有归档`);
    // 合并 + 落盘判断
    const merged = writer.merge(existingBody, fetched);
    if (JSON.stringify(merged) !== JSON.stringify(existingBody)) {
      writeFileSync(join(ROOT, writer.path), writer.serialize(merged, generatedAt));
      console.log(`[${code}] 归档已更新`);
      changed++;
    } else {
      console.log(`[${code}] 无变化`);
    }
  }
  console.log(changed ? `完成:${changed} 个数据集有更新` : '完成:数据无变化,未落盘');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e); process.exit(1); });
}
