# INTEGRATION.md — workdays-core 对接手册

> **这份文档给谁看**:`alarm-api`(iOS 闹钟网关)与 `calendar-api`(提醒框架仓库,信用卡/签到)
> 两个项目(以及任何未来消费者)。仓库地址即 github.com/ivanphz/alarm-api 与 github.com/ivanphz/calendar-api。
> 照本手册操作即可完成接入;不需要读 core 源码。全程 GitHub 网页操作,不需要本地环境。
>
> **心智模型一句话**:workdays-core 是一个 npm 库(发布在 GitHub Packages 私有源),
> 你 `import` 它、在自己 Worker 进程内现算;它给"事实",你下"结论"。
> 私有日历/请假判定与它无关,继续留在 alarm-api 本地。

---

## 0. 占位符约定(全文替换一次)

本文所有 `OWNER` = 你的 GitHub 用户名,**一律小写**(npm 包名不允许大写)。
出现位置:包名 `@ivanphz/workdays-core`、workflow 里的 `scope: '@ivanphz'`、`npm install @ivanphz/...`。

core 仓库内还有两处占位符要改(建仓时一次性):`package.json` 的 `name` 和 `repository.url`。

---

## 1. 全景图:一次发版,两个下游自动跟进

```
[workdays-core 仓库]
  Actions → Release → 选 patch/minor/major
    ├─ npm test(不过不发)
    ├─ npm version + tag + 发布到 GitHub Packages
    └─ repository_dispatch ──→ [alarm-api]    update-core.yml: 升级依赖并提交
                            └→ [calendar-api] update-core.yml: 升级依赖并提交
                                     ↓ (PAT 提交触发)
                               各自的 deploy.yml: npm ci → wrangler deploy
```

人只做一个动作:在 core 仓库点一次 Run workflow。其余全自动。

---

## 2. 一次性准备(账号级,只做一遍)

### 2.1 创建 PAT(三个仓库共用同一个)

GitHub 头像 → Settings → Developer settings → **Personal access tokens → Tokens (classic)** → Generate new token (classic):

| 项 | 值 |
|---|---|
| Note | `workdays-core-ops` |
| Expiration | 按习惯(到期后换值即可,三处 Secret 同步更新) |
| Scopes | ✅ `repo`(跨仓库 dispatch + 提交能触发 workflow) ✅ `read:packages`(下游安装私有包) |

生成后复制 token 值。

### 2.2 三个仓库各加一个同名 Secret

在 **workdays-core / alarm-api / calendar-api** 三个仓库分别:
Settings → Secrets and variables → Actions → New repository secret:

- Name:`GH_PAT`  Value:上面那个 token

> 为什么不用内置 GITHUB_TOKEN 干这些活:① 它不能跨仓库 dispatch;② 它 push 的提交
> **不会触发其它 workflow**(GitHub 防死循环的机制)——而我们恰恰需要"升级提交 → 触发部署"。
> 这两点都是血泪坑,PAT 一次解决。发布包本身仍用 GITHUB_TOKEN(同仓库内,够用)。

### 2.3 建 core 仓库并首发 v1.0.0

1. 新建私有仓库 `workdays-core`,把交付的整个项目文件上传(网页 Add file → Upload files,可整目录拖入)。
2. 上传前(或用网页编辑器改):`package.json` 里两处 `OWNER` 换成你的小写用户名。
3. 加好 2.2 的 `GH_PAT` Secret。
4. Actions → **Release (发版并通知下游)** → Run workflow → bump 选 **major** → 运行。
   仓库里版本是 0.1.0,首发 major 后 = **v1.0.0**,发布到 GitHub Packages。
5. 此时下游还没配 update-core.yml,dispatch 会打到空处,无害。先把包发出来,再接下游。

> 发版级别以后怎么选:patch=修 bug/换数据源镜像;minor=新增国家/kind/API;major=破坏兼容。
> 详见 core 的 docs/DEVLOG.md。

---

## 3. API 速查(消费方视角)

```js
import { createHolidayHub } from '@ivanphz/workdays-core';
const hub = await createHolidayHub(tokens, years, opts?);
```

