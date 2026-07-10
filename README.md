# workdays-core

多国工作日/假期**事实引擎**。一个 npm 库(发布在 GitHub Packages),被 `alarm-api` 与 `reminder-hub` 共同引用 —— 两个项目原本各自维护的假期抓取/推算代码,合并后的**单一真相源**。

## 四条铁律(动手改代码前先读)

1. **库,不是服务。** 只导出纯函数,消费方 `import` 后进程内现算。永不提供 HTTP 端点、永不输出 JSON 结果 —— 消费方(尤其 alarm-api)有 5 秒超时预算,网络往返纯亏。
2. **事实,不是结论。** provider 只吐原始事实(`isHoliday / isMakeup / name / observed / coverage`);"这天是不是工作日"由消费方按 kind 口径现算。`makeWorkdayChecker` 只是把最常用的结论算法顺手提供。
3. **只装公共世界。** CN/HK/US 各口径是关于世界的客观事实,谁都能用、甚至能开源。任何私有日历、请假判定、个人作息语义**永不进入本包**(它们住在 alarm-api;将来若有第二消费者,抽独立私有包,也不进这里)。
4. **region×kind 模型。** "工作日"= (国家, 口径) → 布尔,不是 国家 → 布尔。别名表全库唯一一处(`src/tokens.js`)。

## 口径一览

| token | 数据集 | 含义 | 数据来源 |
|---|---|---|---|
| `CN` / `CN:bank` / `CN:official` | CN | 国务院法定调休口径:法定假=休、补班周末=上班 | holiday-cn(3 镜像,联网) |
| `CN:market` | CN | A股/清算口径:补班不作数,周末一律休 | 同上(同数据,结论层分岔) |
| `HK`(bank/market/official 全为等价别名) | HK | 香港公众假期 | 1823.gov.hk 官方 ics(联网) |
| `US` / `US:bank` / `US:official` | US | 美国联邦/银行,11 假日+observed 顺延 | 纯算法,零联网 |
| `US:market` | US-NYSE | NYSE 交易日历(GoodFriday 休;Columbus/Veterans 开) | 纯算法,零联网 |

## 30 秒上手

```js
import { createHolidayHub } from '@OWNER/workdays-core';

const hub = await createHolidayHub(['CN', 'US:market'], [2026, 2027]);

// 结论层: 多国叠加(全是工作日才算工作日)
const isWorkday = hub.makeWorkdayChecker(['CN', 'US:market']);
isWorkday('2026-10-10');                 // true  — 补班周六,CN bank 上班
hub.isWorkday('CN:market', '2026-10-10'); // false — 同一天,A股休市

// 事实层: 原始记录(消费方自己下结论用)
hub.fact('US', '2026-07-03');
// → { isHoliday:true, observed:true, nominalDate:'2026-07-04', name:'Independence Day', ... }

// legacy 适配: 与 holiday-cn days[] 同形,alarm-api 零改造迁移
hub.listDays('CN');   // [{date, isOffDay, name}, ...]

// 覆盖度: false = 该年份没拿到权威数据,正在按周末兜底,结果不可全信
hub.isCovered('CN', '2031-05-01');
hub.coverage;         // 结构化明细 [{dataset, region, kind, year, ok, mode, source}]
```

## 文档地图

| 文档 | 给谁看 | 内容 |
|---|---|---|
| `docs/INTEGRATION.md` | **alarm-api / reminder-hub 两个项目** | 一次性准备(PAT/Secrets/首发)、API 速查、两个项目各自的逐步接入手册、自动升级链路、坑清单 |
| `docs/DEVLOG.md` | 未来改进本包的人(包括未来的我) | 本次迭代的设计思路与决策记录、兼容承诺、怎么加新日历、发版规则、路线图 |

## 测试

```
npm test        # node --test,全离线(fetchImpl 注入),不依赖任何外网
```

金标准测试钉死了:CN 三态双口径、US 联邦/NYSE 双向差异(含元旦落周六的 NYSE 例外)、observed 事实、HK 折行解析、多国叠加、`US:market` 未加载时的退化行为、coverage 如实上报。改核心逻辑前先看 `test/core.test.mjs`。
