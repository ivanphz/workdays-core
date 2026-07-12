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
//   4. 【region×kind 模型】口径是一等公民,口径表唯一一处(tokens.js)。
//
// 【v2 要点】(决策记录见 docs/DEVLOG.md v2 章)
//   · 运行时零联网:CN/HK 查打包归档(src/data/*,每日流水线维护),US 纯算法;
//     opts.fetchImpl 已移除(无处可注,测试直接对 provider 注入数据)。
//   · 词汇一元化:kind 无别名('official' 等已废),非法口径 → 告警 + 默认口径。
//   · 响亮降级:未知国家 / 非法口径 / 数据集未加载 → loadLogs 告警(去重)+ 兜底,
//     绝不静默吞掉配置错误。v1 的 "US:market 未加载退用联邦" 兼容钉子已拆除,
//     统一为"数据集未加载 → 告警 + 纯周末"(可见的降级 > 貌似合理的错答案)。
//   · Date 输入按 UTC 读取(Workers 本地=UTC,生产行为不变;任何时区测试结果一致)。
//
// 【v2.2 要点】
//   · 双模式数据源: opts.dataSource = 'bundled'(默认,写死)| 'online'(可选,活抓上游,
//     按年覆盖归档,失败退档 —— 永不比默认差);抓取逻辑与流水线共用 src/sources.js(单点)。
//   · 导出器: exportJson / exportIcs(src/export.js),事实的序列化,可被极小的 Worker
//     端出去做 JSON 接口 / ICS 订阅 —— core 本身仍不是服务。
//   · 名称语言铁律: 简中 > 繁中 > 英文 > 当地语言(逐国落地见 sources.js)。
// ==============================================================================

import { parseToken, resolveKind, datasetOf, CANONICAL, REGION_META } from './tokens.js';
import { mergeNames, pickName } from './i18n.js';
import { createCnProvider } from './providers/cn.js';
import { createHkProvider } from './providers/hk.js';
import { createUsProvider } from './providers/us.js';
import { createUsMarketProvider } from './providers/us-market.js';
import { createGbProvider } from './providers/gb.js';
import { createSgProvider } from './providers/sg.js';

export { parseToken, resolveKind, CANONICAL, REGION_META };
export { exportJson, exportIcs } from './export.js';
export const CORE_PROTOCOL = 1; // 事实字段协议版本;fact 字段有破坏性变更时 +1 并发 major

// 数据集注册表 —— 加新日历(国家/民族/地区)= providers/ 新文件 + 此处一行 + tokens.js 表一行
const PROVIDER_FACTORIES = {
  'CN': createCnProvider,
  'HK': createHkProvider,
  'US': createUsProvider,
  'US-NYSE': createUsMarketProvider,
  'GB-EAW': () => createGbProvider('eaw'),   // 英格兰+威尔士(GB 默认)
  'GB-SCT': () => createGbProvider('sct'),   // 苏格兰
  'GB-NIR': () => createGbProvider('nir'),   // 北爱尔兰
  'SG': createSgProvider
  // 'CN-XJ': createCnXinjiangProvider, // ← 示例: 新疆地方假(kind 'xinjiang',详见 DEVLOG 路线图)
};

