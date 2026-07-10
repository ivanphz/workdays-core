// ==============================================================================
// 🧪 workdays-core 测试 — 全离线(fetchImpl 注入,零联网),node --test 直跑
// ==============================================================================
// 分组:
//   A. token 解析与别名归一(唯一别名表)
//   B. CN 三态 + bank/market 双口径(金标准: 与 reminder-hub 原行为逐语义等价)
//   C. US 联邦 vs NYSE 双日历双向差异(GoodFriday/Columbus/元旦落周六例外)+ observed 事实
//   D. HK 解析(名称/折行)+ 别名等价
//   E. 多国叠加 / 默认 ['CN'] / 未知国家兜底 / 'US:market' 未加载退化(兼容钉子)
//   F. listDays legacy 形状(alarm-api 迁移契约)
//   G. coverage / isCovered(权威 vs 兜底如实上报)
//   H. 输入形态: Date(UTC 读) 与 'YYYY-MM-DD' 等价
// ==============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHolidayHub, parseToken } from '../src/index.js';

// ── 离线 fetch 路由: 按 URL 特征返回 mock 数据 ────────────────────────────────
// CN 2026 mock(子集即可,语义齐全): 国庆放假 + 10-10 补班周六 + 元旦
const CN_2026 = {
  days: [
    { date: '2026-01-01', isOffDay: true,  name: '元旦' },
    { date: '2026-10-01', isOffDay: true,  name: '国庆节' },
    { date: '2026-10-10', isOffDay: false, name: '国庆节' } // 补班周六(2026-10-10 为周六)
  ]
};

// HK mock ics: 两个假期,其中一个 SUMMARY 折行(RFC5545: CRLF + 空白 续行)
const HK_ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20260101',
  'SUMMARY:The first day of January',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20260217',
  'SUMMARY:Lunar New Year',
  " 's Day",  // ← 折行续行(行首一个空格)
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

function mockFetch({ cnFailYears = [] } = {}) {
  return async (url) => {
    const u = String(url);
    if (u.includes('holiday-cn')) {
      const year = /(\d{4})\.json/.exec(u)?.[1];
      if (cnFailYears.includes(+year)) throw new Error('mock network down');
      if (year === '2026') return { ok: true, json: async () => CN_2026 };
      return { ok: false }; // 其它年份: 源上没有 → 走 fallback 路径
    }
    if (u.includes('1823.gov.hk')) {
      return { ok: true, text: async () => HK_ICS };
    }
    throw new Error('unexpected fetch: ' + u);
  };
}

const hubOf = (tokens, years, opts = {}) =>
  createHolidayHub(tokens, years, { fetchImpl: mockFetch(opts.mock), ...opts });

// ── A. token 解析 ─────────────────────────────────────────────────────────────
test('A1 别名归一: official→bank, HK 全别名→public, 未知kind→null, 未知国家 known:false', () => {
  assert.deepEqual(parseToken('CN:official'), { region: 'CN', kind: 'bank', known: true });
  assert.deepEqual(parseToken('US:market'),   { region: 'US', kind: 'market', known: true });
  assert.equal(parseToken('HK:market').kind, 'public');
  assert.equal(parseToken('HK:official').kind, 'public');
  assert.equal(parseToken('CN:banana').kind, null);   // 未识别 kind = 未指定(旧行为)
  assert.equal(parseToken('GB').known, false);
});

// ── B. CN 三态 + 双口径 ───────────────────────────────────────────────────────
test('B1 CN bank: 法定假=休, 补班周六=上班, 无记录=按周末', async () => {
  const hub = await hubOf(['CN'], [2026]);
  const w = hub.makeWorkdayChecker(['CN']);
  assert.equal(w('2026-10-01'), false); // 国庆 → 休
  assert.equal(w('2026-10-10'), true);  // 补班周六 → 上班(bank 口径)
  assert.equal(w('2026-07-01'), true);  // 无记录的周三 → 工作日
  assert.equal(w('2026-10-17'), false); // 无记录的普通周六 → 休
});

test('B2 CN market: 补班标记不作数(周末照休);token 级优先于全局默认', async () => {
  const hub = await hubOf(['CN'], [2026]);
  assert.equal(hub.makeWorkdayChecker(['CN:market'])('2026-10-10'), false); // 补班周六 → market 休
  assert.equal(hub.makeWorkdayChecker(['CN:market'])('2026-10-01'), false); // 法定假两口径一致
  // 全局默认 market 时, 裸 'CN' 走 market;显式 'CN:bank' 仍上班
  const hubM = await hubOf(['CN'], [2026], { cnDefaultRule: 'market' });
  assert.equal(hubM.cnDefaultRule, 'market');
  assert.equal(hubM.makeWorkdayChecker(['CN'])('2026-10-10'), false);
  assert.equal(hubM.makeWorkdayChecker(['CN:bank'])('2026-10-10'), true);
  // 'official' 作为入参别名 → 归一为 bank
  const hubO = await hubOf(['CN'], [2026], { cnDefaultRule: 'official' });
  assert.equal(hubO.cnDefaultRule, 'bank');
});

