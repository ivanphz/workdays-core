# workdays-core

多国工作日/假期**事实引擎**。一个 npm 库(发布在 GitHub Packages),被 `alarm-api` 与 `calendar-api` 共同引用 —— 两个项目原本各自维护的假期抓取/推算代码,合并后的**单一真相源**。v2 起运行时**零联网**:数据打包内置,由每日流水线维护。

## 架构:数据集插件化(v3)

一国 = 一个自包含文件夹 `src/datasets/<两位码>/`(清单 + 数据 + 读取 provider + 抓取 fetch + 译名),
中心只负责发现与容错装载。**加新国 = 放一个文件夹 + `_loader.js` 注册一行**,中心代码零改动;
某数据集损坏(数据语法错/清单不合规/抓取崩溃)被装载器**自动隔离**,不影响已有国家。
拿 `docs/DATASET-GUIDE.md` + 一个官方源地址交给 AI,即可生成完整数据集文件夹。

## 四条铁律(动手改代码前先读)

1. **库,不是服务。** 只导出纯函数,消费方 `import` 后进程内现算。永不提供 HTTP 端点、永不输出 JSON 结果 —— 消费方(尤其 alarm-api)有 5 秒超时预算,网络往返纯亏。
2. **事实,不是结论。** provider 只吐原始事实(`isHoliday / isMakeup / name / observed / coverage`);"这天是不是工作日"由消费方按 kind 口径现算。`makeWorkdayChecker` 只是把最常用的结论算法顺手提供。
3. **只装公共世界。** CN/HK/US 各口径是关于世界的客观事实,谁都能用、甚至能开源。任何私有日历、请假判定、个人作息语义**永不进入本包**(它们住在 alarm-api;将来若有第二消费者,抽独立私有包,也不进这里)。
4. **region×kind 模型。** "工作日"= (国家, 口径) → 布尔,不是 国家 → 布尔。口径表全库唯一一处(`src/tokens.js`)。

## 口径一览(一词一义,无别名;主写法三位码,二位码永久等价)

| token(alpha-3 主写法) | 等价二位码 | 数据集 | 含义 |
|---|---|---|---|
| `CHN` / `CHN:bank` | `CN` | CN | 国务院法定调休口径:法定假=休、补班周末=上班(官方简中) |
| `CHN:market` | `CN:market` | CN | A股/清算口径:补班不作数(同数据,结论层分岔) |
| `HKG` / `HKG:public` | `HK` | HK | 香港公众假期(三语 sc/tc/en 皆官方,2018 起十年存档) |
| `USA` / `USA:bank` | `US` | US | 美国联邦/银行,11 假日+observed 顺延(纯算法) |
| `USA:market` | `US:market` | US-NYSE | NYSE 交易日历(GoodFriday 休;Columbus/Veterans 开;纯算法) |
| `GBR` / `GBR:england` | `GB` | GB-EAW | 英格兰+威尔士 bank holiday(伦敦证交所≈E&W,不设 market) |
| `GBR:scotland` / `GBR:ni` | `GB:...` | GB-SCT / GB-NIR | 苏格兰 / 北爱分域(三分治域假期互不相同) |
| `SGP` / `SGP:public` | `SG` | SG | 新加坡公众假期(公历+农历+伊斯兰历+印度历混排) |

内部 canonical 恒为 alpha-2(`fact.region` / coverage / 数据集键),全称永不参与匹配、
只在 `REGION_META` 里作输出信息(alpha2/alpha3/多语全称/代表时区)。

v1 的别名(`official` 等)已全部移除。写错/写旧口径不报错,但会在 `loadLogs` **告警**并按该国默认口径处理;"数据集未加载"同样告警并按纯周末兜底 —— 响亮降级,配置错误绝不静默吞掉。

## 多语名称:官方归档 + 译名表,标记分明

