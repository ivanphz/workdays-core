# DEVLOG.md — workdays-core 迭代思路与决策记录

> **这份文档给谁看**:未来要改进/扩展本包的人(包括未来的我和未来的 AI 会话)。
> 记录 v1.0.0 这次迭代"为什么长这样",让后续改动不违背初衷、不重蹈覆辙。
> 对接操作看 `docs/INTEGRATION.md`,本文只讲设计。

---

## 0. 背景:这个包为什么存在

`alarm-api`(iOS 闹钟网关)与 `reminder-hub`(信用卡/签到提醒)各自维护了一套
中国节假日抓取代码 —— **同一个数据源(NateScarlet/holiday-cn)、同三个镜像、
两份实现**。"一个改了另一个忘了改"是真实风险,不是洁癖。
本包把"工作日/假期"这块世界事实抽成两个项目共同 import 的单一真相源。

同时明确**不做**什么:两个 Worker 服务本身不合并、不打散 —— 它们已通过
`?format=json` 外部闹钟协议(同一 schema、同一 uid 规则)相连,拓扑保持现状。

---

## 1. 四条设计公理(动核心逻辑前先对照)

| # | 公理 | 一句话 | 违背它的典型歪路 |
|---|---|---|---|
| 1 | **库,不是服务** | 只导出纯函数,消费方进程内现算 | 给 core 加 HTTP 端点/让它输出 JSON 结果。alarm-api 有 5 秒预算、getBlockLength 双向扫 14 天,网络往返纯亏;且"输出结果"意味着 core 得先懂消费者意图,业务逻辑倒灌 |
| 2 | **事实,不是结论** | provider 吐原始事实,"是否工作日"由消费方按 kind 现算 | 让 provider 直接返回 `isWorkday` 布尔。补班周六在 bank/market 下答案相反,结论必须带口径,事实层不许预判 |
| 3 | **只装公共世界** | CN/HK/US 各口径 = 客观世界事实,谁都能用 | 把家庭日历/请假判定/休息块塞进 core(哪怕用 `private-me` 字段控制)。私有语义带主体、带秘密 URL、易变,进公共层 = 逻辑集中化。它住在 alarm-api;将来若有第二消费者,抽**独立私有包**,也不进这里 |
| 4 | **region×kind 二维模型** | 工作日 = (国家, 口径) → 布尔 | 用 `CN` 一维 token 硬扛,再靠 if 特判 market。kind 是一等公民,别名表全库唯一一处(`src/tokens.js`) |

`makeWorkdayChecker` 看似违背公理 2,实为"最常用结论算法顺手提供"——
它建立在事实层之上,消费方随时可以绕开它只拿 fact 自己算。

---

## 2. v1.0.0 字段与命名决策记录

### 2.1 `observed` + `nominalDate`:为什么名义日、顺延日两天都标休

美国固定日期假日(7/4、12/25、1/1、6/19、11/11)落周末时,银行按 observed 日
(周六→前周五、周日→后周一)休。本包对**两天都出记录**:

- 名义日:`{observed:false, nominalDate:null}` —— 很多机构名义日当天也关,还款判定标休是安全侧;
- 顺延日:`{observed:true, nominalDate:'名义日'}` —— 提前量计算/提醒文案需要知道"这天休的其实是哪个节"。

这与 reminder-hub 原实现的**日期集合逐日等价**(测试钉死),增量只是元数据。
冲突消解:同一天既是某节真实日又是另一节顺延日时,**非 observed 记录优先**(真实身份 > 顺延身份)。

### 2.2 `coverage`:粒度为什么是"数据集 × 年"

- 太粗(整 hub 一个布尔):CN 2026 拿到了、2031 没拿到,一个布尔说不清;
- 太细(逐日 confidence):每次 lookup 附带元数据,API 变重,而消费方真正的问题是
  "这年的数据可信吗",按年问一次就够。

三种 mode:`authoritative`(联网源拿到)/ `computed`(算法生成,US/NYSE)/
`fallback`(该年没数据,正在按纯周末猜)。`isCovered=false` 就是"结果不可全信"的信号 ——
G3 测试特意钉了一个反直觉案例:CN 网络全挂时国庆(周四)会被误判为工作日,
这正是 coverage 存在的意义。

### 2.3 CN 口径为什么叫 `bank` 不叫 `official`