| 参数 | 说明 |
|---|---|
| `tokens` | `['CN','US:market','HK']`,决定加载哪些数据集。见下方 token 表 |
| `years` | `[2026,2027]`,需要覆盖的年份。**窗口跨年就把两年都传**(跨年 observed 由次年的加载产生) |
| `opts.cnDefaultRule` | 裸 `'CN'` 的默认口径:`'bank'`(默认)或 `'market'`;其它值(含 v1 的 `'official'`)告警并按 bank |
| `opts.dataSource` | `'bundled'`(默认,零联网)或 `'online'`(活抓上游,按年覆盖归档、失败退档);其它值告警并按 bundled |
| `opts.lang` | 名称解析语言(`'sc'`/`'tc'`/`'en'`/...);缺省走铁律回落链 sc>tc>en>官方首语言(⚠️ 含译名——US 圣诞默认解析为"圣诞节",要官方英文名传 `'en'` 或读 `names.en`) |
| `opts.fetchImpl` | 自定义 fetch,仅 online 模式与测试用 |

| token(alpha-3 主写法;alpha-2 永久等价) | 含义 |
|---|---|
| `CHN` / `CHN:bank`(=`CN`) | 国务院法定调休口径(法定假=休,补班周末=上班) |
| `CHN:market` | A股/清算口径(补班不作数) |
| `HKG` / `HKG:public`(=`HK`) | 香港公众假期(三语官方,2018 起十年存档) |
| `USA` / `USA:bank`(=`US`) | 美国联邦/银行(含 observed 顺延) |
| `USA:market` | NYSE 交易日历(⚠️ 只答"开不开市",还款请用 `USA`) |
| `GBR` / `GBR:england`(=`GB`) | 英格兰+威尔士 bank holiday(默认;伦敦证交所≈E&W,不设 market) |
| `GBR:scotland` / `GBR:ni` | 苏格兰 / 北爱尔兰分域(假期互不相同,各成数据集) |
| `SGP` / `SGP:public`(=`SG`) | 新加坡公众假期(银行与 SGX 均随之;官方补假日已含在数据里) |

> 后端项目请统一用 **alpha-3** 写法;alpha-2 永久等价(内部 canonical,`fact.region` 恒为二位)。全称不作输入。

> **v2 词汇铁律**:一词一义,无别名(v1 的 `official` 等已全部移除,见 §10)。写错/写旧口径
> 不会报错,但会在 `loadLogs` 告警并按该国默认口径处理;"数据集未加载"同样告警并按纯周末
> 兜底(v1 的"US:market 未加载退用联邦"行为已移除)。配置错误绝不静默吞掉。

| hub 成员 | 层 | 说明 |
|---|---|---|
| `makeWorkdayChecker(tokens)` → `(Date\|'YYYY-MM-DD')=>boolean` | 结论 | 多国叠加:全为工作日才 true。空列表默认 `['CN']` |
| `isWorkday(token或数组, date)` | 结论 | 上面的便捷单发版 |
| `fact(token, 'YYYY-MM-DD')` → Fact\|null | 事实 | `{date, region, kind, dataset, isHoliday, isMakeup, name, observed, nominalDate}` |
| `listDays(token)` → `[{date,isOffDay,name}]` | 事实 | 与 holiday-cn `days[]` 同形同序(**alarm-api 零改造迁移的关键**) |
| `coverage` / `isCovered(token, date)` | 事实 | 该年数据来自打包归档(`bundled`)、活抓(`online`)、算法(`computed`)还是兜底(`fallback`)。`isCovered=false` 表示正在按纯周末猜,结果不可全信 |
| `fact(...)` 新增字段 | 事实 | `names`(官方∪译名全量多语)、`officialLangs`(官方语言数组;**判官方/译名:lang∈officialLangs?**) |
| `listDaysFull(token)` | 事实 | `[{date,isOffDay,observed,name,names}]`;`listDays` 保持 legacy 三键形状永不加键 |
| `officialLangsOf(token)` | 事实 | 该数据集的官方语言数组 |
| `localDateOf(token, at?)` | 时区 | 任意时刻 → 该地区此刻的民用日期。跨时区问"今天"必经此处:`isWorkday('USA:market', localDateOf('USA:market'))` |
| `exportJson(hub, token, opts?)` | 导出 | v2 信封 `{v:2,...,officialLangs,tz,lang,days:[{date,isOffDay,observed,name,names}]}`;`opts.lang` 逐次覆盖 |
| `exportIcs(hub, token, opts?)` | 导出 | 可导入/可订阅 ICS(全天事件;`opts.lang` SUMMARY 语言,补班前缀随之本地化;`opts.calName`;`opts.includeMakeup:false`) |
| `loadLogs` | 诊断 | 人类可读加载日志(数据源/镜像/失败告警),直接进 trace/诊断面板 |
| `cnDefaultRule` | 诊断 | `bank` 或 `market`(非法入参会告警并按 `bank`) |

