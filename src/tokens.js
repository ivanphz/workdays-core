// ==========================================
// 🎫 tokens.js — region×kind 令牌解析(全库唯一的一张别名表)
// ==========================================
// 核心模型: 一份日历 = { region(哪国), kind(哪种口径) }。
// "工作日"不是 国家→布尔 的一维问题 —— 同一天、同一国,不同口径可以给出相反答案:
//   · CN 补班周六:   bank(银行/网点)=上班,  market(A股/清算)=休息
//   · US Columbus:   bank(联邦银行)=休,     market(NYSE)=开市
//   · US GoodFriday: bank=开,               market=休          ← 双向都有差异
// 因此 kind 是一等公民;字符串 token('CN:market')只是对外简写,进库即归一化。
//
// 【别名策略】对外宽容、对内唯一:所有历史/习惯写法在这里归一成 canonical kind,
// 库内其它文件只认 canonical,全库不允许出现第二张别名表。
//
// canonical kind 一览(开放枚举:将来加民族/地区日历 = 此表加一行 + 新增 provider,别处不动):
// ┌────────┬──────────────┬────────────────────────────────────────────────────┐
// │ region │ canonical    │ 定义                                               │
// ├────────┼──────────────┼────────────────────────────────────────────────────┤
// │ CN     │ bank (默认)  │ 国务院法定调休口径:法定假=休、调休补班周末=上班    │
// │        │              │ (即银行/网点/上班族口径;别名 official)            │
// │ CN     │ market       │ A股/跨行清算口径:补班标记不作数,周末一律休        │
// │ US     │ bank (默认)  │ 联邦/银行日历(11 个联邦假日+observed;别名 official)│
// │ US     │ market       │ NYSE 交易日历(GoodFriday 休;Columbus/Veterans 开) │
// │ HK     │ public (默认)│ 公众假期;港交所≈公众假期+周末、与银行无背离,      │
// │        │              │ 故 bank/market/official 全部为等价别名             │
// └────────┴──────────────┴────────────────────────────────────────────────────┘

export const CANONICAL = {
  CN: { defaultKind: 'bank',   kinds: { bank: 'bank', official: 'bank', market: 'market' } },
  US: { defaultKind: 'bank',   kinds: { bank: 'bank', official: 'bank', market: 'market' } },
  HK: { defaultKind: 'public', kinds: { public: 'public', bank: 'public', official: 'public', market: 'public' } }
};

/**
 * 解析 token 字符串 → { region, kind, known }
 *   'CN'          → { region:'CN', kind:null,    known:true }   kind=null 表示"未显式指定"
 *   'CN:official' → { region:'CN', kind:'bank',  known:true }   别名已归一化
 *   'US:market'   → { region:'US', kind:'market',known:true }
 *   'CN:banana'   → { region:'CN', kind:null,    known:true }   未识别的 kind 视同未指定(旧行为)
 *   'GB'          → { region:'GB', kind:null,    known:false }  未支持的国家(调用方按周末兜底并告警)
 */
export function parseToken(token) {
  const [regionRaw, kindRaw] = String(token).split(':');
  const region = (regionRaw || '').toUpperCase();
  const spec = CANONICAL[region];
  if (!spec) return { region, kind: null, known: false };
  const kind = kindRaw ? (spec.kinds[kindRaw.toLowerCase()] ?? null) : null;
  return { region, kind, known: true };
}

/**
 * kind=null(未指定/未识别) → 落到该 region 的默认 kind。
 * CN 特殊:默认 kind 受全局 cnDefaultRule 影响(对应 reminder-hub 的 ?cnRule= 参数)。
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
 */
export function datasetOf(region, kindResolved) {
  if (region === 'US' && kindResolved === 'market') return 'US-NYSE';
  return region;
}

/** 全局 CN 默认口径归一:'market' → market,其余('official'/'bank'/未传/乱写) → bank(旧行为等价) */
export function normalizeCnRule(v) {
  return v === 'market' ? 'market' : 'bank';
}
