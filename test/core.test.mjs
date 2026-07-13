// ==============================================================================
// 🧪 workdays-core 测试 — v2:全离线且零 mock 网络(CN 用真实归档,HK 用注入数据)
// ==============================================================================
// 分组:
//   A. token 解析(v2 词汇铁律: 无别名,非法口径→null)
//   B. CN 三态 + bank/market 双口径(【真实国务院公告数据】断言)
//   C. US 联邦 vs NYSE 双日历双向差异 + observed 事实(纯算法)
//   D. HK provider(注入数据: 名称/覆盖度/空归档诚实降级)+ ICS 解析器(折行)
//   E. 多国叠加 / 默认 ['CN'] / 响亮降级(未知国家/非法口径/数据集未加载)
//   F. listDays legacy 形状(alarm-api 迁移契约,真实数据)
//   G. coverage / isCovered(bundled vs fallback 如实上报)
//   H. 输入形态: Date(UTC 读) 与 'YYYY-MM-DD' 等价
//
// 【测试哲学】CN 断言全部来自已发布的国务院公告(归档随流水线更新,已官宣年份不会变,
// 若真被修正案改动 → 测试红 = 正确的警报)。HK 归档初始为空且随流水线增长,因此
// HK 行为测试对 provider 直接注入固定数据,与归档内容解耦 —— 永绿。
// ==============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHolidayHub, parseToken, exportJson, exportIcs, getRegions, initDatasets } from '../src/index.js';
import { before } from 'node:test';
import { createArchiveProvider } from '../src/datasets/_archive-provider.js';

// v3: providers 收进数据集文件夹;测试用通用归档引擎直接注入 fixture 验证 provider 行为
const createHkProvider = (data) => createArchiveProvider({ dataset: 'HK', tag: 'HK', sourceName: 'test', legacyLang: 'sc', data, sliceDays: d => d.days });
const createSgProvider = (data) => createArchiveProvider({ dataset: 'SG', tag: 'SG', sourceName: 'test', legacyLang: 'en', data, sliceDays: d => d.days });
const createGbProvider = (division, data) => createArchiveProvider({ dataset: 'GB-' + division.toUpperCase(), tag: 'GB:' + division, sourceName: 'test', legacyLang: 'en', data, sliceDays: d => (d.divisions || {})[division] });

before(async () => { await initDatasets(); }); // v3: parseToken 依赖已装载的数据集清单

// ── A. token 解析(v2: 一词一义) ─────────────────────────────────────────────
test('A1 合法口径解析;非法/旧别名 → kind null;未知国家 known:false', () => {
  assert.deepEqual(parseToken('CN:bank'),   { region: 'CN', kind: 'bank', known: true });
  assert.deepEqual(parseToken('US:market'), { region: 'US', kind: 'market', known: true });
  assert.equal(parseToken('HK:public').kind, 'public');
  assert.equal(parseToken('cn:MARKET').kind, 'market');    // 大小写宽容
  assert.equal(parseToken('CN:official').kind, null);      // v2: 别名已废
  assert.equal(parseToken('HK:market').kind, null);        // v2: HK 伪口径已废
  assert.equal(parseToken('CN:banana').kind, null);
  assert.equal(parseToken('GB:scotland').kind, 'scotland');
  assert.equal(parseToken('GB:ni').kind, 'ni');
  assert.equal(parseToken('GB:wales').kind, null);   // 威尔士并入 E&W(england 口径),无独立分域
  assert.equal(parseToken('SG').known, true);
  assert.equal(parseToken('SG:public').kind, 'public');
  assert.equal(parseToken('JP').known, false);
  // v2.3: ISO alpha-3 严格双射,归一化只在 parseToken 单一入口,canonical 恒为二位
  assert.deepEqual(parseToken('CHN:market'), { region: 'CN', kind: 'market', known: true });
  assert.equal(parseToken('HKG').region, 'HK');
  assert.equal(parseToken('gbr:scotland').kind, 'scotland');
  assert.equal(parseToken('USA:market').kind, 'market');
  assert.equal(parseToken('JPN').known, false); // 未支持地区的三位码照旧告警路径
});

