# DATASET-GUIDE.md — 数据集开发规范(给人,更给 AI)

> **这份文档的用途**:把它 + 一个官方数据源地址(或历史数据文件)交给 AI,AI 应能产出一个
> **完整、自包含、可直接投入的 `src/datasets/<code>/` 文件夹**——数据、读取、抓取、译名俱全,
> 扔进仓库、在 `_loader.js` 注册一行即生效。生成物有问题时被装载器**自动隔离**,不影响已有国家。
>
> 数据文件格式的细节在 `docs/DATA-FORMAT.md`(schema 2);本文讲**一个数据集作为插件的整体结构与契约**。

---

## 0. 总纲:输入无限,输出唯一(先读这一节)

本库是一台"**输入 → 输出**"的机器。理解这条,新增国家就不会跑偏。

### 输入侧:四类源,允许无限花样

| 源类型 | 例子 | 你要写什么 | 稳定性 |
|---|---|---|---|
| **官方多语源** | HK 1823(sc/tc/en,JSON+ICS) | `fetch.js` 抓+按语言合并 | 最稳 |
| **算法生成** | US 联邦 / NYSE | `provider.js` 纯算法,**无 fetch.js、无 data.js** | 永不失败 |
| **第三方加工品** | CN holiday-cn(社区爬公报的产品) | `fetch.js` 适配其私有格式 | **换源风险最高** |
| **爬虫采集** | (某国需爬官网 HTML) | `fetch.js` 抓+解析,必须 fail-safe | 最脆 |
| **人工例外** | US 总统哀悼日、NYSE 因灾休市 | `exceptions.js`(算法型的可选覆盖层) | 手工,罕见 |

### 输出侧:唯一的"窄腰",精确稳定

无论输入多花哨,**所有数据集必须收敛到同一个 provider 契约**(§3),hub 之上统一出
`isWorkday / fact / listDays / exportIcs / exportJson`。输出侧绝不因某个源特殊而多开字段——
US 的例外、CN 的换源、HK 的多语,在窄腰这里全部长成一模一样的 `fact`。这就是"精确稳定输出"。

```
   [官方多语源]─┐
   [算法生成]──┼─→ fetch.js(取+译)─→ schema 2 条目 ─→ provider 契约 ─→ hub ─→ 统一输出
   [第三方品]──┤        ↑ 归一点:广泛兼容与精确稳定的分界线
   [爬虫采集]──┘
```

### 换源:爆炸半径锁死在一个文件

第三方源(如 holiday-cn)哪天没了、或换一个格式不同的新源,**只动这个数据集的 `fetch.js`,
不动 provider、不动数据、更不动别国**。为此 `fetch.js` 内部再分两层:

- **取(fetchRaw)**:把字节拉回来——可多源、多镜像、多格式降级。
- **译(adapt)**:把这个源的**私有格式**翻译成本库的 schema 2 条目 `{names, observed}`。

换源 = 换掉取+译两层,`fetch.js` 对外导出的函数签名与输出**不变**。这是"广泛兼容"落地的地方。

---

## 1. 文件夹结构

```
src/datasets/<code>/         # <code> = 两位小写(见 §2 命名)
  index.js          ← 【必需】清单:声明 region/kind/别名/官方语言/时区 + 组装 provider、fetch
  data.js           ← 数据型必需:schema 2 历史数据(算法型省略)
  provider.js       ← 自定义 provider(算法型/三态型必需;清单型复用通用引擎,可省)
  fetch.js          ← 有在线源则需:抓取(取+译),失败返 null
  translations.js   ← 可选:该国译名(官方名→其它语言)
  exceptions.js     ← 可选(算法型):人工例外覆盖层
```

**最小数据集**:清单型且只要判定 → 只需 `index.js` + `data.js`(provider 复用通用引擎、
无 fetch 用静态数据)。**算法型**:`index.js` + `provider.js`(+可选 exceptions),无 data/fetch。

---

## 2. 命名规则(成文,别再猜)

- **文件夹名 / `code` / 数据集 id 前缀 = ISO 3166-1 alpha-2 小写**(`hk`、`gb`)。这是内部 canonical,与 `fact.region`、coverage、已部署配置一致。
- **`token` 输入的主写法 = alpha-3**(`HKG`),文档、下游配置都用它;alpha-2 永久等价。二者的双射由清单里的 `alpha3` 字段声明,归一在 `parseToken` 单一入口。
- **dataset id**:单区单历 = region 本身(`HK`);一区多历 = `region-变体`(`GB-EAW`/`GB-SCT`,`US`/`US-NYSE`)。为什么是两位而非三位:见上,canonical 一致性。
- **kind**:一词一义无别名(`bank`/`market`/`public`/`scotland`…)。分域即 kind(GB 三治域)。

---