test('B3 CN fact: 补班日 isMakeup:true 且两 kind 事实相同(分岔在结论层)', async () => {
  const hub = await hubOf(['CN'], [2026]);
  const fBank = hub.fact('CN', '2026-10-10');
  const fMkt  = hub.fact('CN:market', '2026-10-10');
  assert.equal(fBank.isMakeup, true);
  assert.equal(fBank.isHoliday, false);
  assert.equal(fBank.name, '国庆节');
  assert.equal(fMkt.isMakeup, true); // 事实层一致
  assert.equal(hub.fact('CN', '2026-07-01'), null); // 无记录 → null
});

// ── C. US 联邦 vs NYSE ───────────────────────────────────────────────────────
test('C1 双向差异: GoodFriday 银行开/NYSE休;Columbus 银行休/NYSE开', async () => {
  const hub = await hubOf(['US', 'US:market'], [2026]);
  // 2026 复活节=4/5 → Good Friday = 2026-04-03(周五)
  assert.equal(hub.makeWorkdayChecker(['US'])('2026-04-03'), true);          // 银行开
  assert.equal(hub.makeWorkdayChecker(['US:market'])('2026-04-03'), false);  // NYSE 休
  // Columbus Day 2026-10-12(10月第2个周一)
  assert.equal(hub.makeWorkdayChecker(['US'])('2026-10-12'), false);         // 银行休
  assert.equal(hub.makeWorkdayChecker(['US:market'])('2026-10-12'), true);   // NYSE 开
  // Veterans Day 2026-11-11(周三)
  assert.equal(hub.makeWorkdayChecker(['US'])('2026-11-11'), false);
  assert.equal(hub.makeWorkdayChecker(['US:market'])('2026-11-11'), true);
});

test('C2 observed 事实: 7/4 落周六 → 7/3 observed 休且带 nominalDate', async () => {
  // 前置自检: 2026-07-04 确为周六
  assert.equal(new Date('2026-07-04T00:00:00Z').getUTCDay(), 6);
  const hub = await hubOf(['US'], [2026]);
  const f = hub.fact('US', '2026-07-03');
  assert.equal(f.isHoliday, true);
  assert.equal(f.observed, true);
  assert.equal(f.nominalDate, '2026-07-04');
  assert.equal(f.name, 'Independence Day');
  assert.equal(hub.fact('US', '2026-07-04').observed, false); // 名义日本身 observed:false
  assert.equal(hub.makeWorkdayChecker(['US'])('2026-07-03'), false);
});

test('C3 元旦落周六的 NYSE 例外: 2028-01-01 为周六 → 银行 2027-12-31 休, NYSE 照常开市', async () => {
  assert.equal(new Date('2028-01-01T00:00:00Z').getUTCDay(), 6); // 前置自检
  const hub = await hubOf(['US', 'US:market'], [2027, 2028]);
  // 银行: 2027-12-31(周五) observed 休
  assert.equal(hub.makeWorkdayChecker(['US'])('2027-12-31'), false);
  assert.equal(hub.fact('US', '2027-12-31').observed, true);
  // NYSE: 例外规则, 12-31 是当月最后交易日 → 不补休, 照常开市
  assert.equal(hub.makeWorkdayChecker(['US:market'])('2027-12-31'), true);
  assert.equal(hub.fact('US:market', '2027-12-31'), null);
});

// ── D. HK ────────────────────────────────────────────────────────────────────
test('D1 HK: 日期+名称解析(含折行), 别名口径等价', async () => {
  const hub = await hubOf(['HK'], [2026]);
  assert.equal(hub.makeWorkdayChecker(['HK'])('2026-01-01'), false);
  const f = hub.fact('HK', '2026-02-17');
  assert.equal(f.isHoliday, true);
  assert.equal(f.name, "Lunar New Year's Day"); // 折行已正确反折叠
  // HK:market / HK:official ≡ HK(等价别名,受测试看守 —— 沿袭原项目 H 组钉子)
  for (const tok of ['HK:market', 'HK:official', 'HK:bank', 'HK:public']) {
    assert.equal(hub.makeWorkdayChecker([tok])('2026-01-01'), false, tok);
    assert.equal(hub.makeWorkdayChecker([tok])('2026-01-02'), true, tok); // 周五工作日
  }
});