// ── B. CN 三态 + 双口径(真实公告数据) ───────────────────────────────────────
test('B1 CN bank: 法定假=休, 补班=上班(真实 2026 数据: 10-10 补班周六, 01-04 补班周日)', async () => {
  const hub = await createHolidayHub(['CN'], [2026]);
  const w = hub.makeWorkdayChecker(['CN']);
  assert.equal(w('2026-10-01'), false); // 国庆
  assert.equal(w('2026-10-10'), true);  // 真实补班周六
  assert.equal(w('2026-01-04'), true);  // 真实补班周日(元旦调休)
  assert.equal(w('2026-07-01'), true);  // 无记录的周三
  assert.equal(w('2026-10-17'), false); // 无记录的普通周六
});

test('B2 CN market: 补班不作数;token 级优先于全局默认;非法 cnDefaultRule 告警并按 bank', async () => {
  const hub = await createHolidayHub(['CN'], [2026]);
  assert.equal(hub.makeWorkdayChecker(['CN:market'])('2026-10-10'), false);
  assert.equal(hub.makeWorkdayChecker(['CN:market'])('2026-10-01'), false);
  const hubM = await createHolidayHub(['CN'], [2026], { cnDefaultRule: 'market' });
  assert.equal(hubM.cnDefaultRule, 'market');
  assert.equal(hubM.makeWorkdayChecker(['CN'])('2026-10-10'), false);
  assert.equal(hubM.makeWorkdayChecker(['CN:bank'])('2026-10-10'), true);
  // v2: 'official' 不再是合法值 → 告警 + bank
  const hubO = await createHolidayHub(['CN'], [2026], { cnDefaultRule: 'official' });
  assert.equal(hubO.cnDefaultRule, 'bank');
  assert.ok(hubO.loadLogs.some(l => l.includes("cnDefaultRule 'official'")));
});

test('B3 CN fact: 补班日 isMakeup:true 且两 kind 事实相同(真实数据)', async () => {
  const hub = await createHolidayHub(['CN'], [2026]);
  const fBank = hub.fact('CN', '2026-10-10');
  assert.equal(fBank.isMakeup, true);
  assert.equal(fBank.isHoliday, false);
  assert.equal(fBank.name, '国庆节');
  assert.equal(fBank.names.sc, '国庆节');                    // v2.3: 全量多语对象
  assert.deepEqual(fBank.officialLangs, ['sc']);             // 官方语言标记(数据集级)
  assert.equal(hub.fact('CN:market', '2026-10-10').isMakeup, true); // 事实层一致
  assert.equal(hub.fact('CN', '2026-07-01'), null);
});

test('B4 年桶边界: 2007 桶含 2006-12-30/31 跨年补班(上游即如此,沿袭)', async () => {
  const hub = await createHolidayHub(['CN'], [2007]);
  assert.equal(hub.fact('CN', '2006-12-31').isMakeup, true);
  assert.equal(hub.makeWorkdayChecker(['CN'])('2006-12-31'), true); // 补班周日 → 上班
});

// ── C. US 联邦 vs NYSE(纯算法,与 v1 逐日等价) ──────────────────────────────
test('C1 双向差异: GoodFriday 银行开/NYSE休;Columbus 银行休/NYSE开', async () => {
  const hub = await createHolidayHub(['US', 'US:market'], [2026]);
  assert.equal(hub.makeWorkdayChecker(['US'])('2026-04-03'), true);
  assert.equal(hub.makeWorkdayChecker(['US:market'])('2026-04-03'), false);
  assert.equal(hub.makeWorkdayChecker(['US'])('2026-10-12'), false);
  assert.equal(hub.makeWorkdayChecker(['US:market'])('2026-10-12'), true);
  assert.equal(hub.makeWorkdayChecker(['US'])('2026-11-11'), false);
  assert.equal(hub.makeWorkdayChecker(['US:market'])('2026-11-11'), true);
});