## 3. provider 契约(输出窄腰)

每个 provider 实例必须实现:

```js
{
  dataset: 'HK',                    // 本 provider 负责的 dataset id
  officialLangs: ['sc','tc','en'],  // 官方语言数组(判官方/译名的依据)
  async load(years, ctx) {          // ctx = { dataSource, fetchImpl, live? }
    // live = loader 已抓好并注入的活数据 {date:条目}(在线模式);provider 只查表不自己抓
    return { rows: [{year, ok, mode, source}], logs: [] };  // rows 汇入 coverage
  },
  isOffDay(dateStr): boolean,       // 命中假期(判定核心)
  fact(dateStr): { isHoliday, isMakeup, names:{lang:name}, observed, nominalDate } | null,
  days(): [{ date, isOffDay, names, observed }],   // 升序;names 为官方多语对象(译名合并在 hub 层)
  lookup?(dateStr): true|false|undefined           // 仅三态型(CN):放假/补班/无记录
}
```

**清单型直接用通用引擎**,无需自己写 provider:

```js
import { createArchiveProvider } from '../_archive-provider.js';
createArchiveProvider({ dataset, tag, sourceName, legacyLang, data, sliceDays });
```

参数逐个说明(别当黑盒填,填错会静默出错):

| 参数 | 类型 | 说明 | 取值范例 |
|---|---|---|---|
| `dataset` | string | 数据集 id(= region 或 region-变体),与 tokens.datasetOf 一致 | `'HK'` / `'GB-EAW'` |
| `tag` | string | **日志标签**,出现在 loadLogs/warnings 里,便于排查。惯例=大写地区码 | `'HK'` / `'GB:eaw'` |
| `sourceName` | string | 数据源人读名(进 coverage.source),纯展示 | `'1823.gov.hk'` |
| `legacyLang` | string | **旧格式条目的默认语言**:v2.2 遗留的纯字符串/无 names 条目按此语言归一。取该数据集**主官方语言**(HK=`'sc'`,GB/SG=`'en'`) | `'sc'` / `'en'` |
| `data` | object | 该数据集的 data.js 导出对象(schema 2) | `HK_DATA` |
| `sliceDays` | fn | `(data) => {date:条目}`,从 data 取出本 dataset 的天。**多分域必须靠它切片**(GB 一份 data 三个分域) | `d => d.days` / `d => d.divisions.eaw` |

---

## 4. fetch 契约(输入适配)

```js
// 单 dataset:返回 { 'YYYY-MM-DD': { names:{lang:name}, observed } } | null
// 多 dataset(如 GB):返回 { 'GB-EAW': {date:条目}, 'GB-SCT': {...}, ... } | null
// 三态型(如 CN):返回 { '2026': [ {date,isOffDay,names}, ... ] } | null(按年桶)
export async function fetchXx(fetchImpl, years) { ... }
```

铁律:
- **失败返 `null`**,绝不抛错、绝不返回半截数据。多源多格式在函数内部降级(HK 的 JSON→ICS、CN 的三镜像都是范例)。`fetchImpl` 缺省用 `globalThis.fetch`(测试注入用)。
- **必须消费 `years`**(按年源尤其):源是"每年一个文件/一个接口"时(如 SG 的 MOM 按年 ICS),不拿 `years` 就不知道抓哪些年。清单里 `fetch` 也要把 years 透传:`fetch: (fetchImpl, years) => fetchXx(fetchImpl, years)`——**别照抄只写 `(fetchImpl)` 的旧样例**。整份源(一次拿多年,如 HK/GB)可忽略此参数。流水线与在线模式都会传入实际年份范围。
- **空运行守卫**(防静默坏源):抓取返回 HTTP 200 但**解析出 0 条**,视为**解析失败**——跳过该年/返回 null,**绝不把"0 条"当"该年无假期"写进归档**。否则源改版(字段名变、DOM 变)会悄悄清空数据;有此守卫时,坏源只会"不更新",配合"只增不删"归档,既有数据永远不丢。
- **ICS 时区陷阱**:`DTSTART;VALUE=DATE:YYYYMMDD`(纯日期)可直接取 8 位数字,安全。但若源给 `DTSTART:YYYYMMDDT......Z`(**UTC 时刻**),对 UTC+8 地区(CN/HK/SG)直接取前 8 位可能**早一天**(UTC 的 23:00 已是当地次日)。遇到带 `T...Z` 的时刻,先换算到该数据集 `tz` 的当地日期再取 `YYYY-MM-DD`。官方节假日源通常用 VALUE=DATE,不踩此坑,但适配新源时务必确认。

---

## 5. 清单(index.js)字段

