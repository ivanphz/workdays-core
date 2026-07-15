# DATA-FORMAT.md — workdays-core 数据文件规范(schema 2)

> **这份文档给谁看**:①要为本仓库**新增一个国家/地区日历**的人或 AI——你可以把任意格式、
> 任意语言的 ICS / JSON / CSV 原始数据连同本文档一起交给 AI,它应能直接产出合规的数据文件;
> ②维护**自动化抓取**(流水线/在线模式)的人;③**下游消费方**——怎么取值、怎么判官方/译名、
> 怎么处理时区。代码化的单一实现在 `src/schema.js`(读写同源),本文是它的完整说明书。

---

## 1. 三条铁律(违背任何一条的数据文件不予接收)

1. **当地民用日期**。所有日期都是该地区当地的日历日期(`YYYY-MM-DD`),库内永不做时刻/时区换算;跨时区"今天是哪天"由消费方经 `hub.localDateOf()` 解决(见 §8.4)。
2. **只增不删**。归档永不缩水:上游滚动窗口蒸发的历史年份,本仓库是唯一存档;修正只能以"同键覆盖"发生,不能以"删除"发生。
3. **官方来源,机器写入**。`src/data/*.data.js` 归档文件是**机器领地**(流水线维护,勿手改);唯一例外是初版种子——必须从官方文件生成,不允许凭记忆手写日期。译名是**人的领地**,住在 `src/data/translations.js`。

---

## 2. 两种形制

### 2.1 清单型(默认形制,绝大多数国家/地区)

适用:假期是"哪些天放假"的清单,没有"补班"概念。HK / SG / GB 均为此形制,由通用引擎
`src/providers/archive.js` 直接消费——**新增一个清单型地区 = 零 provider 代码**。

```js
// 自动生成,勿手改。由 scripts/refresh-data.mjs 维护(每日流水线)。
// 数据源: <官方源说明>。规范见 docs/DATA-FORMAT.md。
export const XX_DATA = {
  schema: 2,
  source: "官方源名称或 URL",
  generatedAt: "2026-07-11T00:00:00.000Z",   // 或 null(尚未首刷)
  officialLangs: ["en"],                      // ⚠️ 数组,可多个(HK 为 ["sc","tc","en"])
  tz: "Asia/Tokyo",                           // IANA 时区(自带夏令时,不用 UTC 偏移)
  ext: {},                                    // 预留(数据集级扩展,当前恒为空对象)
  days: {
    "2026-01-01": { "names": { "en": "New Year's Day" }, "observed": false },
    "2026-05-06": { "names": { "en": "Greenery Day" }, "observed": true }
  }
};
```

### 2.2 三态型(仅调休制度,目前只有 CN)

适用:官方会把周末标为**上班日**(调休补班),一天有"放假/补班/无记录"三态。
按年桶组织(与上游 holiday-cn 对齐;年桶内允许出现相邻年份日期,如元旦跨年补班)。

```js
export const CN_DATA = {
  schema: 2,
  source: "NateScarlet/holiday-cn",
  generatedAt: "...",
  officialLangs: ["sc"],
  tz: "Asia/Shanghai",
  ext: {},
  years: {
    "2026": [
      { "date": "2026-10-01", "isOffDay": true,  "names": { "sc": "国庆节" } },
      { "date": "2026-10-10", "isOffDay": false, "names": { "sc": "国庆节" } }  // 补班周六
    ]
  }
};
```

### 2.3 分域变体(一个地区多套互斥日历,目前只有 GB)

顶层 `days` 换成 `divisions`,每个分域内部就是清单型的 `days` 对象;分域在 token 层用
kind 承载(`GBR:scotland`)。共享 `officialLangs` / `tz` / `source`。

```js
divisions: {
  "eaw": { "2026-01-01": { "names": { "en": "New Year's Day" }, "observed": false } },
  "sct": { ... },
  "nir": { ... }
}
```

