// ==============================================================================
// 🗓 workdays-core — 多国工作日/假期"事实引擎"(公共 npm 包,库,不是服务)
// ==============================================================================
// 定位与铁律(详见 docs/DEVLOG.md 的设计公理):
//   1. 【库,不是服务】只导出纯函数/对象,消费方 import 后进程内现算;绝不提供 HTTP 端点。
//   2. 【事实,不是结论】provider 只吐原始事实(isHoliday/isMakeup/name/observed/coverage);
//      "这天是不是工作日"是消费方按 kind 口径现算的结论 —— 本文件的 makeWorkdayChecker
//      只是把最常用的结论算法(多国叠加)顺手提供,消费方也可只拿事实自己算。
//   3. 【只装公共世界】CN/HK/US 各口径 = 关于世界的客观事实;任何私有日历/个人作息
//      语义(请假判定、休息块)【永不进入本包】,它们属于消费方(alarm-api)的领地。
//   4. 【region×kind 模型】口径是一等公民,别名表唯一一处(tokens.js)。
//
// 对 reminder-hub 的兼容承诺: createHolidayHub(tokens, years, {cnDefaultRule}) 签名、
// hub.loadLogs、hub.makeWorkdayChecker(tokens) 的行为与原 src/holidays/index.js 逐语义
// 等价(含: 空列表默认 ['CN']、未知国家告警+周末兜底、'US:market' 未加载时退用联邦数据、
// CN 三态调休、'CN:market' 补班不作数、'HK:*' 别名等价)。差异仅两处刻意增强:
//   · hub.cnDefaultRule 显示 canonical 名('official' → 'bank'),行为不变;
//   · checker 对 Date 输入按 UTC 读取日期(Workers 运行时本地=UTC,生产行为不变;
//     好处是任何时区的 Node 测试环境结果一致)。
// ==============================================================================

import { parseToken, resolveKind, datasetOf, normalizeCnRule, CANONICAL } from './tokens.js';
import { createCnProvider } from './providers/cn.js';
import { createHkProvider } from './providers/hk.js';
import { createUsProvider } from './providers/us.js';
import { createUsMarketProvider } from './providers/us-market.js';

export { parseToken, resolveKind, CANONICAL };
export const CORE_PROTOCOL = 1; // 事实字段协议版本;fact 字段有破坏性变更时 +1 并发 major

// 数据集注册表 —— 加新日历(国家/民族/地区)= providers/ 新文件 + 此处一行 + tokens.js 表一行
const PROVIDER_FACTORIES = {
  'CN': createCnProvider,
  'HK': createHkProvider,
  'US': createUsProvider,
  'US-NYSE': createUsMarketProvider
  // 'GB': createGbProvider,        // ← 示例: 英国
  // 'CN-XJ': createCnXinjiangProvider, // ← 示例: 新疆地方假(kind 'xinjiang',详见 DEVLOG 路线图)
};

/** 输入统一: Date(按 UTC 读) 或 'YYYY-MM-DD' 字符串 → { dateStr, dow } */
function toDateParts(dateLike) {
  if (dateLike instanceof Date) {
    const pad = n => ('0' + n).slice(-2);
    const dateStr = `${dateLike.getUTCFullYear()}-${pad(dateLike.getUTCMonth() + 1)}-${pad(dateLike.getUTCDate())}`;
    return { dateStr, dow: dateLike.getUTCDay() };
  }
  const dateStr = String(dateLike).slice(0, 10);
  return { dateStr, dow: new Date(`${dateStr}T00:00:00Z`).getUTCDay() };
}

/**
 * 创建假期中枢: 按需加载 tokens 涉及的数据集 × years 年份。
 * @param tokens 形如 ['CN','US:market','HK'] —— 决定加载哪些数据集(见 tokens.js)
 * @param years  形如 [2026, 2027] —— 需要覆盖的年份;窗口跨年请把两年都传入
 * @param opts   { cnDefaultRule: 'bank'|'official'|'market'(默认 bank;official 为别名),
 *                 fetchImpl: 自定义 fetch(测试注入用,缺省 globalThis.fetch) }
 */