**Fact 字段语义**:`isMakeup:true` = 补班周末(仅 CN);`observed:true` = 这天休的是顺延日,
`nominalDate` 告诉你名义节日是哪天(如 2026-07-03 休的是名义 2026-07-04 的独立日)。
CN 的 bank/market **共享同一份事实**(补班日两口径 fact 相同),分岔发生在结论层。

---

## 4. 两个消费者共用的 workflow:update-core.yml

两个项目**各自**新建 `.github/workflows/update-core.yml`,内容完全相同(仅 `@ivanphz` 要替换):

```yaml
# core 发版后自动升级依赖;也可在 Actions 页手动触发(Run workflow)兜底。
name: Update workdays-core

on:
  repository_dispatch:
    types: [workdays-core-release]   # 与 core 仓库 release.yml 里的 event_type 逐字对应
  workflow_dispatch:
    inputs:
      version:
        description: '指定版本(留空=latest;应急把本下游钉到旧版时手填,如 2.0.3)'
        required: false

permissions:
  contents: write

jobs:
  bump:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.GH_PAT }}   # ⚠️ 必须用 PAT:GITHUB_TOKEN 的 push 不会触发 deploy.yml

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: 'https://npm.pkg.github.com'
          scope: '@ivanphz'

      - name: 升级到指定/最新版并钉死精确版本
        run: npm install @ivanphz/workdays-core@${{ github.event.inputs.version || 'latest' }} --save-exact
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GH_PAT }}

      - name: 提交(有变化才提交)
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add package.json package-lock.json
          git diff --cached --quiet || git commit -m "chore: bump workdays-core to ${{ github.event.client_payload.version || 'latest' }}"
          git push
```

---

## 5. alarm-api 接入手册

> 迁移哲学:**rest-days.js 一个字不动**。core 的 `listDays('CN')` 输出与你现在
> 从 holiday-cn API 拉到的 `days[]` 同形同序,`makeRestDayChecker(holidayData, allEvents)`
> 感知不到任何变化。改动只发生在 index.js 的"拉数据"一段。

**操作顺序(每步之后仓库都保持可部署,严格按序):**

### 5.1 新建 `package.json`(仓库根目录,该项目现在没有这个文件)

```json
{
  "name": "ios-alarm-api",
  "private": true,
  "type": "module",
  "scripts": {
    "deploy": "wrangler deploy"
  }
}
```

(不用手写依赖 —— 下一步的 update-core 会自动加上并钉死版本。)

### 5.2 加 Secret `GH_PAT`(见 §2.2),新建 §4 的 `update-core.yml`,然后 Actions 手动 Run 一次

成功后它会提交:`package.json` 里多出 `"dependencies": { "@ivanphz/workdays-core": "1.0.0" }` + 新生成的 `package-lock.json`。
(这次提交会触发旧 deploy.yml,代码没变,部署照常成功。)

### 5.3 替换 `.github/workflows/deploy.yml` 为以下内容

与原版的差异只有两处:setup-node 带上私有源配置;wrangler 之前多一步 `npm ci`。
头部那段"一次性准备/CALENDAR_URLS 是 Worker Secret"的注释语义不变,故略;可保留原注释。

