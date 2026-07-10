# INTEGRATION.md — workdays-core 对接手册

> **这份文档给谁看**:`alarm-api` 与 `reminder-hub` 两个项目(以及任何未来消费者)。
> 照本手册操作即可完成接入;不需要读 core 源码。全程 GitHub 网页操作,不需要本地环境。
>
> **心智模型一句话**:workdays-core 是一个 npm 库(发布在 GitHub Packages 私有源),
> 你 `import` 它、在自己 Worker 进程内现算;它给"事实",你下"结论"。
> 私有日历/请假判定与它无关,继续留在 alarm-api 本地。

---

## 0. 占位符约定(全文替换一次)

本文所有 `OWNER` = 你的 GitHub 用户名,**一律小写**(npm 包名不允许大写)。
出现位置:包名 `@OWNER/workdays-core`、workflow 里的 `scope: '@OWNER'`、`npm install @OWNER/...`。

core 仓库内还有两处占位符要改(建仓时一次性):`package.json` 的 `name` 和 `repository.url`。

---

## 1. 全景图:一次发版,两个下游自动跟进

```
[workdays-core 仓库]
  Actions → Release → 选 patch/minor/major
    ├─ npm test(不过不发)
    ├─ npm version + tag + 发布到 GitHub Packages
    └─ repository_dispatch ──→ [alarm-api]    update-core.yml: 升级依赖并提交
                            └→ [reminder-hub] update-core.yml: 升级依赖并提交
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

在 **workdays-core / alarm-api / reminder-hub** 三个仓库分别:
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
import { createHolidayHub } from '@OWNER/workdays-core';
const hub = await createHolidayHub(tokens, years, opts?);
```

| 参数 | 说明 |
|---|---|
| `tokens` | `['CN','US:market','HK']`,决定加载哪些数据集。见下方 token 表 |
| `years` | `[2026,2027]`,需要覆盖的年份。**窗口跨年就把两年都传**(跨年 observed 由次年的加载产生) |
| `opts.cnDefaultRule` | 裸 `'CN'` 的默认口径:`'bank'`(默认;`'official'` 为等价别名)或 `'market'` |
| `opts.fetchImpl` | 测试注入用的自定义 fetch,生产不用传 |

| token | 含义 |
|---|---|
| `CN` / `CN:bank` / `CN:official` | 国务院法定调休口径(法定假=休,补班周末=上班) |
| `CN:market` | A股/清算口径(补班不作数) |
| `HK`(`:bank/:market/:official` 全为等价别名) | 香港公众假期 |
| `US` / `US:bank` / `US:official` | 美国联邦/银行(含 observed 顺延) |
| `US:market` | NYSE 交易日历(⚠️ 只答"开不开市",还款请用 `US`) |

| hub 成员 | 层 | 说明 |
|---|---|---|
| `makeWorkdayChecker(tokens)` → `(Date\|'YYYY-MM-DD')=>boolean` | 结论 | 多国叠加:全为工作日才 true。空列表默认 `['CN']` |
| `isWorkday(token或数组, date)` | 结论 | 上面的便捷单发版 |
| `fact(token, 'YYYY-MM-DD')` → Fact\|null | 事实 | `{date, region, kind, dataset, isHoliday, isMakeup, name, observed, nominalDate}` |
| `listDays(token)` → `[{date,isOffDay,name}]` | 事实 | 与 holiday-cn `days[]` 同形同序(**alarm-api 零改造迁移的关键**) |
| `coverage` / `isCovered(token, date)` | 事实 | 该年数据是权威(`authoritative`)、算法(`computed`)还是兜底(`fallback`)。`isCovered=false` 表示正在按纯周末猜,结果不可全信 |
| `loadLogs` | 诊断 | 人类可读加载日志(数据源/镜像/失败告警),直接进 trace/诊断面板 |
| `cnDefaultRule` | 诊断 | canonical 值:`bank` 或 `market`(入参 `official` 会归一显示为 `bank`) |

**Fact 字段语义**:`isMakeup:true` = 补班周末(仅 CN);`observed:true` = 这天休的是顺延日,
`nominalDate` 告诉你名义节日是哪天(如 2026-07-03 休的是名义 2026-07-04 的独立日)。
CN 的 bank/market **共享同一份事实**(补班日两口径 fact 相同),分岔发生在结论层。