export async function createHolidayHub(tokens = [], years = [], opts = {}) {
  const cnDefaultRule = normalizeCnRule(opts.cnDefaultRule);
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const yearList = [...new Set((years || []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);

  const loadLogs = [];
  const coverage = []; // [{dataset, region, kind, year, ok, mode:'authoritative'|'computed'|'fallback', source}]
  const providers = {};

  // ── 1. 由 tokens 推导需要哪些数据集(与原实现同思路: 'CN'/'CN:market' 归一为同一份 CN 数据;
  //       出现 'US:market' 才额外加载 NYSE 数据集) ─────────────────────────────
  const wanted = new Set();
  for (const t of (tokens || [])) {
    const p = parseToken(t);
    if (!p.known) {
      loadLogs.push(`[WARN] 国家 ${p.region} 没有对应的假期 provider，将只按周末判断`);
      continue;
    }
    wanted.add(p.region);                                        // 主数据集(CN/HK/US)
    if (p.region === 'US' && p.kind === 'market') wanted.add('US-NYSE'); // 附加数据集
  }

  for (const ds of wanted) {
    const factory = PROVIDER_FACTORIES[ds];
    if (factory) providers[ds] = factory();
  }

  // ── 2. 并行加载;汇总 coverage(结构化) 与 loadLogs(人类可读) ─────────────
  await Promise.all(Object.values(providers).map(async (p) => {
    const { rows, logs } = await p.load(yearList, { fetchImpl });
    for (const r of rows) {
      coverage.push({
        dataset: p.dataset,
        region: p.dataset === 'US-NYSE' ? 'US' : p.dataset,
        kind: p.dataset === 'US-NYSE' ? 'market' : (p.dataset === 'US' ? 'bank' : '*'),
        ...r
      });
    }
    loadLogs.push(...logs);
  }));

  // ── 3. 内部: token → 已解析口径;单国单日结论(与原 isWorkdayInCountry 逐语义等价) ──
  const resolveOne = (token) => {
    const p = parseToken(token);
    return { ...p, kind: p.known ? resolveKind(p.region, p.kind, cnDefaultRule) : null };
  };

  const isWorkdayIn = ({ region, kind, known }, { dateStr, dow }) => {
    // US 市场口径: 查 NYSE 数据集;未加载则退回下方联邦路径(原行为)
    if (known && region === 'US' && kind === 'market' && providers['US-NYSE']) {
      if (providers['US-NYSE'].isOffDay(dateStr)) return false;
      return dow !== 0 && dow !== 6;
    }
    const p = providers[region];
    if (known && region === 'CN' && p) {
      const v = p.lookup(dateStr);            // 三态
      if (v === true) return false;           // 明确放假(两种口径一致)
      if (v === false && kind !== 'market') return true; // 补班: bank=采信上班;market=不作数,落到周末判断
      // undefined / market 口径的补班 → 落到周末默认判断
    } else if (p && p.isOffDay(dateStr)) {
      return false;                           // HK/US: 命中假期即非工作日
    }
    return dow !== 0 && dow !== 6;            // 默认: 周末为休息(含未知国家/数据缺失兜底)
  };

  const datasetFor = ({ region, kind, known }) => {
    if (!known) return null;
    const ds = datasetOf(region, kind);
    if (ds === 'US-NYSE' && !providers['US-NYSE']) return providers['US'] ? 'US' : null; // 与结论层同款退化
    return providers[ds] ? ds : null;
  };

  // ── 4. 对外 API ──────────────────────────────────────────────────────────
  return {
    loadLogs,
    coverage,
    cnDefaultRule, // canonical: 'bank' | 'market'(入参 'official' 已归一为 'bank')

    /**
     * 【结论层·兼容面】多国叠加工作日判断器: 列表内"全部都是工作日"才算工作日,任一国休息即 false。
     * 空列表默认 ['CN']。接受 Date(按 UTC 读)或 'YYYY-MM-DD'。签名与行为对齐原 holidays/index.js。
     */
    makeWorkdayChecker(list) {
      const toks = ((list && list.length) ? list : ['CN']).map(resolveOne);
      return (dateLike) => {
        const parts = toDateParts(dateLike);
        return toks.every(t => isWorkdayIn(t, parts));
      };
    },

    /** 结论层·便捷单发: isWorkday('CN', d) 或 isWorkday(['CN','US'], d) */
    isWorkday(tokenOrList, dateLike) {
      const list = Array.isArray(tokenOrList) ? tokenOrList : [tokenOrList];
      return this.makeWorkdayChecker(list)(dateLike);
    },

    /**
     * 【事实层】单日原始事实,无记录返回 null。
     * Fact = { date, region, kind, isHoliday, isMakeup, name, observed, nominalDate, dataset }
     * 注意: CN 的 bank/market 共享同一份事实(补班日 isMakeup:true 两者相同),分岔在结论层。
     */
    fact(token, dateStr) {
      const t = resolveOne(token);
      const ds = datasetFor(t);
      if (!ds) return null;
      const f = providers[ds].fact(String(dateStr).slice(0, 10));
      if (!f) return null;
      return { date: String(dateStr).slice(0, 10), region: t.region, kind: t.kind, dataset: ds, ...f };
    },

    /**
     * 【事实层·legacy 适配】[{date, isOffDay, name}] 按日期升序。
     * 与 NateScarlet/holiday-cn 的 days[] 同形 —— 专供 alarm-api 的 makeRestDayChecker
     * 零改造迁移(CN 含补班日 isOffDay:false;HK/US 仅假期 isOffDay:true)。
     */
    listDays(token) {
      const ds = datasetFor(resolveOne(token));
      return ds ? providers[ds].days() : [];
    },

    /** 该 token 在 dateStr 所在年份是否有权威/算法数据(false = 正在按周末兜底,结果不可全信) */
    isCovered(token, dateStr) {
      const t = resolveOne(token);
      const ds = t.known ? datasetOf(t.region, t.kind) : null;
      if (!ds) return false;
      const year = Number(String(dateStr).slice(0, 4));
      const row = coverage.find(c => c.dataset === ds && c.year === year);
      return row ? row.ok : false;
    }
  };
}