```yaml
name: Deploy to Cloudflare Workers

on:
  push:
    branches: [main]
  workflow_dispatch: {}

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repo
        uses: actions/checkout@v4

      - name: Setup Node(带 GitHub Packages 私有源)
        uses: actions/setup-node@v4
        with:
          node-version: 24
          registry-url: 'https://npm.pkg.github.com'
          scope: '@ivanphz'

      - name: 安装依赖(workdays-core 从私有源拉取)
        run: npm ci
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GH_PAT }}

      - name: Deploy with Wrangler
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CF_API_TOKEN }}
          accountId: ${{ secrets.CF_ACCOUNT_ID }}
          wranglerVersion: "4"
          # wrangler(esbuild)会自动把 node_modules 里 import 到的包打进 bundle
```

### 5.4 改 `src/index.js`(仅两处)

**① 文件顶部 import 区加一行:**

```js
import { createHolidayHub } from '@ivanphz/workdays-core';
```

**② 找到"── 2. 节假日数据"一段(约 313–330 行),整段替换:**

替换前(现状):

```js
    // ── 2. 节假日数据（跨年智能寻址 + 多镜像降级）───────────────────────────
    let holidayData = [];
    const years = [...new Set([baseDate.substring(0, 4), tomorrow.substring(0, 4)])];
    for (const year of years) {
      for (const apiUrl of CONFIG.API.HOLIDAY_URLS) {
        try {
          const res = await fetch(`${apiUrl}/${year}.json`);
          if (res.ok) {
            const data = await res.json();
            holidayData = holidayData.concat(data.days || []);
            trace.push(`[网络] 🌐 节假日数据: ${year}.json ✓`);
            break;
          }
        } catch (e) { /* 换下一个镜像 */ }
      }
    }
    if (holidayData.length === 0) {
      trace.push(`[网络⚠️] 节假日 API 全部失败，降级为自然周末推演（调休判断将失效！）`);
    }
```

替换后:

```js
    // ── 2. 节假日数据（workdays-core 单一真相源;跨年寻址 + 多镜像降级都在核内）──
    // years 含 yesterday 的年份:顺带修复原实现在 1 月上旬"昨日矩阵/向后块扫描
    // 跨入上一年却没拉上一年数据"的潜伏边界(此前静默按周末兜底)。
    const years = [...new Set([yesterday, baseDate, tomorrow].map(d => +d.substring(0, 4)))];
    const holidayHub = await createHolidayHub(['CN'], years);
    const holidayData = holidayHub.listDays('CN');   // [{date,isOffDay,name}] 与原 API days[] 同形
    holidayHub.loadLogs.forEach(l => trace.push(`[网络] 🌐 节假日: ${l}`));
    if (holidayData.length === 0) {
      trace.push(`[网络⚠️] 节假日数据全部失败，降级为自然周末推演（调休判断将失效！）`);
    }
```

之后 `const rc = makeRestDayChecker(holidayData, allEvents);` 等一切照旧 —— **rest-days.js、MANUAL_HOLIDAYS、块长逻辑全部不碰**。

### 5.5 清理 `src/config.default.js`

删除 `API.HOLIDAY_URLS` 整段(约 71–77 行,含 `API: { ... }` 外壳若其中只剩它)。
数据源地址已硬编码进 core,换源=core 发 patch,本仓库零改动。
若 `config.user.js` 里覆盖过 `API`,同步清掉,避免留下已死配置误导后人。

### 5.6 验证

浏览器打带 key 的调试 URL,看 trace:
- `[网络] 🌐 节假日: [CN 2026] via cdn.jsdelivr.net` 字样出现(来源改为 core 的 loadLogs);
- 拿一个已知补班周六 `?testDate=` 跑,矩阵行为与迁移前一致;
- `?testDate=2027-01-02` 之类年初日期,确认跨年数据齐全(新修复点)。

---

## 6. calendar-api 接入手册

> 迁移哲学:core 的 `createHolidayHub` 与你 `src/holidays/index.js` 的签名、行为**逐语义等价**
> (含空列表默认 `['CN']`、未知国家告警+周末兜底、`US:market` 未加载退用联邦、CN 三态、HK 别名)。
> 所以正文改动 = **一行 import**;其余全是工程配置。

**操作顺序(每步之后仓库都保持可部署,严格按序):**

### 6.1 加 Secret `GH_PAT`(§2.2),新建 §4 的 `update-core.yml`,Actions 手动 Run 一次