test('C2 observed 事实: 7/4 落周六 → 7/3 observed 休且带 nominalDate', async () => {
  assert.equal(new Date('2026-07-04T00:00:00Z').getUTCDay(), 6); // 前置自检
  const hub = await createHolidayHub(['US'], [2026]);
  const f = hub.fact('US', '2026-07-03');
  assert.equal(f.isHoliday, true);
  assert.equal(f.observed, true);
  assert.equal(f.nominalDate, '2026-07-04');
  assert.equal(f.name, '独立日');             // v2.3: 默认链简中优先 → 译名
  assert.equal(f.names.en, 'Independence Day'); // 官方名并存
  assert.equal(hub.fact('US', '2026-07-04').observed, false);
  assert.equal(hub.makeWorkdayChecker(['US'])('2026-07-03'), false);
});

test('C3 元旦落周六的 NYSE 例外: 2028-01-01 周六 → 银行 2027-12-31 休, NYSE 照常开市', async () => {
  assert.equal(new Date('2028-01-01T00:00:00Z').getUTCDay(), 6); // 前置自检
  const hub = await createHolidayHub(['US', 'US:market'], [2027, 2028]);
  assert.equal(hub.makeWorkdayChecker(['US'])('2027-12-31'), false);
  assert.equal(hub.fact('US', '2027-12-31').observed, true);
  assert.equal(hub.makeWorkdayChecker(['US:market'])('2027-12-31'), true);
  assert.equal(hub.fact('US:market', '2027-12-31'), null);
});

// ── D. HK ────────────────────────────────────────────────────────────────────
test('D0 HK 真实归档(官方快照种子 2018–2027,简中名): 历史钉子(≤2025 永不被窗口覆盖)', async () => {
  const hub = await createHolidayHub(['HK'], [2020, 2021]);
  assert.equal(hub.isWorkday('HK', '2021-07-01'), false); // 香港特别行政区成立纪念日(周四)
  assert.equal(hub.fact('HK', '2021-07-01').name, '香港特别行政区成立纪念日');
  assert.equal(hub.fact('HK', '2020-10-01').name, '国庆日');
  assert.equal(hub.isCovered('HK', '2021-06-15'), true);
  assert.equal(hub.coverage.find(c => c.dataset === 'HK' && c.year === 2021).mode, 'bundled');
});

// (以下 provider 级注入,与归档内容解耦)
const HK_TEST_DATA = {
  schema: 2, source: 'test', generatedAt: '2026-01-01T00:00:00Z', officialLangs: ['en'], tz: 'Asia/Hong_Kong', ext: {},
  days: {
    '2026-01-01': { names: { en: 'The first day of January' }, observed: false },
    '2026-02-17': { names: { en: "Lunar New Year's Day" }, observed: false }
  }
};

test('D1 HK provider: 名称/事实/coverage(注入数据)', async () => {
  const p = createHkProvider(HK_TEST_DATA);
  const { rows } = await p.load([2026, 2031]);
  assert.equal(p.isOffDay('2026-01-01'), true);
  assert.equal(p.fact('2026-02-17').names.en, "Lunar New Year's Day"); // provider 层吐 names,单名解析在 hub
  assert.equal(rows.find(r => r.year === 2026).mode, 'bundled');
  assert.equal(rows.find(r => r.year === 2031).mode, 'fallback'); // 归档不覆盖的年份如实上报
  assert.deepEqual(p.days().map(d => d.date), ['2026-01-01', '2026-02-17']);
});

test('D2 HK 空归档: 诚实降级(fallback + 周末兜底),流水线首刷前的初始状态', async () => {
  const p = createHkProvider({ source: 'test', generatedAt: null, days: {} });
  const { rows, logs } = await p.load([2026]);
  assert.equal(rows[0].ok, false);
  assert.ok(logs.some(l => l.includes('归档为空')));
  assert.equal(p.isOffDay('2026-01-01'), false); // 无数据 → 调用方按周末兜底
});



