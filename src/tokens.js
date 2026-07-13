// ==============================================================================
// 🎫 tokens.js — region×kind 令牌解析(由数据集清单动态构建,不再硬编码国家表)
// ==============================================================================
// v3 起 CANONICAL / ALPHA3 / REGION_META / datasetOf 全部【从数据集清单派生】:
// 加新国 = 放一个 datasets/<code>/ 文件夹 + _loader REGISTRY 加一行,本文件零改动。
// buildTokenTables(manifests) 由 index.js 在 createHolidayHub 时调用一次,注入下方闭包。
//
// 【国家代码策略】输入接受 alpha-2 与 alpha-3(严格封闭双射,归一在 parseToken 单一入口);
// 内部 canonical 恒为 alpha-2;全称永不参与匹配,只作 REGION_META 输出信息。文档引导 alpha-3。
// 【词汇铁律】kind 一词一义无别名;非法口径 → null,hub 告警 + 默认口径。

let CANONICAL = {};      // { REGION: { defaultKind, kinds: {kind: kind} } }
let ALPHA3 = {};         // { CHN: 'CN', ... }
let REGION_META = {};    // { CN: { alpha2, alpha3, tz, names } }
let KIND_DATASET = {};   // { REGION: { kind: datasetId } }

/** 由已装载的数据集清单构建全部 token 表(index.js 调用) */
export function buildTokenTables(manifests) {
  CANONICAL = {}; ALPHA3 = {}; REGION_META = {}; KIND_DATASET = {};
  for (const m of Object.values(manifests)) {
    for (const r of m.regions) {
      const kinds = {};
      KIND_DATASET[r.region] = {};
      for (const [kind, spec] of Object.entries(r.kinds)) {
        kinds[kind] = kind;
        KIND_DATASET[r.region][kind] = spec.dataset;
      }
      CANONICAL[r.region] = { defaultKind: r.defaultKind, kinds };
      REGION_META[r.region] = { alpha2: r.region, alpha3: r.alpha3, tz: r.tz, names: r.names };
      if (r.alpha3) ALPHA3[r.alpha3.toUpperCase()] = r.region;
    }
  }
}

export function getCanonical() { return CANONICAL; }
export function getRegionMeta() { return REGION_META; }

/** token → { region, kind, known };alpha-3 归一为 alpha-2;非法 kind → null */
export function parseToken(token) {
  const [regionRaw, kindRaw] = String(token).split(':');
  let region = (regionRaw || '').toUpperCase();
  if (ALPHA3[region]) region = ALPHA3[region];
  const spec = CANONICAL[region];
  if (!spec) return { region, kind: null, known: false };
  const kind = kindRaw ? (spec.kinds[kindRaw.toLowerCase()] ?? null) : null;
  return { region, kind, known: true };
}

export function resolveKind(region, kind, cnDefaultRule) {
  const spec = CANONICAL[region];
  if (!spec) return null;
  if (region === 'CN') return kind || cnDefaultRule; // CN 全局默认口径可配
  return kind || spec.defaultKind;
}

/** (region, canonicalKind) → 数据集 id(查清单派生的映射,不再靠命名约定推断) */
export function datasetOf(region, kindResolved) {
  return KIND_DATASET[region]?.[kindResolved] ?? null;
}