中国的"银行假日"就是国务院发布的法定调休日历,两个词指同一套东西。
选 `bank` 做 canonical 是为将来留路:若加民族/地方日历(新疆、西藏地方假),
那些也是"official 法定"的,`official` 一词会产生歧义;`bank` 语义更窄更稳。
`official` 保留为**永久别名**(reminder-hub 的 `?cnRule=official` 与配置里的
`CN:official` token 照常工作),归一化只发生在 tokens.js 一处。
**⚠️ 已被 v2 推翻**:别名全部移除,一词一义,见 §9 决策 1。

### 2.4 公共数据源 URL 硬编码(已拍板)

CN 三镜像、HK 1823.gov.hk 都是公共不敏感地址,硬编码进 provider。
换源 = 改 core 一处 + 发 patch,两个下游零改动自动跟上 —— 这正是合并的收益本体。
(私有 URL 与本条无关:它们压根不进 core,见公理 3。)

### 2.5 kind 开放枚举 + provider 注册制

`src/index.js` 的 `PROVIDER_FACTORIES` 就是注册表,内有 `GB` / `CN-XJ` 注释示例位。
"结构容纳、现在不实现"(已拍板):民族/地方日历将来 = 新 provider 文件 + 注册一行 +
tokens.js 表一行,别处不动。

---

## 3. 兼容承诺(对 reminder-hub 的逐语义等价清单)

> **⚠️ v1 时点的承诺**:其中第 3 条(US:market 退用联邦)、第 5 条(HK 别名)已被 v2 **有意打破**,见 §9。

`createHolidayHub(tokens, years, {cnDefaultRule})` 与原 `src/holidays/index.js` 等价,含:

1. 空 tokens 列表 → 默认 `['CN']`;
2. 未知国家(如 `GB`)→ loadLogs 告警 + 纯周末兜底,不抛错;
3. `US:market` 请求但 NYSE 数据集未加载(建 hub 时没给 `US:market` token)→ 退用联邦数据集(旧行为,E3 测试钉死);
4. CN 三态:`true`=放假 / `false`=补班上班(bank)或不作数(market)/ `undefined`=周末兜底;
5. HK 的 `:bank/:market/:official` 全为等价别名;
6. NYSE 元旦落周六例外(12/31 照常开市)、±1 年冗余扩展。

**两处刻意增强(行为超集,记录在案):**

- HK provider 顺带解析 SUMMARY 假期名(fact.name 需要;原实现只有日期)。块解析
  一无所获时回退原版整文正则,健壮性只增不减。
- checker 对 `Date` 输入按 **UTC** 读取(原实现用本地 getter;Workers 运行时本地=UTC,
  生产行为不变,好处是任何时区的 Node 测试环境结果一致)。字符串输入按字面日期。

**跨年 observed 边界规则**(沿袭原行为,非 bug):"次年元旦落周六 → 本年 12/31 休"
这条记录由**加载次年**产生。窗口跨年就把两个年份都传给 `createHolidayHub` ——
reminder-hub 现有调用天然满足;alarm-api 迁移配方里 years 已含昨/今/明三日的年份。

---

## 4. 怎么加一个新日历(七步清单)

以"英国银行假日 GB"或"新疆地方假 CN:xinjiang"为例:

1. `src/providers/xx.js`:实现统一 provider 契约
   `{ dataset, load(years,{fetchImpl})→{rows,logs}, fact(d), isOffDay(d), days(), [lookup(d)仅三态源] }`;
2. `src/tokens.js`:CANONICAL 表加 region 或 kind 行(含默认 kind 与全部别名);
3. `src/tokens.js` 的 `datasetOf`:若新 kind 对应独立数据集(如 US:market → US-NYSE 模式),加映射;
4. `src/index.js` 的 `PROVIDER_FACTORIES`:注册一行;若是"附加数据集"型 kind,在
   wanted 推导处仿照 `US:market` 加一行;
5. `test/core.test.mjs`:新增分组 —— 至少覆盖别名归一、金标准日期、coverage mode、
   与相邻口径的差异钉子;
6. `README.md` 口径表 + `docs/INTEGRATION.md` token 表各加一行;
7. Release 发 **minor**。