// ── E. 叠加/默认/响亮降级 ────────────────────────────────────────────────────
test('E1 多国叠加: 任一腿休即休;空列表默认 [CN];isWorkday 便捷单发', async () => {
  const hub = await createHolidayHub(['CN', 'US'], [2026]);
  assert.equal(hub.makeWorkdayChecker(['CN', 'US'])('2026-07-03'), false); // CN 上班 + US observed 休 → 休
  assert.equal(hub.makeWorkdayChecker(['CN'])('2026-07-03'), true);
  assert.equal(hub.makeWorkdayChecker([])('2026-10-01'), false);
  assert.equal(hub.makeWorkdayChecker()('2026-10-10'), true);
  assert.equal(hub.isWorkday(['CN', 'US'], '2026-07-03'), false);
});

test('E2 未知国家: 告警 + 周末兜底(不抛错)', async () => {
  const hub = await createHolidayHub(['JP'], [2026]);
  assert.ok(hub.loadLogs.some(l => l.includes('JP')));
  const w = hub.makeWorkdayChecker(['JP']);
  assert.equal(w('2026-01-02'), true);  // 周五
  assert.equal(w('2026-01-03'), false); // 周六
});

test('E3 v2 响亮降级: 非法口径 → 告警+默认;数据集未加载 → 告警+纯周末(联邦退化钉子已拆)', async () => {
  const hub = await createHolidayHub(['CN'], [2026]);
  // 非法口径 'CN:official': 行为=默认口径(bank),且 loadLogs 出现告警
  const w = hub.makeWorkdayChecker(['CN:official']);
  assert.equal(w('2026-10-10'), true); // 按默认 bank: 补班上班
  assert.ok(hub.loadLogs.some(l => l.includes("未识别口径 'CN:official'")));
  // 数据集未加载: 建 hub 只有 CN,却问 US:market → 告警 + 纯周末(不再退用联邦)
  const wm = hub.makeWorkdayChecker(['US:market']);
  assert.equal(wm('2026-10-12'), true);  // Columbus(周一): 纯周末口径=工作日(v1 曾错退联邦判休)
  assert.ok(hub.loadLogs.some(l => l.includes('数据集 US-NYSE 未在本 hub 加载')));
  // 告警去重: 再问一次不重复追加
  const n = hub.loadLogs.filter(l => l.includes('US-NYSE')).length;
  hub.makeWorkdayChecker(['US:market'])('2026-10-13');
  assert.equal(hub.loadLogs.filter(l => l.includes('US-NYSE')).length, n);
});

// ── F. listDays legacy 形状(alarm-api 契约,真实数据)─────────────────────────
test('F1 listDays(CN): 与 holiday-cn days[] 同形同序(真实 2026: 39 条,含补班)', async () => {
  const hub = await createHolidayHub(['CN'], [2026]);
  const days = hub.listDays('CN');
  assert.equal(days.length, 39); // 真实 2026.json 条数
  assert.deepEqual(days.find(d => d.date === '2026-10-10'), { date: '2026-10-10', isOffDay: false, name: '国庆节' });
  assert.deepEqual(days.find(d => d.date === '2026-10-01'), { date: '2026-10-01', isOffDay: true, name: '国庆节' });
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : 1));
  assert.deepEqual(days, sorted);
});

test('F2 listDays(US): 仅假期(isOffDay 全 true), 无补班概念', async () => {
  const hub = await createHolidayHub(['US'], [2026]);
  const days = hub.listDays('US');
  assert.ok(days.length >= 11);
  assert.ok(days.every(d => d.isOffDay === true && typeof d.name === 'string'));
  assert.ok(days.some(d => d.date === '2026-07-03')); // observed 日也在集合内
});

// ── G. coverage / isCovered ──────────────────────────────────────────────────
test('G1 coverage: 归档命中=bundled;缺失年份=fallback 且 isCovered=false', async () => {
  const hub = await createHolidayHub(['CN'], [2026, 2031]);
  const c26 = hub.coverage.find(c => c.dataset === 'CN' && c.year === 2026);
  const c31 = hub.coverage.find(c => c.dataset === 'CN' && c.year === 2031);
  assert.equal(c26.ok, true);
  assert.equal(c26.mode, 'bundled');
  assert.equal(c31.ok, false);
  assert.equal(c31.mode, 'fallback');
  assert.equal(hub.isCovered('CN', '2026-05-01'), true);
  assert.equal(hub.isCovered('CN', '2031-05-01'), false);
});

