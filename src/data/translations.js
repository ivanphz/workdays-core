// ==============================================================================
// 🖐 src/data/translations.js — 译名表(人的领地:人工/AI 维护,流水线永不触碰)
// ==============================================================================
// 与归档 names 的分工: 归档只存官方发布的语言;这里放【准确对应的翻译】,
// 方便本地人阅读(默认解析链简中优先)。判官方/译名只看数据集的 officialLangs。
// 键结构: region → 官方名(精确匹配,含大小写与标点)→ { lang: 译名 }。
// 规则: ① 同键冲突官方值必胜(合并在 i18n.js);② 带 "(substitute day)" 等后缀的
// 变体不会命中精确匹配 → 自动回落官方原名,属预期;③ 增改此表 = patch 发版。

export const TRANSLATIONS = {
  CN: {
    '元旦':   { tc: '元旦', en: "New Year's Day" },
    '春节':   { tc: '春節', en: 'Chinese New Year' },
    '清明节': { tc: '清明節', en: 'Qingming Festival' },
    '劳动节': { tc: '勞動節', en: 'Labour Day' },
    '端午节': { tc: '端午節', en: 'Dragon Boat Festival' },
    '中秋节': { tc: '中秋節', en: 'Mid-Autumn Festival' },
    '国庆节': { tc: '國慶節', en: 'National Day' }
  },
  US: {
    "New Year's Day":             { sc: '元旦', tc: '元旦' },
    'Martin Luther King Jr. Day': { sc: '马丁·路德·金纪念日', tc: '馬丁·路德·金紀念日' },
    "Presidents' Day":            { sc: '总统日', tc: '總統日' },
    "Washington's Birthday":      { sc: '华盛顿诞辰日', tc: '華盛頓誕辰日' },
    'Good Friday':                { sc: '耶稣受难节', tc: '耶穌受難節' },
    'Memorial Day':               { sc: '阵亡将士纪念日', tc: '陣亡將士紀念日' },
    'Juneteenth':                 { sc: '六月节', tc: '六月節' },
    'Independence Day':           { sc: '独立日', tc: '獨立日' },
    'Labor Day':                  { sc: '劳动节', tc: '勞動節' },
    'Columbus Day':               { sc: '哥伦布日', tc: '哥倫布日' },
    'Veterans Day':               { sc: '退伍军人节', tc: '退伍軍人節' },
    'Thanksgiving':               { sc: '感恩节', tc: '感恩節' },
    'Christmas Day':              { sc: '圣诞节', tc: '聖誕節' }
  },
  GB: {
    "New Year's Day":       { sc: '元旦', tc: '元旦' },
    '2nd January':          { sc: '1月2日假期', tc: '1月2日假期' },
    "St Patrick's Day":     { sc: '圣帕特里克节', tc: '聖帕特里克節' },
    'Good Friday':          { sc: '耶稣受难节', tc: '耶穌受難節' },
    'Easter Monday':        { sc: '复活节星期一', tc: '復活節星期一' },
    'Early May bank holiday': { sc: '五月初银行假日', tc: '五月初銀行假日' },
    'Spring bank holiday':  { sc: '春季银行假日', tc: '春季銀行假日' },
    'Battle of the Boyne (Orangemen\u2019s Day)': { sc: '博因河战役纪念日', tc: '博因河戰役紀念日' },
    'Summer bank holiday':  { sc: '夏季银行假日', tc: '夏季銀行假日' },
    "St Andrew's Day":      { sc: '圣安德鲁日', tc: '聖安德魯日' },
    'Christmas Day':        { sc: '圣诞节', tc: '聖誕節' },
    'Boxing Day':           { sc: '节礼日', tc: '節禮日' }
  },
  SG: {
    "New Year's Day":   { sc: '元旦', tc: '元旦' },
    'Chinese New Year': { sc: '农历新年', tc: '農曆新年' },
    'Good Friday':      { sc: '耶稣受难节', tc: '耶穌受難節' },
    'Hari Raya Puasa':  { sc: '开斋节', tc: '開齋節' },
    'Labour Day':       { sc: '劳动节', tc: '勞動節' },
    'Vesak Day':        { sc: '卫塞节', tc: '衛塞節' },
    'Hari Raya Haji':   { sc: '哈芝节', tc: '哈芝節' },
    'National Day':     { sc: '国庆日', tc: '國慶日' },
    'Deepavali':        { sc: '屠妖节', tc: '屠妖節' },
    'Christmas Day':    { sc: '圣诞节', tc: '聖誕節' }
  },
  HK: {
    // HK 归档本身三语官方,一般无需译名;留位备用(如某年份某语言缺失时的补充)
  }
};