// ── E. 叠加/默认/兜底/退化 ───────────────────────────────────────────────────
test('E1 多国叠加: 任一腿休即休;空列表默认 [CN]', async () => {
  const hub = await hubOf(['CN', 'US'], [2026]);
  // 2026-07-03: CN 正常周五(工作), US observed 休 → 叠加 = 休
  assert.equal(hub.makeWorkdayChecker(['CN', 'US'])('2026-07-03'), false);
  assert.equal(hub.makeWorkdayChecker(['CN'])('2026-07-03'), true);
  // 空/缺省 → ['CN']
  assert.equal(hub.makeWorkdayChecker([])('2026-10-01'), false);
  assert.equal(hub.makeWorkdayChecker()('2026-10-10'), true);
  // isWorkday 便捷单发
  assert.equal(hub.isWorkday('CN', '2026-10-01'), false);
  assert.equal(hub.isWorkday(['CN', 'US'], '2026-07-03'), false);
});

test('E2 未知国家: 告警 + 周末兜底(不抛错)', async () => {
  const hub = await hubOf(['GB'], [2026]);
  assert.ok(hub.loadLogs.some(l => l.includes('GB')));
  const w = hub.makeWorkdayChecker(['GB']);
  assert.equal(w('2026-01-02'), true);  // 周五
  assert.equal(w('2026-01-03'), false); // 周六
});

test('E3 兼容钉子: hub 未加载 NYSE 时, US:market 退用联邦数据(旧行为)', async () => {
  const hub = await hubOf(['US'], [2026]); // 创建时只有 'US' → 不加载 US-NYSE
  // Columbus: NYSE 本应开市, 但退化到联邦集合 → 判休(与原实现一致)
  assert.equal(hub.makeWorkdayChecker(['US:market'])('2026-10-12'), false);
});

// ── F. listDays legacy 形状(alarm-api 契约)──────────────────────────────────
test('F1 listDays(CN): 与 holiday-cn days[] 同形同序, 含补班日与名称', async () => {
  const hub = await hubOf(['CN'], [2026]);
  assert.deepEqual(hub.listDays('CN'), [
    { date: '2026-01-01', isOffDay: true,  name: '元旦' },
    { date: '2026-10-01', isOffDay: true,  name: '国庆节' },
    { date: '2026-10-10', isOffDay: false, name: '国庆节' }
  ]);
});

test('F2 listDays(US): 仅假期(isOffDay 全 true), 无补班概念', async () => {
  const hub = await hubOf(['US'], [2026]);
  const days = hub.listDays('US');
  assert.ok(days.length >= 11);
  assert.ok(days.every(d => d.isOffDay === true && typeof d.name === 'string'));
  assert.ok(days.some(d => d.date === '2026-07-03')); // observed 日也在集合内
});

// ── G. coverage / isCovered ──────────────────────────────────────────────────
test('G1 coverage: CN 拿到数据=authoritative;拿不到的年份=fallback 且 isCovered=false', async () => {
  const hub = await hubOf(['CN'], [2026, 2031]); // mock 只有 2026
  const c26 = hub.coverage.find(c => c.dataset === 'CN' && c.year === 2026);
  const c31 = hub.coverage.find(c => c.dataset === 'CN' && c.year === 2031);
  assert.equal(c26.ok, true);
  assert.equal(c26.mode, 'authoritative');
  assert.equal(c31.ok, false);
  assert.equal(c31.mode, 'fallback');
  assert.equal(hub.isCovered('CN', '2026-05-01'), true);
  assert.equal(hub.isCovered('CN', '2031-05-01'), false);
});

test('G2 coverage: 算法类(US/NYSE)=computed;HK 超出 feed 覆盖的年份如实报 fallback', async () => {
  const hub = await hubOf(['US', 'US:market', 'HK'], [2026, 2031]);
  assert.ok(hub.coverage.filter(c => c.dataset === 'US').every(c => c.mode === 'computed' && c.ok));
  assert.ok(hub.coverage.some(c => c.dataset === 'US-NYSE' && c.kind === 'market'));
  assert.equal(hub.isCovered('HK', '2026-06-01'), true);
  assert.equal(hub.isCovered('HK', '2031-06-01'), false); // mock feed 无 2031
});

test('G3 CN 网络全挂: loadLogs 有告警, checker 降级为纯周末(不抛错)', async () => {
  const hub = await hubOf(['CN'], [2026], { mock: { cnFailYears: [2026] } });
  assert.ok(hub.loadLogs.some(l => l.includes('FAILED')));
  const w = hub.makeWorkdayChecker(['CN']);
  assert.equal(w('2026-10-01'), true);  // 数据缺失: 国庆(周四)误判为工作日 —— 这正是 coverage 存在的意义
  assert.equal(hub.isCovered('CN', '2026-10-01'), false);
});

// ── H. 输入形态 ──────────────────────────────────────────────────────────────
test('H1 Date(UTC) 与字符串输入等价', async () => {
  const hub = await hubOf(['CN'], [2026]);
  const w = hub.makeWorkdayChecker(['CN']);
  assert.equal(w(new Date('2026-10-10T00:00:00Z')), w('2026-10-10'));
  assert.equal(w(new Date('2026-10-01T00:00:00Z')), false);
});