成功后 `package.json` 多出依赖 + 生成 `package-lock.json`(该提交只动包文件,不触发旧 deploy——旧 paths 过滤不含它们,正常)。

### 6.2 替换 `.github/workflows/deploy.yml` 为以下内容

⚠️ **头号坑在 paths**:自动升级提交只改 `package.json` / `package-lock.json`,
原 paths 过滤(`src/**`, `wrangler.toml`)不含它们 → **升级后永远不会自动部署**。必须加上。

```yaml
name: Deploy Repayment Calendar Worker

on:
  push:
    branches:
      - main
    paths:
      - 'src/**'
      - 'config/**'            # 用户领地改动也应触发部署(原文件漏了它则顺带补上;已有则保持)
      - 'wrangler.toml'
      - 'package.json'         # ⚠️ 新增:core 自动升级只动这两个文件
      - 'package-lock.json'    # ⚠️ 新增:没有这两行,升级提交不会触发部署
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    name: Deploy to Cloudflare
    steps:
      - name: Checkout 代码
        uses: actions/checkout@v4

      - name: Setup Node(带 GitHub Packages 私有源)
        uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: 'https://npm.pkg.github.com'
          scope: '@ivanphz'

      - name: 安装依赖(workdays-core 从私有源拉取)
        run: npm ci
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GH_PAT }}

      - name: 发布 Worker 到 Cloudflare
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CF_API_TOKEN }}
          accountId: ${{ secrets.CF_ACCOUNT_ID }}
          wranglerVersion: '4'
          command: deploy
```

> 注:原 `paths` 若与上面所列有出入,以"原有项全保留 + 新增 package 两行"为准。

### 6.3 正文迁移(建议在 github.dev 里一次提交完成)

1. `src/worker-entry.js` 第 26 行:

```js
// 改前
import { createHolidayHub } from './holidays/index.js';
// 改后
import { createHolidayHub } from '@ivanphz/workdays-core';
```

2. **删除整个 `src/holidays/` 目录**(index.js / cn.js / hk.js / us.js / us-market.js)。
   网页端删目录麻烦,用 github.dev(仓库页按 `.` 键)可一次删完并与上一步合并成单提交。

3. `test/hub.test.mjs`:3 处 `await import('../src/holidays/index.js')` 改为
   `await import('@ivanphz/workdays-core')`。文件里的 `globalThis.fetch` stub 依然生效
   (core 默认用 globalThis.fetch),金标准测试应全绿。

### 6.4 已知显示差异(行为不变,记录在案免得排查)

- `hub.loadLogs` 行文为 core 口径(如 `[CN] vendored holiday-cn(归档 N 年,generated …)`)。
- v2 起 `official` 不再是合法口径(会告警),升级前的清扫动作见 §10。

### 6.5 验证

- `?debug=1`(或既有诊断口)看【假期数据源状态】仍逐源打印;
- 抽查:CN 补班周六生成/不生成提醒与迁移前一致;`US:market` 账户在 GoodFriday 的行为一致;
- Actions 里手动 Run 一次 update-core,确认链路:bump 提交 → deploy 自动触发。

---

## 7. 日常运行

| 场景 | 动作 |
|---|---|
| core 改了代码要上线 | core 仓库 Actions → Release → 选级别 → Run。**其余全自动**(两下游升级+部署) |
| 节假日数据更新 | **不用做任何事**:每日流水线自动抓取、自动 patch 发版直达线上(见 §10.3) |
| 数据刷坏了要回滚 | core Actions → Rollback data → 填好版本 tag(见 §10.4) |
| 只想升某一个下游 | 该下游 Actions → Update workdays-core → Run workflow |
| 想钉住旧版不跟新 | 该下游暂时禁用 update-core.yml(Actions 页 Disable workflow)即可;deploy 用锁定的精确版本 |
| PAT 过期 | 重新生成,三个仓库的 `GH_PAT` Secret 更新为新值(名字不变) |
| 新增第三个消费者 | 照 §4-§6 套路接入;core 的 release.yml 顶部 `CONSUMER_REPOS` 加上仓库名 |

---

## 8. 故障排查表