test('G2 coverage: 算法类(US/NYSE)=computed;全年份归档 2007..2026 完整', async () => {
  const hub = await createHolidayHub(['US', 'US:market', 'CN'], [2026]);
  assert.ok(hub.coverage.filter(c => c.dataset === 'US').every(c => c.mode === 'computed' && c.ok));
  assert.ok(hub.coverage.some(c => c.dataset === 'US-NYSE' && c.kind === 'market'));
  // 归档完整性: 2007..2026 每年都可覆盖(留档铁律的落地验证)
  const hubAll = await createHolidayHub(['CN'], Array.from({ length: 20 }, (_, i) => 2007 + i));
  assert.ok(hubAll.coverage.filter(c => c.dataset === 'CN').every(c => c.ok && c.mode === 'bundled'));
});

// ── H. 输入形态 ──────────────────────────────────────────────────────────────
test('H1 Date(UTC) 与字符串输入等价', async () => {
  const hub = await createHolidayHub(['CN'], [2026]);
  const w = hub.makeWorkdayChecker(['CN']);
  assert.equal(w(new Date('2026-10-10T00:00:00Z')), w('2026-10-10'));
  assert.equal(w(new Date('2026-10-01T00:00:00Z')), false);
});

// ── I. GB / SG(provider 级注入,与归档内容解耦;分域路由走 hub)──────────────
const GB_TEST_DATA = {
  schema: 2, source: 'test', generatedAt: '2026-01-01T00:00:00Z', officialLangs: ['en'], tz: 'Europe/London', ext: {},
  divisions: {
    eaw: {
      '2026-01-01': { names: { en: "New Year's Day" }, observed: false },
      '2026-04-06': { names: { en: 'Easter Monday' }, observed: false },
      '2026-12-28': { names: { en: 'Boxing Day' }, observed: true }      // 节礼日落周六 → 周一替代日
    },
    sct: {
      '2026-01-01': { names: { en: "New Year's Day" }, observed: false },
      '2026-01-02': { names: { en: '2nd January' }, observed: false }    // 苏格兰独有
    },
    nir: {
      '2026-01-01': { names: { en: "New Year's Day" }, observed: false },
      '2026-03-17': { names: { en: "St Patrick's Day" }, observed: false } // 北爱独有
    }
  }
};

test('I1 GB 分域差异: 苏格兰 1/2 休而 E&W 上班;E&W 复活节周一休而苏格兰上班;observed 事实', async () => {
  const eaw = createGbProvider('eaw', GB_TEST_DATA);
  const sct = createGbProvider('sct', GB_TEST_DATA);
  const nir = createGbProvider('nir', GB_TEST_DATA);
  await eaw.load([2026]); await sct.load([2026]); await nir.load([2026]);
  assert.equal(sct.isOffDay('2026-01-02'), true);
  assert.equal(eaw.isOffDay('2026-01-02'), false);
  assert.equal(eaw.isOffDay('2026-04-06'), true);
  assert.equal(sct.isOffDay('2026-04-06'), false);
  assert.equal(nir.isOffDay('2026-03-17'), true);
  assert.equal(eaw.isOffDay('2026-03-17'), false);
  const f = eaw.fact('2026-12-28');
  assert.equal(f.observed, true);                 // gov.uk 替代日 → observed
  assert.equal(f.nominalDate, null);              // 官方 JSON 不含名义日,如实为 null
});

test('I2 GB coverage: 归档命中=bundled,缺失年份=fallback;空归档诚实降级', async () => {
  const eaw = createGbProvider('eaw', GB_TEST_DATA);
  const { rows } = await eaw.load([2026, 2031]);
  assert.equal(rows.find(r => r.year === 2026).mode, 'bundled');
  assert.equal(rows.find(r => r.year === 2031).mode, 'fallback');
  const empty = createGbProvider('sct', { source: 'test', generatedAt: null, divisions: { eaw: {}, sct: {}, nir: {} } });
  const r2 = await empty.load([2026]);
  assert.equal(r2.rows[0].ok, false);
  assert.ok(r2.logs.some(l => l.includes('归档为空')));
});