数据源选择原则(从 CN/HK/US 三个先例总结):纯规则可推算 → 算法生成零联网(US 模式);
含农历/不可推算 → 官方机器可读源 + 镜像/代理兜底(CN/HK 模式)。绝不用混入民间节日的
通用 ics(苹果日历源的教训)。

---

## 5. 发版规则(semver 对照表)

| 改动类型 | 级别 | 例子 |
|---|---|---|
| 换/加数据源镜像、修 bug、文档、日志措辞 | patch | jsdelivr 挂了换 CDN |
| 新增 region、新增 kind、新增 hub 方法、Fact **新增**字段 | minor | 加 GB;fact 加 `lunarDate` |
| Fact 字段删除/改名/语义变、`createHolidayHub` 签名变、checker 行为变 | **major** | isMakeup 改名;默认 kind 换 |

配套动作:major 必须同步更新 INTEGRATION.md §3 API 速查与 §9 兼容承诺;
`CORE_PROTOCOL`(src/index.js 导出)在 Fact 破坏性变更时 +1,供消费方运行时自检。
消费方侧请勿对 Fact 字段做穷举断言(minor 允许加字段)。

---

## 6. 路线图(与"为什么现在不做")

| 项 | 状态 | 为什么现在不做 |
|---|---|---|
| GB / 其它国家 | 留位 | 无消费者需求;加 = 走 §4 七步 |
| CN 民族/地方日历 | 留位(已拍板) | 同上;结构已容纳(kind 开放枚举),实现零阻力 |
| `private-calendar` 独立私有包 | **不建** | 私有日历目前唯一消费者是 alarm-api(rest-days.js),零重复。等真出现第二消费者那天再抽 —— 那时才知道正确接口长什么样,现在抽是投机性抽象。届时也是独立私有包,**不进 core**(公理 3) |
| 半日市(NYSE 提前收盘)标记 | 不做 | 消费场景问的是"开不开市",半日市=开市;标它徒增字段 |
| lookahead 便捷函数(如 nextWorkday) | 观望 | 两个消费者各有自己的扫描逻辑(块长/顺延),core 提供事实即可;若将来三处重复再上提 |

---

## 7. 测试哲学

- **全离线**:`opts.fetchImpl` 注入 mock(**v2 起连 mock 都不需要**:CN 断言真实归档,HK 走 provider 注入,见 §9),CI 不依赖任何外网源的可用性 ——
  数据源挂了不该让 core 的测试红,那是 coverage 要上报的运行时状态,不是代码缺陷;
- **金标准钉死双向差异**:GoodFriday(银行开/NYSE休)、Columbus(银行休/NYSE开)、
  元旦落周六例外(2027-12-31 银行休/NYSE开)—— 这三颗钉子防住"顺手统一两份美国日历"
  之类的好心坏事;
- **兼容钉子**(E3、B2 等)看守旧行为:改它们之前先想清楚是不是要发 major;
- 测试内含**前置自检**(如 `assert 2026-07-04 是周六`),防止金标准日期本身抄错。

---

## 8. 本次迭代交付清单(v0.1.0 → 首发 v1.0.0)

```
src/tokens.js               region×kind 唯一别名表 + 解析/归一
src/providers/cn.js         CN(holiday-cn 三镜像,三态,带 name)
src/providers/hk.js         HK(1823 ics,VEVENT 块解析 + 反折叠 + 兜底正则)
src/providers/us.js         US 联邦(算法,observed 元数据)
src/providers/us-market.js  NYSE(算法,元旦例外,±1 年扩展)
src/index.js                createHolidayHub:兼容面 + fact/listDays/coverage/isWorkday
test/core.test.mjs          17 用例全离线(A~H 八组)
.github/workflows/          test.yml + release.yml(一键发版+dispatch 下游)
docs/INTEGRATION.md         对接手册(给两个消费项目)
docs/DEVLOG.md              本文
```

---

# v2.0.0 迭代记录 — 词汇一元化 + 数据全量内置 + 全自动流水线

> 触发背景:v1 发布并接入两个下游后数日,Ivan 提出三问(要不要为兼容自缚?core 输出什么形态?holiday-cn 的东西要不要搬进来?)。共识:**项目起步期、消费者=2 且全在自己手里,是打破坏习惯成本最低的窗口** —— 不为兼容自缚,眼光放远。

## 9.1 决策 1:kind 别名全灭,响亮降级取代静默归一