### 2.4 字段表(顶层)

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `schema` | number | ✅ | 恒为 `2`。读取端据此识别规范版本 |
| `source` | string | ✅ | 官方数据源的名称或 URL(人读,不参与逻辑) |
| `generatedAt` | string\|null | ✅ | 最近一次数据变更的 ISO 时刻;种子=官方快照时刻;未首刷=null。**只在数据真变时更新**(防空转发版) |
| `officialLangs` | string[] | ✅ | 官方发布语言的键数组,**可多个**;`names` 里属于它的键=官方名,其余=译名(判定标记的唯一依据) |
| `tz` | string | ✅ | 该日历的民用时区,IANA 名(如 `Asia/Singapore`);多时区国家取该口径的代表时区(US 按联储/NYSE 惯例取 `America/New_York`) |
| `ext` | object | ✅ | 数据集级预留扩展位,当前恒为 `{}` |
| `days` / `years` / `divisions` | object | 三选一 | 形制见 §2.1–2.3 |

### 2.5 字段表(单日条目)

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `names` | object | 建议 | `{ 语言键: 名称 }`;**若有名称,至少含一个 officialLangs 里的键**;归档文件里只放官方发布的语言。最小档可整体省略(见 §2.6) |
| `observed` | boolean | ✅(清单型) | 该日是否为顺延/替代日(名义假期落周末被官方移到这天)。官方清单直接给出替代日的(GB substitute、SG (Observed))标 true |
| `isOffDay` | boolean | ✅(仅三态型) | true=法定放假,false=调休补班上班 |
| `date` | string | ✅(仅三态型) | 三态型条目自带日期;清单型日期是键 |
| 以下为**预留字段**,读取端一律容忍、未知键一律忽略并在合并时保留: | | | |
| `nominalDate` | string | 预留 | observed 日对应的名义日期(官方源给得出才填) |
| `scope` | string[] | 预留 | 地区内部适用范围(如仅部分州/邦生效的假期) |
| `kindTags` | string[] | 预留 | 口径标签(如仅 bank 或仅 market 生效的日子) |
| `halfDay` | boolean | 预留 | 半日(半日=开市/上班,判定层不处理,仅记录) |
| `ext` | object | 预留 | 条目级逃生舱 |

**语言键约定**:`sc`=简体中文、`tc`=繁体中文、`en`=英文;其它语言用 ISO 639-1 小写码
(如 `ms` 马来语、`ja` 日语)。与 BCP47 的映射:sc↔zh-Hans、tc↔zh-Hant。

### 2.6 最小档(minimal profile)—— 数据最小化原则

判定引擎只需要**日期**;名称/observed/多语全是增量修饰。当源数据只有日期(或你刻意最小化)时,
以下即为合法完整的数据文件,判定/coverage/导出全链路可用:

```js
export const XX_DATA = {
  schema: 2,
  source: "官方源名称或 URL",
  generatedAt: "2026-07-11T00:00:00.000Z",
  officialLangs: [],          // 无名称即声明空数组
  tz: "Asia/Tokyo",           // 仍建议给(时区守则用;实在没有,读取端容忍缺失)
  ext: {},
  days: {
    "2026-01-01": null,       // 最小条目: null 或 {}
    "2026-02-11": null
  }
};
```

规则:①最小档必填仅 `schema / source / generatedAt / days`,其余字段读取端容忍缺失,但正式入库建议补齐(`officialLangs: []`、`tz`、`ext: {}`);②条目值 `null` 与 `{}` 等价,归一为 `{names:{}, observed:false}`;③此时 `fact.name` 为 `null`、ICS 导出以本地化占位名兜底("公众假期"/"Public holiday");④**渐进增强**:归档合并是"日期×语言只增不删",先入最小档、日后官方名/多语到手再补齐,天然无迁移成本。

---

## 3. 语言与官方/译名标记

- **归档 names 只存官方发布的版本**。官方没发某语言,就不在归档里出现——不许机器转换冒充(大陆无官方繁体,就没有 tc 键)。
- **谁是官方,一处声明**:数据集级 `officialLangs` 数组(可多个)。消费方判定一个语言值是官方还是译名,只看一条:`lang ∈ officialLangs ?`
- **译名住在 `src/data/translations.js`**(人的领地,人工/AI 维护):`region → 官方名精确匹配 → { lang: 译名 }`,一个官方名可配任意多种译名。运行时在 hub 层合并,**同键冲突官方值必胜**。带后缀的官方名变体(如 "(substitute day)")不会命中精确匹配,自动回落官方原名,属预期。
- **解析回落链**(单名 `name` 的来源):`opts.lang → sc → tc → en → 首个官方语言 → 任意首个`。