| 症状 | 原因 | 解法 |
|---|---|---|
| 下游 `npm install/ci` 404 Not Found | scope 大小写(必须全小写)/ PAT 无 `read:packages` / setup-node 没配 registry-url+scope | 对照 §4/§5.3/§6.2 的 setup-node 与 env 写法 |
| 下游 `npm ci` 报 ENOLOCK/缺 lockfile | 还没跑过 update-core(它负责生成并提交 lockfile) | 先手动 Run 一次 update-core |
| core 发版后下游毫无反应 | core 仓库缺 `GH_PAT` Secret;或 PAT 无 `repo` scope;或 `CONSUMER_REPOS` 仓库名写错;或下游 `types:` 与 `event_type` 不一致 | 看 core Release 运行日志里 dispatch 步骤的 HTTP 返回;逐项核对 |
| update-core 提交了,但 deploy 没跑 | ① 下游 checkout 没用 PAT(GITHUB_TOKEN 的 push 不触发 workflow)② calendar-api 的 paths 没加 package 两行 | 对照 §4 的 checkout token 与 §6.2 的 paths |
| core 的 Release 里 `npm publish` 403 | release.yml 的 `permissions.packages: write` 被删;或包名 scope ≠ 仓库 owner | 恢复 permissions;包名必须 `@<owner小写>/workdays-core` |
| wrangler 构建报找不到 `@ivanphz/workdays-core` | deploy.yml 缺 `npm ci` 步骤(wrangler 只打包已安装的 node_modules) | 对照 §5.3/§6.2 补上 |
| Worker 线上运行报 fetch 相关错 | 不该发生:v2 起 core 运行时零联网 | 检查是否是消费方自身的 fetch;core 侧联网只发生在 CI 流水线 |
| 日志出现 `[WARN] 未识别的口径` | 配置里残留 v1 别名(如 `:official`)或拼写错误 | 全库搜 `:official` 换成规范口径;拼写对照 §3 token 表 |
| 假期判断按周末兜底且 `isCovered=false` | 该年份不在归档(公告未发 / HK 未首刷 / 超出范围) | core 仓库手动跑一次 Refresh workflow;公告未发属正常,等每年 11 月 |
| 自动刷新把坏数据发下去了 | 上游 holiday-cn / 1823 数据异常被收录 | core Actions → Rollback data → 填最近一个好版本 tag;若上游持续出错,同时 Disable refresh-data,上游修复后再 Enable |

---

## 9. 升级兼容承诺(消费方需要知道的)

- `createHolidayHub` 签名、`makeWorkdayChecker` 行为、`listDays` 形状、Fact 字段:受 semver 保护。
  **patch/minor 永不破坏它们**;要动它们 = major + 本手册同步更新。
- Fact 允许**新增**字段(minor),消费方请勿对字段做穷举断言。
- 数据源 URL 更换属 core 内部事务(patch),下游零感知 —— 这正是当初合并的目的。

---

## 10. v1 → v2 升级须知 + 数据流水线/回滚

### 10.1 v2 破坏性变更清单(major)

- **kind 别名全部移除**:`official`(CN/US)、HK 的 `bank/market/official` 伪口径不再合法 → 行为退默认口径 + `loadLogs` 告警。**升级前全库搜 `:official` 与 `cnRule=official`**,改为规范口径(`bank`/`market`/`public`)。
- **`opts.fetchImpl` 移除**:运行时零联网,无处可注(测试改为对 provider 直接注入数据)。
- **"US:market 未加载退用联邦"移除**:统一为"数据集未加载 → 告警 + 纯周末"。
- **coverage 的 CN/HK mode 由 `authoritative` 改为 `bundled`**(数据改打包内置)。

### 10.2 升级操作顺序(严格按序)

1. 两个下游各自全库搜 `:official` / `cnRule=official`,改为规范口径(没搜到就跳过);不放心可先 Disable 各自的 update-core workflow,改完再启用。
2. core 上传 v2 全部改动文件(文件清单与放置路径见交付说明)。
3. core Actions → **Release → major** → 发布 v2.0.0。此时 HK 归档为空、诚实降级;alarm-api 只用 CN,不受影响。
4. core Actions → **Refresh holiday data → Run workflow**(首次归档 HK、校准 CN)→ 数据变更自动触发 patch 发版 v2.0.1 → 下游自动升级部署。calendar-api 的 HK 判定在步骤 3→4 之间短暂按周末兜底,间隔仅几分钟。