- 归档 `names` 只存**官方发布**的语言(HK 三语皆官方全收;大陆无官方繁体就没有 tc 键);谁是官方由数据文件的 `officialLangs` **数组**声明(可多个)。
- 译名住 `src/data/translations.js`(人的领地,人工/AI 维护),运行时在 hub 层合并,同键官方必胜。**判官方/译名只看一条:`lang ∈ officialLangs ?`**
- 单名解析:`opts.lang` 指定;缺省走铁律回落链 **sc > tc > en > 官方首语言**(方便本地人阅读——US 圣诞默认解析为"圣诞节",`names.en` 里官方名并存)。

## 双模式数据源(默认本地写死)

`createHolidayHub(tokens, years, { dataSource })`:`'bundled'`(默认)查打包归档,零联网;`'online'`(可选)运行时活抓上游,**活数据按年覆盖归档、抓取失败退用归档 —— 永不比默认差**,coverage 相应报 `online`。抓取与解析逻辑与流水线共用 `src/sources.js`,单点修改。

## 导出与订阅(JSON / ICS)

`exportJson(hub, token)` 输出假期清单 JSON 信封;`exportIcs(hub, token, opts)` 输出可导入/可订阅的 ICS(全天事件、CRLF、稳定 UID/DTSTAMP、CN 补班日带 `补班 · ` 前缀,`includeMakeup:false` 可关)。两者都是纯函数(事实的序列化)——订阅端点由消费方用极小的 Worker 承担(现成片段见 INTEGRATION.md),core 本身仍不是服务。

## 数据与流水线(默认零联网)

CN/HK 数据打包内置于 `src/data/*.data.js`,**勿手改**,由 `.github/workflows/refresh-data.yml` 每日抓取上游(holiday-cn / 1823.gov.hk ical)、数据真变才提交并自动 patch 发版,顺升级链自动部署到下游。归档铁律:**只增不删** —— HK 的官方 feed 是滚动窗口(只给今明两年),本仓库即唯一历史存档。数据出错用 `rollback.yml` 一键恢复到任意历史 tag 并前滚发版。

## 30 秒上手

```js
import { createHolidayHub } from '@ivanphz/workdays-core';

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

// 覆盖度: false = 该年份不在归档,正在按周末兜底,结果不可全信
hub.isCovered('CN', '2031-05-01');
hub.coverage;         // 结构化明细 [{dataset, region, kind, year, ok, mode, source}]
```

## 时区碰撞守则

数据存**当地民用日期**,库内永不做时刻换算;"今天"因时区而异(同一时刻纽约 7/3、北京 7/4)。
跨时区提问先取当地日期:`hub.isWorkday('USA:market', hub.localDateOf('USA:market'))`。

## 文档地图

| 文档 | 给谁看 | 内容 |
|---|---|---|
| `docs/DATASET-GUIDE.md` | **要新增国家的人或 AI** | 数据集插件的整体结构与契约、输入输出两分总纲、换源实操、AI 生成任务模板、故障隔离 |
| `docs/DATA-FORMAT.md` | 数据文件本身的格式 | schema 2 字段表、最小档、AI 数据文件生成手册、取值指南、预留字段 |
| `docs/INTEGRATION.md` | **alarm-api / calendar-api 两个项目** | 一次性准备、API 速查、接入手册、自动升级链路、升级须知、数据流水线与回滚 runbook、坑清单 |
| `docs/DEVLOG.md` | 未来改进本包的人(包括未来的我) | 各版本设计思路与决策记录、兼容承诺、发版规则、路线图 |

## 测试

```
npm test        # node --test,全离线零 mock 网络(CN 断言真实公告归档,HK 走 provider 注入)
```

金标准测试钉死了:CN 三态双口径(真实调休数据)、年桶跨年边界、US 联邦/NYSE 双向差异(含元旦落周六的 NYSE 例外)、observed 事实、HK 空归档诚实降级、ICS 折行解析、多国叠加、响亮降级(非法口径/未加载数据集)、coverage 如实上报。改核心逻辑前先看 `test/core.test.mjs`。