test('I3 SG provider: 名称/事实/coverage(注入数据,含官方补假日直接存档)', async () => {
  const p = createSgProvider({
    schema: 2, source: 'test', generatedAt: '2026-01-01T00:00:00Z', officialLangs: ['en'], tz: 'Asia/Singapore', ext: {},
    days: {
      '2026-02-17': { names: { en: 'Chinese New Year' } },
      '2026-03-21': { names: { en: 'Hari Raya Puasa' } },
      '2026-03-23': { names: { en: 'Hari Raya Puasa (Observed)' } }
    }
  });
  const { rows } = await p.load([2026, 2031]);
  assert.equal(p.isOffDay('2026-03-21'), true);
  assert.equal(p.fact('2026-02-17').names.en, 'Chinese New Year');
  assert.equal(p.isOffDay('2026-03-23'), true);   // 落周日的官方补假日在清单里,直接存档生效
  assert.equal(rows.find(r => r.year === 2031).mode, 'fallback');
  assert.deepEqual(p.days().map(d => d.date), ['2026-02-17', '2026-03-21', '2026-03-23']);
});

test('I4 hub 分域路由: GB/GB:scotland/GB:ni 各自装载独立数据集且 coverage 标签正确', async () => {
  const hub = await createHolidayHub(['GB', 'GB:scotland', 'GB:ni', 'SG'], [2026]);
  const ds = new Set(hub.coverage.map(c => c.dataset));
  assert.ok(ds.has('GB-EAW') && ds.has('GB-SCT') && ds.has('GB-NIR') && ds.has('SG'));
  const sct = hub.coverage.find(c => c.dataset === 'GB-SCT');
  assert.equal(sct.region, 'GB');
  assert.equal(sct.kind, 'scotland');
  // 归档内容无关断言: 空/满均成立 —— 只验证路由与标签,不验证 ok(首刷后会翻转)
  assert.equal(typeof hub.isWorkday('GB', '2026-06-17'), 'boolean'); // 周三,任何归档状态都可判
});

// ── J. 双模式数据源(默认 bundled 写死;online 活抓、按年覆盖、失败退档)────────
test('J1 online: 活数据整年覆盖归档口径;coverage mode=online', async () => {
  const mockFetch = async (url) => {
    if (String(url).includes('holiday-cn') && String(url).includes('2026.json')) {
      return { ok: true, json: async () => ({ days: [
        { date: '2026-10-01', isOffDay: true, name: '国庆节' },
        { date: '2026-12-30', isOffDay: true, name: '临时新增假(模拟修正案)' }
      ] }) };
    }
    throw new Error('mock down');
  };
  const hub = await createHolidayHub(['CN'], [2026], { dataSource: 'online', fetchImpl: mockFetch });
  assert.equal(hub.isWorkday('CN', '2026-12-30'), false); // 活数据即时生效(周三)
  assert.equal(hub.coverage.find(c => c.dataset === 'CN' && c.year === 2026).mode, 'online');
  assert.equal(hub.isWorkday('CN', '2026-10-10'), false); // 活数据整年替换: 归档里的补班不再存在 → 周六休
});

test('J2 online 抓取失败 → 退用归档(mode=bundled),行为与默认完全一致', async () => {
  const hub = await createHolidayHub(['CN'], [2026], { dataSource: 'online', fetchImpl: async () => { throw new Error('down'); } });
  assert.equal(hub.isWorkday('CN', '2026-10-10'), true); // 归档补班生效
  assert.equal(hub.coverage.find(c => c.dataset === 'CN' && c.year === 2026).mode, 'bundled');
  assert.ok(hub.loadLogs.some(l => l.includes('online') && l.includes('退用归档')));
});

