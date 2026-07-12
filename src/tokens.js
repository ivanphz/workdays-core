// ==========================================
// 🎫 tokens.js — region×kind 令牌解析(全库唯一的一张口径表)
// ==========================================
// 核心模型: 一份日历 = { region(哪国), kind(哪种口径) }。
// "工作日"不是 国家→布尔 的一维问题 —— 同一天、同一国,不同口径可以给出相反答案:
//   · CN 补班周六:   bank(银行/网点)=上班,  market(A股/清算)=休息
//   · US Columbus:   bank(联邦银行)=休,     market(NYSE)=开市
//   · US GoodFriday: bank=开,               market=休          ← 双向都有差异
// 因此 kind 是一等公民;字符串 token('CN:market')只是对外简写,进库即解析。
//
// 【v2 词汇铁律】一词一义,无别名。v1 曾接受 official/bank 混写,v2 起全部移除
// (决策记录见 docs/DEVLOG.md v2 章):每个 kind 只有一个名字,写错/写旧名 →
// 解析为 null,由 hub 在使用处“告警 + 按默认口径处理”——响亮降级,打错字不再无声吞掉。
//
// canonical kind 一览(开放枚举:将来加民族/地区日历 = 此表加一行 + 新增 provider):
// ┌────────┬──────────────┬────────────────────────────────────────────────────┐
// │ region │ kind         │ 定义                                               │
// ├────────┼──────────────┼────────────────────────────────────────────────────┤
// │ CN     │ bank (默认)  │ 国务院法定调休口径:法定假=休、调休补班周末=上班    │
// │ CN     │ market       │ A股/跨行清算口径:补班标记不作数,周末一律休        │
// │ US     │ bank (默认)  │ 联邦/银行日历(11 个联邦假日+observed 顺延)        │
// │ US     │ market       │ NYSE 交易日历(GoodFriday 休;Columbus/Veterans 开) │
// │ HK     │ public (默认)│ 公众假期(港交所≈公众假期+周末,无独立口径的必要)  │
// │ GB     │ england(默认)│ 英格兰+威尔士 bank holiday(gov.uk 官方 E&W 分域;   │
// │        │              │ 伦敦证交所≈E&W,同 HK 先例不设 market)             │
// │ GB     │ scotland     │ 苏格兰分域(多 1月2日/圣安德鲁日,8月假在月初等)    │
// │ GB     │ ni           │ 北爱尔兰分域(多圣帕特里克日/博因河日)              │
// │ SG     │ public (默认)│ 新加坡公众假期(公历+农历+伊斯兰历+印度历混排,     │
// │        │              │ 见月宣告制 → 必须官方数据;银行与 SGX 均随之)       │
// └────────┴──────────────┴────────────────────────────────────────────────────┘
//
// 【分域即口径】GB 的三分治域用 kind 承载 —— 与 CN 民族/地方日历的预留思路同一机制
// (kind 回答的是"以谁的日历为准",地理分域是它的自然特例)。
//
// 【国家代码策略(v2.3)】输入接受 ISO 3166-1 的 alpha-2 与 alpha-3(严格封闭双射,
// 归一化只在 parseToken 单一入口);内部 canonical 恒为 alpha-2(数据集键/fact.region/
// coverage 不变,已部署配置零迁移);全称永不参与匹配,只作 REGION_META 的输出信息。
// 文档主写法引导 alpha-3('CHN:market'),alpha-2 为永久等价。这与"一词一义"公理的
// 关系见 DEVLOG v2.3 章 —— 国际标准双射 ≠ 自造同义词。

/** ISO 3166-1 alpha-3 → alpha-2(严格双射;未支持地区不入表,照旧 known:false 告警) */
export const ALPHA3 = { CHN: 'CN', HKG: 'HK', USA: 'US', GBR: 'GB', SGP: 'SG' };