v1 为迁移平滑保留了 `official` 等别名,v2 全部移除,**一词一义**:`bank` / `market` / `public`。
配套把三类静默行为升级为"`loadLogs` 告警(去重)+ 兜底":

| 场景 | v1 行为 | v2 行为 |
|---|---|---|
| 非法/旧口径(`CN:official`、`CN:markt` 打错字) | 静默按默认口径 | **告警** + 默认口径 |
| 非法 `cnDefaultRule`(如 `'official'`) | 静默归一为 bank | **告警** + bank |
| 数据集未加载(hub 建时没申报 `US:market` 却拿它判) | 静默退用**联邦**数据(貌似合理的错答案) | **告警** + 纯周末 |

风控视角的理由:打错字不该无声改变语义;"貌似合理的错答案"比"可见的降级"危险得多。
第三条同时拆掉了 v1 的 E3 兼容钉子 —— 实践中该路径从未触发(reminder-hub 建 hub 时取全量 token 并集),拆除零风险。

## 9.2 决策 2:数据全量内置,运行时零联网(收数据,不收程序)

对"要不要把 holiday-cn 搬进来"的回答分两半:

- **不搬程序**:holiday-cn 的"源码"是爬 gov.cn 公告 + 解析公文措辞的 Python 爬虫(带人工维护的特例表)。CN 假期**没有算法**,是国务院年度公告的人为决定;搬爬虫 = 接手公文解析的维护活 + 在 Worker 里爬 gov.cn。继续做它的下游。
- **全量收数据**:否决了"近期硬编码 + 远期联网"的混合案,因为联网分支解决的是**伪问题** —— 远期未来的数据在全网任何源上都不存在(2027.json 是空壳),远期过去 HK feed 根本不提供(滚动窗口);而全量归档成本无感(CN 20 年 678 条 ≈ 49KB,gzip 后更小)。

失败模式对比(本决策的核心):运行时联网挂掉 = **静默**按周末兜底,国庆被误判为工作日、闹钟照响、没人知道;打包数据 = 最多"旧一天",且故障出现在流水线层,**红灯可见、GitHub 发邮件**。fail-visible > fail-silent。附带收益:alarm-api 的 5 秒预算里省掉一次网络往返;代码+数据同版本,可回滚可复现。

## 9.3 决策 3:HK 归档只增不删 —— 本仓库即唯一历史存档

1823.gov.hk 的 ics 是滚动窗口(只发布今明两年),旧年份从源头蒸发。流水线对 HK 按日期逐条**合并、永不删除**;CN 则按年桶整体替换(官方修正案要能覆盖旧条目,如 2020 春节延长),抓取失败保留既有年份。两条合称归档铁律:**只增不删,永不缩水**。

## 9.4 决策 4:发版全自动 + 前滚式回滚(Ivan 拍板)

`refresh-data.yml` 每日抓上游,数据真变才提交并自动 patch 发版,顺 v1 建好的 dispatch 链直达两个下游 —— 每年 11 月公告一发,无人值守到线上。配套 `rollback.yml`:把 `src/data/` 恢复到任意历史 tag,发一个"内容=旧数据"的**新 patch**(前滚),不碰 npm 撤包、不打断 @latest 自动链。只回滚数据不回滚代码(自动化只改数据,代码回滚走人工 revert)。安全网:release 前必跑测试,测试断言真实公告数据,上游异常大概率当场拦截。

## 9.5 工程细节备忘(踩过/防住的坑)

- **年桶边界**:holiday-cn 年文件含相邻年日期(2007 桶里有 2006-12-30/31 跨年补班)。按年桶整体索引与 v1 按年文件抓取逐语义等价,有 B4 测试钉住。
- **确定性序列化**:数据模块逐条一行、键序稳定(git diff 精确到"哪一天变了");`generatedAt` 只在数据真变时更新(防每日空转提交→空转发版);初版数据与流水线用**同一序列化函数**生成(防首刷产生虚假全文件 diff)。
- **空壳年**:公告未发的年份(如 2027)上游是 `days:[]`,流水线跳过不入档,coverage 如实报 fallback。
- **触发链**:流水线提交用 GITHUB_TOKEN(其 push 不触发 test.yml,测试由 release 统一负责);触发 release 必须用 GH_PAT(GITHUB_TOKEN 发的事件不创建 workflow run)。
- **ICS 解析器**随抓取职责迁到 `scripts/hk-ics.mjs`(不进 npm 包),折行等边界测试直测该文件。