### 10.3 数据流水线(全自动)

每日 05:30(北京时间)`refresh-data.yml` 抓上游 → **数据真变才提交** → 自动 patch 发版 → 下游自动升级部署。每年 11 月国务院公告一发,全链路无人值守直达线上;年中修正案(如 2020 春节延长那类)同样次日自动到线。归档铁律:**只增不删**(HK feed 是滚动窗口,本仓库即唯一历史存档;CN 某年抓取失败则保留既有归档)。安全网:发版前必跑测试,测试断言真实公告数据,上游数据异常大概率当场红灯拦截。

### 10.4 回滚 runbook(前滚式)

数据出错时:core Actions → **Rollback data → Run workflow** → 填目标版本(tag 如 `v2.0.3` 或 commit SHA)。它把 `src/data/` 恢复到该版本状态、提交并自动 patch 发版,顺现有升级链自动流到下游 —— 不碰 npm 撤包机制,链路零特殊处理。

⚠️ 两个配套动作:若坏数据来自上游且上游未修复,回滚后**同时 Disable refresh-data workflow**(否则次日刷新再次收录),上游修复后再 Enable;应急兜底方面,下游 update-core 支持手填版本号,可单独把某个下游钉到任意旧版(见 §4 模板的 `version` 输入)。


---

## 11. 订阅/导出:把库端出去做节假日数据服务

core 只出纯函数;"订阅"由一个极小的消费方 Worker 承担。可以新建一个 `holiday-feed` Worker,或在 calendar-api 里加一条路由。最小可用示例(整份 Worker):

```js
import { createHolidayHub, exportIcs, exportJson } from '@ivanphz/workdays-core';

export default {
  async fetch(req) {
    const url = new URL(req.url);
    const token = url.searchParams.get('cal') || 'CN';       // ?cal=CN / HK / US:market / GB:scotland ...
    const y = new Date().getUTCFullYear();
    const hub = await createHolidayHub([token], [y - 1, y, y + 1]);
    if (url.pathname.endsWith('.ics')) {
      return new Response(exportIcs(hub, token), {
        headers: { 'content-type': 'text/calendar; charset=utf-8' }
      });
    }
    return Response.json(exportJson(hub, token));
  }
};
```

- iOS/Google 日历订阅地址即 `https://<worker>/feed.ics?cal=CN`;JSON 接口即 `https://<worker>/?cal=HK`。
- 想要最鲜数据的端点可加 `{ dataSource: 'online' }`(SG 的在线编排偏慢,订阅场景建议默认 bundled)。
- ⚠️ 提醒时刻 / VALARM / 时区策略等【交付语义】不在 core:那是 calendar-api 的领地,别往 core 搬。


---

## 12. v2.3 新增能力速览(minor,默认行为一处有意变更)

- **三位码输入**:`CHN/HKG/USA/GBR/SGP` 与二位码逐语义等价(严格 ISO 双射,归一化在 parseToken 单一入口);后端项目统一改用三位码书写,存量二位码配置永久有效、无需迁移。
- **多语名称**:`fact.names` 全量多语(官方∪译名)、`officialLangs` 标记;`opts.lang` 定解析语言。⚠️ **默认行为变更**:`fact.name` / `listDays().name` 缺省走简中优先链、含译名——US/GB/SG 的名字默认变为简中(如 Christmas Day → 圣诞节)。两个下游不消费这些名字的业务语义,实测无感;要官方原名请传 `lang:'en'` 或读 `names`。
- **时区**:`localDateOf(token, at?)` + REGION_META 时区表;订阅端多语:`feed.ics?cal=HKG&lang=en`。
- **数据规范**:`docs/DATA-FORMAT.md`——新增国家、AI 生成数据文件、抓取契约、取值指南的唯一标准;HK/SG/GB 已收敛进通用归档引擎,新增清单型地区零 provider 代码。
- **迁移**:gb/sg 线上归档为旧格式属预期,读取容错、流水线首刷自动改写 schema 2,全程无人工步骤。