---

## 4. 序列化规则(写入端必须遵守,git diff 才有意义)

逐条一行;日期键升序;`names` 内语言键按 `sc, tc, en, 其余字母序`;已知键序固定
(names → observed → 其余字母序);未知键原样保留。实现:`src/schema.js` 的
`dayEntryJson` / `sortLangKeys`——**写数据文件永远经过它们,不要手搓 JSON**。
初版种子与流水线用同一函数,保证首刷零虚假 diff。

---

## 5. ★ AI 生成手册:把任意原始数据变成合规数据文件

把本文档 + 原始数据(任意格式:ICS / JSON / CSV / HTML 表格,任意语言,可多份)交给 AI,
使用如下任务模板:

> 依照 DATA-FORMAT.md 规范,把附件原始数据转换为 `src/data/<小写地区码>.data.js`。
> 地区:__,形制:清单型(默认;有官方调休补班才用三态型),officialLangs:__,tz:__。
> 多份输入按时间序合并(新覆盖旧);多语言输入按语言分别放入同一天的 names。
> 源数据只有日期没有名称 → 按 §2.6 最小档产出(条目值 null,officialLangs: [])。
> 输出完整文件,逐条一行,通过 §7 自检清单后交付。

**转换步骤**:

1. **判形制**:官方会把周末标为上班日吗?是→三态型;否→清单型(observed 概念≠补班,替代日仍是清单型)。
2. **提日期**:统一为 `YYYY-MM-DD` 当地民用日期。ICS 的 `DTSTART;VALUE=DATE:20260101` → `2026-01-01`;带时刻的 DTSTART 取其**当地日期部分**,不做时区换算;CSV/JSON 里的 `1 January 2026`/`2026/1/1` 等一律归一。
3. **提名字入 names**:每份输入判定其语言(看内容,别信文件名),放入对应语言键;同一天多语言输入合并进同一 names。只收官方发布语言。
4. **判 observed**:官方文本含 substitute / observed / 补假 / 翌日振替等字样,或该条目明确是"因名义日落周末而生的替代日"→ `observed: true`;拿不准 → false(宁缺勿滥)。
5. **合并**:多份快照按时间升序处理,同一天同一语言,新值覆盖旧值;不同语言互不覆盖;任何输入都不删除已有日期。
6. **序列化**:按 §4 规则输出;`generatedAt` 取最新一份官方快照的时刻(拿不到就用转换时刻)。

**常见输入形态对照**:

| 输入 | 对应 |
|---|---|
| ICS `VEVENT`(DTSTART + SUMMARY) | 一天一条;SUMMARY→names[该文件语言] |
| 1823 式 JSON(`vcalendar[0].vevent[]`) | 同上(参考实现 `sources.js parseHkJson`) |
| gov.uk 式 JSON(`events[]` 含 title/date/notes) | title→names.en;notes/title 含 substitute→observed |
| CSV(date, holiday 列) | 逐行一条 |
| holiday-cn 式 JSON(`days[]` 含 isOffDay) | 三态型年桶 |

**§7 自检清单**(AI 交付前逐项过):
`schema === 2`?有名称的条目,names 至少含一个 officialLangs 里的键(最小档 officialLangs 可为 `[]`,条目可为 `null`)?tz 是合法 IANA 名(最小档可缺)?
日期全部 `YYYY-MM-DD` 且键升序?逐条一行?observed 全部显式布尔?没有发明数据源里
不存在的日期或名字?`ext: {}` 在顶层?文件头两行注释(勿手改 + 数据源)在?

**完整示例**(输入:日本内阁府 CSV `2026-01-01,元日` + 英文 ICS `SUMMARY:New Year's Day`):

```js
// 自动生成,勿手改。由 scripts/refresh-data.mjs 维护(每日流水线)。
// 数据源: 内阁府「国民の祝日」CSV + 官方英文 ICS。规范见 docs/DATA-FORMAT.md。
export const JP_DATA = {
  schema: 2,
  source: "cao.go.jp shukujitsu.csv",
  generatedAt: "2026-07-11T00:00:00.000Z",
  officialLangs: ["ja", "en"],
  tz: "Asia/Tokyo",
  ext: {},
  days: {
    "2026-01-01": { "names": { "en": "New Year's Day", "ja": "元日" }, "observed": false },
  }
};
```