## 9.6 测试哲学更新(取代 §7 的 mock 方案)

v2 测试**零 mock 网络**:CN 断言真实国务院公告归档(已官宣年份不会变;若被修正案改动 → 测试红 = 正确的警报,等于给上游数据装了免费监控);HK 归档初始为空且随流水线增长,行为测试对 provider **注入固定数据**,与归档内容解耦,永绿。

## 9.7 发版规则补充

数据刷新/回滚 = 自动 patch(流水线代劳,人不介入)。其余沿用 §5 对照表。
另:下游 update-core 自动跟 **latest 含 major**,故 major 发版前先把下游改动准备好(或临时 Disable 下游 update-core)—— 本次 v2 的操作顺序见 INTEGRATION.md §10.2。

---

# v2.1.0 迭代记录 — 新国家判定三问入册 + GB/SG 接入

## 10.1 新国家判定三问(正式入册,以后加国先过这三问)

①假期之上有没有**政府裁量层**(调休/公告/代日裁定)?②历法里有没有**宣告制系统**(伊斯兰历/印度历见月裁定)?③有没有**官方机读源**?—— 前两问任一为"是"就走**数据 provider + 流水线**;全为"否"(纯公历固定日 + 第N个星期几 + 复活节)才配**纯算法 provider**。已知国家盘点:US 双日历=真算法国;GB 基线可算但王室公告(2011/2012/2020/2022/2023,平均两三年一次)把它踢回数据阵营;CN(调休)/HK(农历)/SG(宣告制)都是数据阵营。

## 10.2 US 的诚实边界(回答"美国是不是完全没有政府发文调整假期")

不是完全没有,但**对本库两个口径的用途,算法恰好各自够格/够用**:

- 法定假由成文法(5 U.S.C. §6103)固定,无需年度公告 → 算法基础成立。法条本身会变(2021 年 Juneteenth 签署即生效,当年只提前一天通知)—— 属"罕见且响亮"的变更,发 minor 改算法即可。
- 一次性行政令确实存在:总统哀悼日(2018-12-05 老布什、2025-01-09 卡特)关闭联邦机构,偶发的行政令平安夜放假(2018/2019/2024)。**关键区分**:美联储(Fedwire/ACH 清算)在哀悼日**照常运转**,严格只认 11 个法定假 → `US`(bank/清算口径,还款判定用的正是它)算法依旧精确;NYSE 则会为哀悼日/灾难(9·11、2012 桑迪)临时休市 → `US:market` 存在算法覆盖不到的缺口,按定义不可预测、无提前机读源,**当前接受此局限并记录在案**。若将来需要,机制是加一个人工维护的 exceptions 数据覆盖层(路线图,不现在建 —— 触发频率约"一任总统去世一次")。

## 10.3 GB 接入决策

- **分域即口径**:英格兰+威尔士 / 苏格兰 / 北爱三分治域假期互不相同,用 kind 承载(`england` 默认/`scotland`/`ni`),各自映射独立数据集 GB-EAW/GB-SCT/GB-NIR —— 与 CN 民族/地方日历的预留机制同一条路,datasetOf 加一个 GB 分支即成。威尔士不设独立口径(法定与英格兰同一分域)。
- **不设 GB:market**:伦敦证交所≈E&W bank holiday(仅多半日市,半日市=开市),同 HK 先例。
- **observed**:gov.uk 官方 JSON 对落周末的假期直接给出替代日(substitute day),识别 "substitute" 字样标 observed:true;官方不给名义日,nominalDate 如实为 null(fact 协议允许)。
- 归档语义:gov.uk 是多年滚动窗口,同 HK 逐条合并、只增不删。

## 10.4 SG 接入决策与透明声明

单一口径 `public`(银行与 SGX 均随公众假期);落周日的官方补假日**直接在官方清单里**,存档即生效,无需自算 observed。**透明声明**:data.gov.sg 新版 API 的两步编排(搜数据集 → poll-download 取 CSV)是全流水线唯一未经实网验证的接口(交付环境无外网),`fetchSgDays` 注释已标明这是指定调整点、并给出 MOM 官网备用源;失败模式安全 —— 归档留空 + 日志可见,绝不产生错数据,**首次 Refresh 运行即验收**。