```js
export default {
  code: 'hk',                       // 两位小写
  officialLangs: ['sc','tc','en'],  // 官方语言
  translations: HK_TRANSLATIONS,    // 可选
  regions: [{
    region: 'HK', alpha3: 'HKG', tz: 'Asia/Hong_Kong',   // tz=IANA,时区守则用
    names: { sc:'香港', tc:'香港', en:'Hong Kong' },      // 地区全称(输出端 REGION_META)
    defaultKind: 'public',
    kinds: { public: { dataset: 'HK' } }                 // kind → dataset id
  }],
  createProviders: () => ({ 'HK': <provider 实例> }),     // dataset id → provider
  fetch: (fetchImpl, years) => fetchHk(fetchImpl, years)  // 可选;按年源必须透传 years,算法型省略
};
```

装载器校验:缺 `code`/`regions`/`createProviders`,或 `code` 非两位小写 → **判定为坏数据集,
跳过并告警,其余照跑**。这是故障隔离的落点:AI 生成的清单不合规,不会拖垮已有国家。

---

## 6. ★ AI 生成任务模板

> 依据 DATASET-GUIDE.md + DATA-FORMAT.md,为 **<国家/地区>** 生成完整的 `src/datasets/<alpha2小写>/` 文件夹。
> 官方源:__(URL 或附件历史数据)。源格式:__(JSON/ICS/CSV/HTML)。官方语言:__。时区(IANA):__。
> 口径:__(单一 public / bank+market / 分域)。类型:__(清单型/算法型/三态型)。
> 产出全部文件(index.js / data.js / fetch.js / 可选 provider.js、translations.js、exceptions.js),
> 数据文件按 DATA-FORMAT.md schema 2 序列化(逐条一行);fetch 失败返 null、必须消费 years(按年源)、
> 空运行(200 但 0 条)当失败跳过、ICS 注意 UTC 时刻换算;通过两份文档的自检清单。
> 最后告诉我在 `src/datasets/_loader.js` 的 REGISTRY 里加哪一行。

**生成步骤**:①定类型(有官方调休→三态;纯规则可算→算法;否则清单)②`data.js`(历史数据按
schema 2;算法型跳过)③`fetch.js`(取+译两层;算法型跳过)④`provider.js`(清单型复用通用引擎、
可跳过)⑤`index.js` 清单⑥可选 translations/exceptions⑦给出 `_loader.js` 注册行。

**新国家三问**(判类型):①假期之上有政府裁量层(调休/公告)吗?②历法有宣告制(伊斯兰历/
印度历)吗?③有官方机读源吗?——前两问任一"是"→ 数据型(清单/三态);全"否"(纯公历+
第N个星期几+复活节)→ 算法型。

---

## 6b. 交付前自检清单(AI 逐项过)

- [ ] `createArchiveProvider` 六个参数都填对?`sliceDays` 能正确切出本 dataset 的天(多分域尤其)?`legacyLang` = 主官方语言?
- [ ] `fetch(fetchImpl, years)` 与清单 `fetch: (fetchImpl, years) => ...` **都透传 years**?按年源真的用了 years?
- [ ] 抓取失败/解析 0 条 → **返回 null**,不写空、不抛错?
- [ ] ICS 用 `VALUE=DATE`?若是 `T...Z` 的 UTC 时刻,是否换算到当地日期?
- [ ] data.js 是 schema 2、逐条一行、只增不删?算法型无 data.js/fetch?
- [ ] `code` 两位小写、`regions/kinds/createProviders` 齐全(否则被装载器丢弃)?

## 7. 接入与验证

1. 放好 `src/datasets/<code>/` 文件夹。
2. `src/datasets/_loader.js` 的 `REGISTRY` 加一行:`xx: () => import('./xx/index.js')`。
3. (在线源)`refresh-data.mjs` 的 `WRITERS` 登记一行(序列化形制+合并策略);算法型跳过。
4. 测试:token 解析 + 金标准日期 + coverage + 与相邻口径差异钉子。
5. `npm test` 全绿 → Release **minor**。

**故障隔离自检**:故意把新 `index.js` 写坏一行,`npm test` 里已有国家应仍全绿、loadLogs 出现
`[dataset:xx] 装载失败,已跳过`——这是新国家不拖累旧国家的活证明。

---

## 8. 换源实操(第三方源迁移范例)

holiday-cn 若停更或你换源:

1. 只改 `src/datasets/cn/fetch.js`:换掉"取"(新 URL/镜像)与"译"(把新源格式映射成 `{date,isOffDay,names}`)。
2. `provider.js`、`data.js`、`index.js`、别国——**一律不动**。
3. 若新源字段语义不同(如没有 isOffDay 而是分开的 holiday/workday 两个列表),在"译"层归一成三态,输出契约不变。
4. 跑一次 Refresh + 测试,确认金标准日期不变。

爆炸半径 = 一个文件。这就是"广泛兼容性 + 精确稳定输出"在工程上的兑现。
