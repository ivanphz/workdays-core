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

- **全离线**:`opts.fetchImpl` 注入 mock,CI 不依赖任何外网源的可用性 ——
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