/**
 * 地区元数据(输出端的"详细":代码、全称多语、代表时区)。全称只在这里,永不参与 token 匹配。
 * tz = 该日历的民用时区(IANA,自带夏令时);US 按联储/NYSE 惯例取纽约作代表时区。
 */
export const REGION_META = {
  CN: { alpha2: 'CN', alpha3: 'CHN', tz: 'Asia/Shanghai',   names: { sc: '中国大陆', tc: '中國大陸', en: 'Chinese mainland' } },
  HK: { alpha2: 'HK', alpha3: 'HKG', tz: 'Asia/Hong_Kong',  names: { sc: '香港', tc: '香港', en: 'Hong Kong' } },
  US: { alpha2: 'US', alpha3: 'USA', tz: 'America/New_York', names: { sc: '美国', tc: '美國', en: 'United States' } },
  GB: { alpha2: 'GB', alpha3: 'GBR', tz: 'Europe/London',   names: { sc: '英国', tc: '英國', en: 'United Kingdom' } },
  SG: { alpha2: 'SG', alpha3: 'SGP', tz: 'Asia/Singapore',  names: { sc: '新加坡', tc: '新加坡', en: 'Singapore' } }
};

export const CANONICAL = {
  CN: { defaultKind: 'bank',   kinds: { bank: 'bank', market: 'market' } },
  US: { defaultKind: 'bank',   kinds: { bank: 'bank', market: 'market' } },
  HK: { defaultKind: 'public', kinds: { public: 'public' } },
  GB: { defaultKind: 'england', kinds: { england: 'england', scotland: 'scotland', ni: 'ni' } },
  SG: { defaultKind: 'public', kinds: { public: 'public' } }
};

/**
 * 解析 token 字符串 → { region, kind, known }
 *   'CN'          → { region:'CN', kind:null,    known:true }   kind=null 表示"未显式指定"(用默认)
 *   'US:market'   → { region:'US', kind:'market',known:true }
 *   'CN:official' → { region:'CN', kind:null,    known:true }   ⚠️ v2 起非法口径 → null,hub 会告警
 *   'GB'          → { region:'GB', kind:null,    known:false }  未支持的国家(hub 告警 + 周末兜底)
 */
export function parseToken(token) {
  const [regionRaw, kindRaw] = String(token).split(':');
  let region = (regionRaw || '').toUpperCase();
  if (ALPHA3[region]) region = ALPHA3[region]; // alpha-3 → alpha-2(单一归一化入口)
  const spec = CANONICAL[region];
  if (!spec) return { region, kind: null, known: false };
  const kind = kindRaw ? (spec.kinds[kindRaw.toLowerCase()] ?? null) : null;
  return { region, kind, known: true };
}

/**
 * kind=null(未指定/非法) → 落到该 region 的默认 kind。
 * CN 特殊:默认 kind 受全局 cnDefaultRule 影响(hub 层已校验为 'bank'|'market')。
 */
export function resolveKind(region, kind, cnDefaultRule) {
  const spec = CANONICAL[region];
  if (!spec) return null;
  if (region === 'CN') return kind || cnDefaultRule;
  return kind || spec.defaultKind;
}

/**
 * (region, canonicalKind) → 数据集 id。数据集 = 一份独立维护的假期数据/算法:
 *   CN → 'CN'(bank/market 共享同一份原始数据,差异只在结论层)
 *   HK → 'HK'
 *   US bank → 'US'(联邦算法)   US market → 'US-NYSE'(NYSE 算法,独立数据集)
 *   GB england/scotland/ni → 'GB-EAW'/'GB-SCT'/'GB-NIR'(同一次抓取,三份分域数据)
 *   SG → 'SG'
 */
export function datasetOf(region, kindResolved) {
  if (region === 'US' && kindResolved === 'market') return 'US-NYSE';
  if (region === 'GB') return ({ england: 'GB-EAW', scotland: 'GB-SCT', ni: 'GB-NIR' })[kindResolved] || 'GB-EAW';
  return region;
}