// 数据集 → (region, kind) 标签,仅用于 coverage 行的可读性标注(路由真相在 tokens.datasetOf)
const DATASET_META = {
  'CN': { region: 'CN', kind: '*' },
  'HK': { region: 'HK', kind: '*' },
  'US': { region: 'US', kind: 'bank' },
  'US-NYSE': { region: 'US', kind: 'market' },
  'GB-EAW': { region: 'GB', kind: 'england' },
  'GB-SCT': { region: 'GB', kind: 'scotland' },
  'GB-NIR': { region: 'GB', kind: 'ni' },
  'SG': { region: 'SG', kind: '*' }
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
 * @param opts   { cnDefaultRule: 'bank'|'market'(默认 bank;其它值 → 告警并按 bank),
 *                 dataSource: 'bundled'(默认)|'online'(其它值 → 告警并按 bundled),
 *                 lang: 名称解析语言(如 'sc'/'tc'/'en';缺省走铁律回落链 sc>tc>en>官方首语言),
 *                 fetchImpl: 自定义 fetch(仅 online 模式与测试用) }
 */
export async function createHolidayHub(tokens = [], years = [], opts = {}) {
  const loadLogs = [];
  const warned = new Set();
  const warnOnce = (msg) => { if (!warned.has(msg)) { warned.add(msg); loadLogs.push(msg); } };

  // ── 0. 全局 CN 默认口径校验(响亮,不静默归一) ─────────────────────────────
  let cnDefaultRule = 'bank';
  if (opts.cnDefaultRule !== undefined) {
    if (CANONICAL.CN.kinds[opts.cnDefaultRule]) cnDefaultRule = opts.cnDefaultRule;
    else warnOnce(`[WARN] cnDefaultRule '${opts.cnDefaultRule}' 不是合法口径(bank|market)，已按 bank 处理`);
  }

  // ── 0b. 数据源模式校验(默认 bundled 写死;online 为显式可选) ─────────────
  let dataSource = 'bundled';
  if (opts.dataSource !== undefined) {
    if (opts.dataSource === 'bundled' || opts.dataSource === 'online') dataSource = opts.dataSource;
    else warnOnce(`[WARN] dataSource '${opts.dataSource}' 不是合法模式(bundled|online)，已按 bundled 处理`);
  }

  const lang = typeof opts.lang === 'string' && opts.lang ? opts.lang : null;

  const yearList = [...new Set((years || []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  const coverage = []; // [{dataset, region, kind, year, ok, mode:'bundled'|'computed'|'fallback', source}]
  const providers = {};

  // ── 内部: token → 已解析口径(告警去重收敛在这一处) ──────────────────────
  const resolveOne = (token) => {
    const p = parseToken(token);
    if (!p.known) {
      warnOnce(`[WARN] 国家 ${p.region} 没有对应的假期 provider，将只按周末判断`);
      return { ...p, kind: null };
    }
    if (p.kind === null && String(token).includes(':')) {
      warnOnce(`[WARN] 未识别的口径 '${token}'，已按 ${p.region} 默认口径处理`);
    }
    return { ...p, kind: resolveKind(p.region, p.kind, cnDefaultRule) };
  };

  // ── 1. 由 tokens 推导需要哪些数据集('CN'/'CN:market' 归一为同一份 CN 数据;
  //       出现 'US:market' 才额外加载 NYSE 数据集) ─────────────────────────────
  const wanted = new Set();
  for (const t of (tokens || [])) {
    const p = resolveOne(t);
    if (p.known) wanted.add(datasetOf(p.region, p.kind));
  }

  for (const ds of wanted) {
    const factory = PROVIDER_FACTORIES[ds];
    if (factory) providers[ds] = factory();
  }

  // ── 2. 并行加载;汇总 coverage(结构化) 与 loadLogs(人类可读) ─────────────
  await Promise.all(Object.values(providers).map(async (p) => {
    const { rows, logs } = await p.load(yearList, { dataSource, fetchImpl: opts.fetchImpl });
    const meta = DATASET_META[p.dataset] || { region: p.dataset, kind: '*' };
    for (const r of rows) {
      coverage.push({ dataset: p.dataset, region: meta.region, kind: meta.kind, ...r });
    }
    loadLogs.push(...logs);
  }));

  // ── 3. 内部: 数据集寻址与单国单日结论 ────────────────────────────────────
  // 已解析 token → 已加载的 provider;数据集未加载 → 告警 + null(调用处按周末/无事实兜底)
  const providerFor = (t) => {
    if (!t.known) return null;
    const ds = datasetOf(t.region, t.kind);
    const p = providers[ds];
    if (!p) warnOnce(`[WARN] 数据集 ${ds} 未在本 hub 加载（创建时未申报对应 token），已按纯周末兜底`);
    return p || null;
  };

  const isWorkdayIn = (t, { dateStr, dow }) => {
    const weekendSays = dow !== 0 && dow !== 6;
    const p = providerFor(t);
    if (!p) return weekendSays;                    // 未知国家 / 数据集未加载(均已告警)
    if (t.region === 'CN') {
      const v = p.lookup(dateStr);                 // 三态
      if (v === true) return false;                // 明确放假(两种口径一致)
      if (v === false && t.kind !== 'market') return true; // 补班: bank=采信上班;market=不作数
      return weekendSays;                          // 无记录 / market 口径的补班 → 周末判断
    }
    return p.isOffDay(dateStr) ? false : weekendSays; // HK/US/NYSE: 命中假期即非工作日
  };

  // ── 4. 对外 API ──────────────────────────────────────────────────────────
  return {
    loadLogs,   // 注意: 惰性告警(非法口径/未加载数据集)在首次触及时才追加进来
    coverage,
    cnDefaultRule, // 'bank' | 'market'
    lang,          // 名称解析语言(null = 走铁律回落链 sc>tc>en>官方首语言)

    /**
     * 【结论层·主力面】多国叠加工作日判断器: 列表内"全部都是工作日"才算工作日,任一国休息即 false。
     * 空列表默认 ['CN']。接受 Date(按 UTC 读)或 'YYYY-MM-DD'。
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
     * Fact = { date, region, kind, dataset, isHoliday, isMakeup, name, observed, nominalDate }
     * 注意: CN 的 bank/market 共享同一份事实(补班日 isMakeup:true 两者相同),分岔在结论层。
     */
    fact(token, dateStr) {
      const t = resolveOne(token);
      const p = providerFor(t);
      if (!p) return null;
      const f = p.fact(String(dateStr).slice(0, 10));
      if (!f) return null;
      const officialLangs = p.officialLangs || [];
      const names = mergeNames(t.region, f.names, officialLangs); // 官方 ∪ 译名,官方同键必胜
      return {
        date: String(dateStr).slice(0, 10), region: t.region, kind: t.kind, dataset: p.dataset,
        isHoliday: f.isHoliday, isMakeup: f.isMakeup,
        name: pickName(names, lang, officialLangs), // 单名: 按 opts.lang,缺省 sc>tc>en 回落
        names,                                      // 全量多语(判官方/译名看 lang ∈ officialLangs)
        officialLangs,
        observed: f.observed, nominalDate: f.nominalDate
      };
    },

    /**
     * 【事实层·legacy 适配】[{date, isOffDay, name}] 按日期升序。
     * 与 NateScarlet/holiday-cn 的 days[] 同形 —— 专供 alarm-api 的 makeRestDayChecker
     * 零改造迁移(CN 含补班日 isOffDay:false;HK/US 仅假期 isOffDay:true)。
     */
    listDays(token) {
      const t = resolveOne(token);
      const p = providerFor(t);
      if (!p) return [];
      const ol = p.officialLangs || [];
      return p.days().map(d => ({
        date: d.date, isOffDay: d.isOffDay,
        name: pickName(mergeNames(t.region, d.names, ol), lang, ol)
      }));
    },

    /**
     * 【事实层·全量版】[{date, isOffDay, observed, name, names}] 升序。
     * names = 官方 ∪ 译名(判官方看 lang ∈ officialLangs,officialLangs 在信封/hub 层取)。
     */
    listDaysFull(token) {
      const t = resolveOne(token);
      const p = providerFor(t);
      if (!p) return [];
      const ol = p.officialLangs || [];
      return p.days().map(d => {
        const names = mergeNames(t.region, d.names, ol);
        return { date: d.date, isOffDay: d.isOffDay, observed: d.observed === true, name: pickName(names, lang, ol), names };
      });
    },

    /** 该 token 数据集的官方语言数组(判官方/译名的标记依据);未加载/未知 → [] */
    officialLangsOf(token) {
      const p = providerFor(resolveOne(token));
      return p ? (p.officialLangs || []) : [];
    },

    /**
     * 【时区守则】把任意时刻(缺省=现在)换算成该地区"此刻的民用日期"('YYYY-MM-DD')。
     * 消费方守则: 跨时区问"今天"必须先过这里 —— hub.isWorkday('USA:market', hub.localDateOf('USA:market'))
     * 才是"纽约现在是不是交易日";拿自己时区的日期直问,±1 天碰撞就是这么来的。
     * 时区取 REGION_META(IANA,自带夏令时;US 按联储/NYSE 惯例取纽约);未知地区退 UTC 日期。
     */
    localDateOf(token, at = new Date()) {
      const t = resolveOne(token);
      const tz = REGION_META[t.region]?.tz;
      if (!tz) return toDateParts(at instanceof Date ? at : new Date(at)).dateStr;
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(at instanceof Date ? at : new Date(at));
    },

    /** 该 token 在 dateStr 所在年份是否有数据(false = 正在按周末兜底,结果不可全信) */
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