test('J3 非法 dataSource → 告警 + bundled;默认即 bundled', async () => {
  const hub = await createHolidayHub(['CN'], [2026], { dataSource: 'cloud' });
  assert.ok(hub.loadLogs.some(l => l.includes("dataSource 'cloud'")));
  assert.equal(hub.isWorkday('CN', '2026-10-10'), true);
  const hubDefault = await createHolidayHub(['CN'], [2026]);
  assert.equal(hubDefault.coverage.find(c => c.year === 2026).mode, 'bundled');
});

// ── K. 导出器(事实的序列化;订阅端由消费方 Worker 承担)─────────────────────
test('K1 exportIcs: VCALENDAR 结构/CRLF/稳定UID/全天事件/补班前缀/开关', async () => {
  const hub = await createHolidayHub(['CN'], [2026]);
  const ics = exportIcs(hub, 'CN');
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(ics.includes('UID:2026-10-01-CN@workdays-core'));      // 稳定 UID(日期+数据集派生)
  assert.ok(ics.includes('DTSTAMP:20261001T000000Z'));             // 稳定 DTSTAMP(不随生成时刻变)
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261001'));
  assert.ok(ics.includes('DTEND;VALUE=DATE:20261002'));            // 全天事件 DTEND=次日
  assert.ok(ics.includes('SUMMARY:补班 · 国庆节'));                 // 2026-10-10 补班事件
  assert.ok(ics.includes('TRANSP:TRANSPARENT'));
  const noMakeup = exportIcs(hub, 'CN', { includeMakeup: false });
  assert.ok(!noMakeup.includes('补班'));
  assert.ok(exportIcs(hub, 'CN', { calName: '中国假期' }).includes('X-WR-CALNAME:中国假期'));
});

test('K2 exportJson v2: 多语全量信封(HK 真实归档)', async () => {
  const hub = await createHolidayHub(['HK'], [2021]);
  const j = exportJson(hub, 'HKG');
  assert.equal(j.v, 2);
  assert.equal(j.source, 'workdays-core');
  assert.equal(j.region, 'HK');
  assert.equal(j.kind, 'public');
  assert.equal(j.dataset, 'HK');
  assert.deepEqual(j.officialLangs, ['sc', 'tc', 'en']);
  assert.equal(j.tz, 'Asia/Hong_Kong');
  const d = j.days.find(x => x.date === '2021-07-01');
  assert.equal(d.name, '香港特别行政区成立纪念日');
  assert.equal(d.names.sc, '香港特别行政区成立纪念日');
  assert.ok('observed' in d);
});

// ── L. v2.3: 三位码 / 多语解析 / 时区碰撞 / 旧格式容错 ─────────────────────────
test('L1 三位码输入与二位码逐语义等价;canonical 恒为二位', async () => {
  const hub = await createHolidayHub(['CHN', 'HKG'], [2026]);
  assert.equal(hub.isWorkday('CHN', '2026-10-10'), hub.isWorkday('CN', '2026-10-10'));
  assert.equal(hub.fact('CHN:market', '2026-10-10').kind, 'market');
  assert.equal(hub.fact('HKG', '2026-01-01').region, 'HK');
});

test('L2 语言解析: 默认简中优先(含译名);lang 切换;officialLangs 标记官方/译名', async () => {
  const hub = await createHolidayHub(['US'], [2026]);
  const f = hub.fact('USA', '2026-12-25');
  assert.equal(f.name, '圣诞节');                 // 默认链 sc 优先 → 命中译名(方便本地人阅读)
  assert.equal(f.names.en, 'Christmas Day');      // 官方名并存于全量对象
  assert.deepEqual(f.officialLangs, ['en']);      // sc ∉ officialLangs → 消费方可判定 sc 为译名
  const hubEn = await createHolidayHub(['US'], [2026], { lang: 'en' });
  assert.equal(hubEn.fact('USA', '2026-12-25').name, 'Christmas Day');
  const hubTc = await createHolidayHub(['US'], [2026], { lang: 'tc' });
  assert.equal(hubTc.fact('USA', '2026-12-25').name, '聖誕節');
  const hubCnEn = await createHolidayHub(['CN'], [2026], { lang: 'en' });
  assert.equal(hubCnEn.fact('CHN', '2026-10-01').name, 'National Day'); // CN 官方简中 + 英文译名
});