## 10.5 附带工程变更

coverage 行的 (region, kind) 标注从 US-NYSE 特判改为 `DATASET_META` 注册表(index.js),加数据集=表里加一行;`加新日历`步骤清单相应 +1(§4 的七步之外:多数据集国家还需 datasetOf 分支 + DATASET_META 行)。测试 E2 的"未知国家"示例由 GB 让位给 JP。GB/SG 初始归档为空结构,与 HK 首刷前同款 —— 官方数据来源 100% 走流水线的原则不破例。

---

# v2.2.0 迭代记录 — 语言铁律 + HK 十年官方归档 + 双模式数据源 + 导出订阅

## 11.1 名称语言铁律(Ivan 拍板)

简体中文 > 繁体中文 > 英文 > 当地语言。逐国落地:CN(holiday-cn 即简中)✓;HK 改按 `sc.json → tc.json → en.json` 序取 1823 官方源;GB/SG 官方源仅英文(=第三优先,GB 当地语言即英语重合;SG 马来语无机读源)。唯一定义处 `src/sources.js`。

## 11.2 HK 主源升级 + 十年官方归档种子

用户提供的 data.gov.hk 历史快照(十份,2019-07 至 2026-05)揭示 **1823 本有 JSON 端点**(sc/tc/en 三语)——比 ICS 干净,升级为主源,ICS 降为格式兜底(解析器保留)。种子:十份官方 `sc.json` 按快照时序合并 → **2018–2027 十年、每年 17 天、共 170 条、全简中官方名**,用流水线同一序列化函数生成(首刷零虚假 diff)。此前的 gov.hk 年页 HTML 抓取方案**废弃**(快照已覆盖其全部价值,盲写 HTML 解析器不再需要)。种子替换线上 hk.data.js 属超集覆盖(原仅今明两年英文名 → 十年简中)。测试新增 D0 历史钉子(≤2025 的日期永不被滚动窗口覆盖,永绿)。

## 11.3 抓取逻辑收拢至 src/sources.js(单点)

v2.2 引入 online 模式后,抓取与解析被流水线和 providers 两处需要 → 全部收拢进 `src/sources.js`(进 npm 包);`scripts/refresh-data.mjs` 退化为纯【归档编排】(合并语义+序列化+落盘);`scripts/hk-ics.mjs` **删除**。铁律:上游 URL 与解析逻辑全库只此一处。

## 11.4 双模式数据源(Ivan 拍板:都要,默认本地写死)

`opts.dataSource = 'bundled'(默认)| 'online'`。online 语义:活抓上游,**活数据按年整体覆盖归档口径**(修正案即时生效),抓不到的年份退用归档,coverage 报 `online` —— 设计约束是"**永不比默认差**":最坏退化 = 等于 bundled。默认写死 bundled 的理由不变(v2 决策 §9.2:fail-visible、5 秒预算、确定性);online 是给"要最鲜数据"的端点留的显式开关。J 组测试钉死三态:活数据生效 / 失败退档 / 非法值告警。

## 11.5 导出器与公理的关系(为什么这不违背"库不是服务/事实不是结论")

`exportJson` / `exportIcs`(src/export.js)输出的是【换了衣服的事实】——假期清单信封与全天事件日历,零 HTTP、零提醒语义。"订阅"由消费方一个 ~15 行 Worker 承担(INTEGRATION §11 给了整份)。边界钉死:提醒时刻 / VALARM / 时区策略是交付语义,永远留在 reminder-hub。ICS 工程要点沿袭其血泪经验:CRLF、稳定 UID(`日期-数据集@workdays-core`)与稳定 DTSTAMP(日期派生,不随生成时刻变 → 订阅客户端零幽灵更新)、TRANSP:TRANSPARENT、CN 补班日以 `补班 · ` 前缀事件呈现(`includeMakeup:false` 可关)。

## 11.6 版本与交付

v2.2.0(minor:全部新增能力,默认行为与 v2.1 完全一致)。删除文件:`scripts/hk-ics.mjs`。

---

# v2.3.0 迭代记录 — schema 2 多语规范 + 三位码 + 时区守则 + 通用归档引擎

## 12.1 国家代码(Ivan 拍板:2位+3位可输入,全称只输出,文档引导三位)

