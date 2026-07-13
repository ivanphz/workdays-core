// ==============================================================================
// 🗓 workdays-core — 多国工作日/假期"事实引擎"(库,不是服务)
// ==============================================================================
// v3 架构: 数据集插件化。一国 = 一个自包含 datasets/<code>/ 文件夹(清单+数据+provider
// +fetcher+译名),中心只【发现+容错装载】(src/datasets/_loader.js),坏的自动丢弃、
// 不影响其余(故障隔离)。加新国零改动中心代码 —— 详见 docs/DATASET-GUIDE.md。
//
// 四条铁律不变: ①库非服务(只出纯函数)②事实非结论(provider 吐事实,工作日由消费方按 kind 算)
// ③只装公共世界(私有日历不进本包)④region×kind 模型。
// 数据源双模式: opts.dataSource='bundled'(默认写死)|'online'(活抓,按年覆盖,失败退档)。
// 多语: opts.lang 定解析语言,缺省链 sc>tc>en>官方首语言(含译名,方便本地阅读)。
// 时区: hub.localDateOf(token,at?) 解跨时区"今天"碰撞。导出: exportJson/exportIcs。
// ==============================================================================

import { loadDatasets } from './datasets/_loader.js';
import {
  buildTokenTables, parseToken, resolveKind, datasetOf, getCanonical, getRegionMeta
} from './tokens.js';
import { buildTranslations, mergeNames, pickName } from './i18n.js';

export { parseToken, resolveKind };
export { exportJson, exportIcs } from './export.js';
export const CORE_PROTOCOL = 1;

// 清单缓存: 装载一次,后续 hub 复用(dataSource/lang 等运行期参数不影响装载)
let _loaded = null;
async function ensureLoaded() {
  if (!_loaded) {
    _loaded = await loadDatasets();
    buildTokenTables(_loaded.manifests);
    buildTranslations(_loaded.manifests);
  }
  return _loaded;
}

/** 供消费方读取地区元数据(代码/全称/时区);需先 createHolidayHub 过一次(或 await ensure) */
export async function getRegions() {
  await ensureLoaded();
  return getRegionMeta();
}

/** 显式装载数据集并构建 token 表（独立使用 parseToken 前调用；hub 会自动调用） */
export async function initDatasets() {
  await ensureLoaded();
}

function toDateParts(dateLike) {
  if (dateLike instanceof Date) {
    const pad = n => ('0' + n).slice(-2);
    return { dateStr: `${dateLike.getUTCFullYear()}-${pad(dateLike.getUTCMonth() + 1)}-${pad(dateLike.getUTCDate())}`, dow: dateLike.getUTCDay() };
  }
  const dateStr = String(dateLike).slice(0, 10);
  return { dateStr, dow: new Date(`${dateStr}T00:00:00Z`).getUTCDay() };
}

/**
 * @param tokens ['CHN','USA:market','HKG'] 决定装载哪些数据集
 * @param years  [2026,2027] 覆盖年份;跨年窗口两年都传
 * @param opts   { cnDefaultRule:'bank'|'market', dataSource:'bundled'|'online', lang, fetchImpl }
 */