---

## 6. 接入清单(数据文件就绪之后)

> ⚠️ v3 起接入步骤全部收敛到**数据集文件夹**,不再散落 tokens/index/sources 等中心文件。
> 完整步骤(文件夹结构 + 注册 + 抓取契约 + 故障隔离)见 **`docs/DATASET-GUIDE.md`**,那是唯一权威。
> 一句话:放好 `src/datasets/<code>/`(index 清单 + data + fetch + 可选 provider/translations)→
> `src/datasets/_loader.js` 的 REGISTRY 加一行 → 测试 → Release minor。本文档只管**数据文件本身的格式**。

---

## 7. 自动化抓取规范(fetch 契约,与 DATASET-GUIDE §4 一致)

- 契约:`async fetchXx(fetchImpl, years) → 数据 | null`。**失败返 null,绝不抛错、绝不返回半截数据**;调用方(流水线/online 模式)自行退档。
- **必须消费 `years`**:按年源(如 SG 的 MOM 按年 ICS)据此逐年抓,清单里 `fetch: (fetchImpl, years) => fetchXx(fetchImpl, years)` 透传;整份源(HK/GB)可忽略。
- **空运行守卫**:HTTP 200 但解析 0 条 = 失败,跳过/返回 null,**绝不把"0 条"当"无假期"写进归档**(配合只增不删,坏源只会"不更新",数据不丢)。
- **ICS 时区**:`VALUE=DATE` 纯日期安全;`T...Z` 的 UTC 时刻对 UTC+8 地区可能早一天,需先换算到当地日期(详见 DATASET-GUIDE §4)。
- 返回形态:清单型 `{date: 条目}`;多 dataset(GB)`{datasetId: {date:条目}}`;三态型(CN)`{year: [条目]}`。多语源分语言抓取、合入同一天 names(参考 hk/fetch.js)。
- 流水线合并语义:三态型(CN)成功年份**整年替换**、失败保留;清单型**日期×语言只增不删**。读取端对旧格式容错归一(schema.js),迁移无人工步骤。

---

## 8. 下游取值指南

### 8.1 fact 字段表

`hub.fact(token, 'YYYY-MM-DD')` → null 或:

| 字段 | 说明 |
|---|---|
| `date / region / kind / dataset` | 定位信息;region 恒为 alpha-2 |
| `isHoliday / isMakeup` | 放假 / 补班(仅 CN 有 makeup) |
| `name` | 单名字符串,按 hub 的 `opts.lang` 解析(缺省链 sc>tc>en>官方首语言) |
| `names` | **全量多语对象** = 官方 ∪ 译名(官方同键必胜) |
| `officialLangs` | 官方语言数组。**判官方/译名:`lang ∈ officialLangs ?`** |
| `observed / nominalDate` | 顺延标记 / 名义日期(源给得出才有,否则 null) |

### 8.2 三个清单接口

`listDays(token)` → `[{date, isOffDay, name}]`(legacy 形状,alarm-api 契约,永不加键);
`listDaysFull(token)` → `[{date, isOffDay, observed, name, names}]`;
`officialLangsOf(token)` → 官方语言数组。

### 8.3 语言

hub 级 `opts.lang` 定默认;`exportIcs/exportJson` 的 `opts.lang` 可逐次覆盖
(订阅端玩法:`feed.ics?cal=HKG&lang=en`)。

### 8.4 时区守则(±1 天碰撞的解)

数据存的是当地民用日期;"今天"因时区而异。跨时区提问**必须**先取当地日期:
`hub.isWorkday('USA:market', hub.localDateOf('USA:market'))` = "纽约此刻是不是交易日"。
拿自己时区的日期直问别国日历,就会出现相差 ±1 天的碰撞——那不是数据错,是"今天"取错了。

### 8.5 coverage

`bundled`(打包归档)/ `online`(活抓)/ `computed`(算法)/ `fallback`(该年无数据,
纯周末兜底,**结果不可全信**,用 `isCovered(token, date)` 探测)。