alpha-3 与"一词一义"公理的和解:`official`→`bank` 是自造同义词(必然漂移),`CHN`↔`CN` 是国际标准的**封闭双射**,归一化只在 parseToken 单一入口、canonical 恒为 alpha-2(数据集键/fact.region/coverage/已部署配置零迁移),词漂移由"文档只教三位码主写法"控制。全称进 REGION_META(alpha2/alpha3/tz/多语全称)只作输出,永不参与匹配。

## 12.2 多语与官方/译名标记(Ivan 拍板:官方可多种,翻译也可多种,都要标记)

标记设计选了**数据集级**而非逐条级:一个数据集的全部条目共享同一份 `officialLangs` 数组(可多个——HK 三语皆官方),判官方/译名只看 `lang ∈ officialLangs`,零冗余。归档只存官方发布语言(不许机器转换冒充);译名住 translations.js(人的领地),hub 层合并、同键官方必胜。默认解析链简中优先**含译名**——这是本次唯一的默认行为变更("方便我理解"的直接落地),记录在 INTEGRATION §12。

## 12.3 schema 2 与预留字段哲学

字段表/形制/序列化规则全部成文(docs/DATA-FORMAT.md),代码化在 src/schema.js(读写同源)。预留 = **显式空位(顶层 ext)+ 预定义语义的可选键(nominalDate/scope/kindTags/halfDay/条目级 ext)+ 读取端容忍未知键**三件套——将来加字段不动 schema 版本、不破坏任何旧读取方。旧格式(v2.2 字符串 / {name,observed})读取归一在 normalizeDayEntry 单一处,流水线首刷自动改写归档,迁移零人工;故 gb/sg 线上数据文件**本次不交付**(交付会抹掉流水线已积累的数据)。

## 12.4 通用归档引擎(providers/archive.js)

HK/SG/GB 在 v2.2 已是三胞胎,收敛为一份引擎 + 各 20 行薄配置。从此"AI 照 DATA-FORMAT.md 生成一个清单型国家" = 数据文件 + tokens 两行 + 注册两行,**零 provider 代码**——这正是"以后让 AI 照规范生成别国日历"的工程前提。CN 三态自持(调休语义独有),US/NYSE 算法自持(officialLangs 硬编码 ['en'])。

## 12.5 时区碰撞教义(Ivan 提出)

定论:节假日 = 该地区**当地民用日期**,库内永不做时刻/时区换算(ICS 全天事件天然浮动日期)。±1 天碰撞的真身在消费侧——拿自己时区的"今天"问别国日历。解法三件套:数据文件与 REGION_META 带 IANA 时区(US 按联储/NYSE 惯例取纽约作代表)→ `hub.localDateOf(token, at?)` 把任意时刻换算成"那国此刻的民用日期" → 消费方守则一行 `isWorkday(tok, localDateOf(tok))`。L3 测试钉死同一时刻纽约 7/3 vs 北京 7/4。

## 12.6 HK 三语全收

三语皆官方 → 抓取无主次只有全收:每种语言独立走"JSON→ICS"降级链,任一语言到手即成功;流水线按**日期×语言**粒度只增不删(某语言某天缺失不影响其它语言)。种子暂为 sc 单语(用户快照),tc/en 由流水线对滚动窗口逐日补齐;用户后续提供 tc/en 历史快照时再补种一次(同一序列化函数,零虚假 diff)。

## 12.7 版本

v2.3.0(minor)。测试 35 用例。删除文件:无。gb.data.js / sg.data.js 不交付(见 12.3)。

## 12.8 数据最小化档(v2.3 补遗,Ivan 提出)

答案:天生支持——判定引擎的本质是"日期集合 + 周末规则",名称/observed/多语/时区元数据
全是增量修饰。唯一障碍是规范条文里"names 必含官方键"的要求,已放宽为**最小档**(§2.6):
必填仅 schema/source/generatedAt/days,条目值可为 null。配套:ICS 导出的无名占位按 lang
本地化(公众假期/Public holiday);M1 测试钉死最小档全链路。设计要点:归档合并本就是
"日期×语言只增不删",最小档 → 日后补名称是**渐进增强**,零迁移成本 —— 数据最小化与
"越详细越好"不矛盾,它们是同一条演进路径的两端。