---

## 4. 两个消费者共用的 workflow:update-core.yml

两个项目**各自**新建 `.github/workflows/update-core.yml`,内容完全相同(仅 `@OWNER` 要替换):

```yaml
# core 发版后自动升级依赖;也可在 Actions 页手动触发(Run workflow)兜底。
name: Update workdays-core

on:
  repository_dispatch:
    types: [workdays-core-release]   # 与 core 仓库 release.yml 里的 event_type 逐字对应
  workflow_dispatch: {}

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
          scope: '@OWNER'

      - name: 升级到最新版并钉死精确版本
        run: npm install @OWNER/workdays-core@latest --save-exact
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

成功后它会提交:`package.json` 里多出 `"dependencies": { "@OWNER/workdays-core": "1.0.0" }` + 新生成的 `package-lock.json`。
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
          scope: '@OWNER'

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
import { createHolidayHub } from '@OWNER/workdays-core';
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

## 6. reminder-hub 接入手册

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
          scope: '@OWNER'

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
import { createHolidayHub } from '@OWNER/workdays-core';
```

2. **删除整个 `src/holidays/` 目录**(index.js / cn.js / hk.js / us.js / us-market.js)。
   网页端删目录麻烦,用 github.dev(仓库页按 `.` 键)可一次删完并与上一步合并成单提交。

3. `test/hub.test.mjs`:3 处 `await import('../src/holidays/index.js')` 改为
   `await import('@OWNER/workdays-core')`。文件里的 `globalThis.fetch` stub 依然生效
   (core 默认用 globalThis.fetch),金标准测试应全绿。

### 6.4 已知的两处无害显示差异(行为不变,记录在案免得排查)

- 诊断输出里 `cnDefaultRule` 显示 canonical 名:`official` → **`bank`**(语义相同:国务院法定调休口径)。`?cnRule=official` 参数照常接受。
- `hub.loadLogs` 行文微调(如 `[HK] 1823.gov.hk via ...` 带假期条数)。

### 6.5 验证

- `?debug=1`(或既有诊断口)看【假期数据源状态】仍逐源打印;
- 抽查:CN 补班周六生成/不生成提醒与迁移前一致;`US:market` 账户在 GoodFriday 的行为一致;
- Actions 里手动 Run 一次 update-core,确认链路:bump 提交 → deploy 自动触发。

---

## 7. 日常运行

| 场景 | 动作 |
|---|---|
| core 改了代码要上线 | core 仓库 Actions → Release → 选级别 → Run。**其余全自动**(两下游升级+部署) |
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
| update-core 提交了,但 deploy 没跑 | ① 下游 checkout 没用 PAT(GITHUB_TOKEN 的 push 不触发 workflow)② reminder-hub 的 paths 没加 package 两行 | 对照 §4 的 checkout token 与 §6.2 的 paths |
| core 的 Release 里 `npm publish` 403 | release.yml 的 `permissions.packages: write` 被删;或包名 scope ≠ 仓库 owner | 恢复 permissions;包名必须 `@<owner小写>/workdays-core` |
| wrangler 构建报找不到 `@OWNER/workdays-core` | deploy.yml 缺 `npm ci` 步骤(wrangler 只打包已安装的 node_modules) | 对照 §5.3/§6.2 补上 |
| Worker 线上运行报 fetch 相关错 | 不该发生:core 只在 `createHolidayHub` 里用 fetch,Workers 原生支持 | 检查是否把 core 用在了非 Workers/Node18+ 环境 |

---

## 9. 升级兼容承诺(消费方需要知道的)

- `createHolidayHub` 签名、`makeWorkdayChecker` 行为、`listDays` 形状、Fact 字段:受 semver 保护。
  **patch/minor 永不破坏它们**;要动它们 = major + 本手册同步更新。
- Fact 允许**新增**字段(minor),消费方请勿对字段做穷举断言。
- 数据源 URL 更换属 core 内部事务(patch),下游零感知 —— 这正是当初合并的目的。