test('L3 时区碰撞: 同一时刻纽约 7/3 vs 中国 7/4;localDateOf 是消费方的"今天"', async () => {
  const hub = await createHolidayHub(['CN', 'US'], [2026]);
  const at = new Date('2026-07-04T02:00:00Z');
  assert.equal(hub.localDateOf('USA', at), '2026-07-03');        // 纽约(EDT)还在 7/3 晚上
  assert.equal(hub.localDateOf('CHN', at), '2026-07-04');        // 中国已是 7/4 上午
  assert.equal(hub.localDateOf('USA:market', at), '2026-07-03'); // NYSE 同纽约
  assert.equal(hub.localDateOf('JP', at), '2026-07-04');         // 未知地区 → UTC 日期
  // 守则用法: "纽约此刻是不是银行工作日" —— 7/3 为 observed 假日
  assert.equal(hub.isWorkday('USA', hub.localDateOf('USA', at)), false);
});

test('L4 导出多语: lang 参数、本地化补班前缀、v2 信封字段', async () => {
  const hub = await createHolidayHub(['CN', 'US'], [2026]);
  assert.ok(exportIcs(hub, 'USA', { lang: 'en' }).includes('SUMMARY:Christmas Day'));
  assert.ok(exportIcs(hub, 'USA').includes('SUMMARY:圣诞节'));
  assert.ok(exportIcs(hub, 'CHN', { lang: 'en' }).includes('Makeup workday · National Day'));
  assert.ok(exportIcs(hub, 'CHN', { lang: 'tc' }).includes('補班 · 國慶節'));
  const j = exportJson(hub, 'CHN', { lang: 'en' });
  assert.equal(j.v, 2);
  assert.equal(j.tz, 'Asia/Shanghai');
  assert.deepEqual(j.officialLangs, ['sc']);
  const d = j.days.find(x => x.date === '2026-10-01');
  assert.equal(d.name, 'National Day');
  assert.equal(d.names.sc, '国庆节');
});

test('L5 旧格式容错: v2.2 字符串/{name,observed} 条目读取归一(迁移期每步可部署)', async () => {
  const legacySg = createSgProvider({ source: 't', generatedAt: null, days: { '2026-08-09': 'National Day' } });
  await legacySg.load([2026]);
  assert.equal(legacySg.fact('2026-08-09').names.en, 'National Day'); // legacyLang=en 归一
  assert.deepEqual(legacySg.officialLangs, ['en']);                   // 旧文件缺 officialLangs → 退 legacyLang
  const legacyGb = createGbProvider('eaw', { source: 't', generatedAt: null, divisions: { eaw: { '2026-12-28': { name: 'Boxing Day', observed: true } }, sct: {}, nir: {} } });
  await legacyGb.load([2026]);
  const f = legacyGb.fact('2026-12-28');
  assert.equal(f.names.en, 'Boxing Day');
  assert.equal(f.observed, true);
});

// ── M. 数据最小化档(只有日期;名称/多语/observed 全是增量修饰)────────────────
test('M1 最小档: null/{} 条目 → 判定/coverage/fact 全链路可用,name 如实为 null', async () => {
  const p = createSgProvider({
    schema: 2, source: 'minimal-test', generatedAt: null, officialLangs: [],
    days: { '2026-02-11': null, '2026-11-03': {} }
  });
  const { rows } = await p.load([2026, 2031]);
  assert.equal(p.isOffDay('2026-02-11'), true);      // 判定只需日期
  assert.equal(rows.find(r => r.year === 2026).mode, 'bundled');
  assert.equal(rows.find(r => r.year === 2031).mode, 'fallback');
  const f = p.fact('2026-11-03');
  assert.equal(f.isHoliday, true);
  assert.deepEqual(f.names, {});                     // 无名如实为空,不发明数据
  assert.equal(f.observed, false);
});