export async function createHolidayHub(tokens = [], years = [], opts = {}) {
  const { manifests, errors } = await ensureLoaded();
  const CANONICAL = getCanonical();
  const REGION_META = getRegionMeta();
  const loadLogs = [...errors]; // 装载期数据集故障告警先入日志(故障隔离可见)
  const warned = new Set();
  const warnOnce = (m) => { if (!warned.has(m)) { warned.add(m); loadLogs.push(m); } };

  let cnDefaultRule = 'bank';
  if (opts.cnDefaultRule !== undefined) {
    if (CANONICAL.CN && CANONICAL.CN.kinds[opts.cnDefaultRule]) cnDefaultRule = opts.cnDefaultRule;
    else warnOnce(`[WARN] cnDefaultRule '${opts.cnDefaultRule}' 非法(bank|market)，按 bank`);
  }
  let dataSource = 'bundled';
  if (opts.dataSource !== undefined) {
    if (opts.dataSource === 'bundled' || opts.dataSource === 'online') dataSource = opts.dataSource;
    else warnOnce(`[WARN] dataSource '${opts.dataSource}' 非法(bundled|online)，按 bundled`);
  }
  const lang = typeof opts.lang === 'string' && opts.lang ? opts.lang : null;
  const yearList = [...new Set((years || []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);

  const coverage = [];
  const providers = {};       // datasetId → provider 实例
  const manifestOfDataset = {}; // datasetId → 所属 manifest(取 fetch/officialLangs)

  const resolveOne = (token) => {
    const p = parseToken(token);
    if (!p.known) { warnOnce(`[WARN] 地区 ${p.region} 无对应数据集，只按周末判断`); return { ...p, kind: null }; }
    if (p.kind === null && String(token).includes(':')) warnOnce(`[WARN] 未识别口径 '${token}'，按默认口径`);
    return { ...p, kind: resolveKind(p.region, p.kind, cnDefaultRule) };
  };

  // 需要哪些数据集
  const wantedDatasets = new Set();
  for (const t of (tokens || [])) {
    const p = resolveOne(t);
    if (p.known) { const ds = datasetOf(p.region, p.kind); if (ds) wantedDatasets.add(ds); }
  }

  // 实例化对应数据集的 providers(一个 manifest 可产多个 dataset,如 GB 三分域)
  for (const m of Object.values(manifests)) {
    const provs = m.createProviders();
    for (const [dsId, prov] of Object.entries(provs)) {
      if (wantedDatasets.has(dsId)) { providers[dsId] = prov; manifestOfDataset[dsId] = m; }
    }
  }

  // online: 调各数据集自己的 fetcher(容错;失败退档),把活数据注入对应 provider 的 load
  const liveByDataset = {};
  if (dataSource === 'online') {
    const fetchedManifests = new Set();
    for (const dsId of Object.keys(providers)) {
      const m = manifestOfDataset[dsId];
      if (!m || !m.fetch || fetchedManifests.has(m.code)) continue;
      fetchedManifests.add(m.code);
      try {
        const raw = await m.fetch(opts.fetchImpl, yearList);
        if (raw) {
          // fetch 可返回 {date:条目}(单 dataset)或 {datasetId:{date:条目}}(多 dataset)
          const isMulti = Object.keys(raw).every(k => providers[k] || /^[A-Z-]+$/.test(k));
          if (isMulti && Object.keys(raw).some(k => manifestOfDataset[k])) {
            for (const [dsId2, dd] of Object.entries(raw)) liveByDataset[dsId2] = dd;
          } else {
            const only = Object.keys(m.createProviders())[0];
            liveByDataset[only] = raw;
          }
          loadLogs.push(`[${m.code}] online:fetch 成功`);
        } else {
          loadLogs.push(`[${m.code}] online:fetch 失败/无数据,退用归档`);
        }
      } catch (e) {
        loadLogs.push(`[${m.code}] online:fetch 抛错,退用归档 → ${e.message}`);
      }
    }
  }

  // 加载 providers,汇总 coverage
  await Promise.all(Object.entries(providers).map(async ([dsId, p]) => {
    const ctx = { dataSource, fetchImpl: opts.fetchImpl };
    if (liveByDataset[dsId]) ctx.live = liveByDataset[dsId];
    const { rows, logs } = await p.load(yearList, ctx);
    const meta = manifestOfDataset[dsId];
    const regionMeta = meta.regions.find(r => Object.values(r.kinds).some(k => k.dataset === dsId));
    for (const r of rows) {
      coverage.push({ dataset: dsId, region: regionMeta ? regionMeta.region : dsId, kind: kindLabelOf(meta, dsId), ...r });
    }
    loadLogs.push(...logs);
  }));

  function kindLabelOf(m, dsId) {
    for (const r of m.regions) for (const [kind, spec] of Object.entries(r.kinds)) if (spec.dataset === dsId) {
      // 多 kind 共享一个 dataset(CN bank/market)→ 标 '*'
      const sharers = Object.values(r.kinds).filter(k => k.dataset === dsId).length;
      return sharers > 1 ? '*' : kind;
    }
    return '*';
  }

  const providerFor = (t) => {
    if (!t.known) return null;
    const ds = datasetOf(t.region, t.kind);
    const p = providers[ds];
    if (!p) warnOnce(`[WARN] 数据集 ${ds} 未在本 hub 加载（创建时未申报对应 token），按纯周末兜底`);
    return p || null;
  };

  const isWorkdayIn = (t, { dateStr, dow }) => {
    const weekend = dow !== 0 && dow !== 6;
    const p = providerFor(t);
    if (!p) return weekend;
    if (t.region === 'CN') {
      const v = p.lookup(dateStr);
      if (v === true) return false;
      if (v === false && t.kind !== 'market') return true;
      return weekend;
    }
    return p.isOffDay(dateStr) ? false : weekend;
  };

  return {
    loadLogs, coverage, cnDefaultRule, lang,

    makeWorkdayChecker(list) {
      const toks = ((list && list.length) ? list : ['CN']).map(resolveOne);
      return (dateLike) => { const parts = toDateParts(dateLike); return toks.every(t => isWorkdayIn(t, parts)); };
    },
    isWorkday(tokenOrList, dateLike) {
      const list = Array.isArray(tokenOrList) ? tokenOrList : [tokenOrList];
      return this.makeWorkdayChecker(list)(dateLike);
    },
    fact(token, dateStr) {
      const t = resolveOne(token);
      const p = providerFor(t);
      if (!p) return null;
      const f = p.fact(String(dateStr).slice(0, 10));
      if (!f) return null;
      const ol = p.officialLangs || [];
      const names = mergeNames(t.region, f.names, ol);
      return { date: String(dateStr).slice(0, 10), region: t.region, kind: t.kind, dataset: p.dataset, isHoliday: f.isHoliday, isMakeup: f.isMakeup, name: pickName(names, lang, ol), names, officialLangs: ol, observed: f.observed, nominalDate: f.nominalDate };
    },
    listDays(token) {
      const t = resolveOne(token);
      const p = providerFor(t);
      if (!p) return [];
      const ol = p.officialLangs || [];
      return p.days().map(d => ({ date: d.date, isOffDay: d.isOffDay, name: pickName(mergeNames(t.region, d.names, ol), lang, ol) }));
    },
    listDaysFull(token) {
      const t = resolveOne(token);
      const p = providerFor(t);
      if (!p) return [];
      const ol = p.officialLangs || [];
      return p.days().map(d => { const names = mergeNames(t.region, d.names, ol); return { date: d.date, isOffDay: d.isOffDay, observed: d.observed === true, name: pickName(names, lang, ol), names }; });
    },
    officialLangsOf(token) { const p = providerFor(resolveOne(token)); return p ? (p.officialLangs || []) : []; },
    localDateOf(token, at = new Date()) {
      const t = resolveOne(token);
      const tz = REGION_META[t.region]?.tz;
      if (!tz) return toDateParts(at instanceof Date ? at : new Date(at)).dateStr;
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at instanceof Date ? at : new Date(at));
    },
    isCovered(token, dateStr) {
      const t = resolveOne(token);
      if (!t.known) return false;
      const ds = datasetOf(t.region, t.kind);
      const year = Number(String(dateStr).slice(0, 4));
      const row = coverage.find(c => c.dataset === ds && c.year === year);
      return row ? row.ok : false;
    }
  };
}
