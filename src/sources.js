// ==============================================================================
// 🌐 src/sources.js — 全部上游数据源的抓取与解析(全库唯一一处)
// ==============================================================================
// 被两处共用,改这里处处生效:
//   · scripts/refresh-data.mjs(每日流水线 → 打包归档,默认路径)
//   · providers 的 online 模式(opts.dataSource:'online',可选路径,默认关)
//
// 【名称语言铁律】优先级: 简体中文 > 繁体中文 > 英文 > 当地语言。逐国落地:
//   CN: holiday-cn 即简中 ✓
//   HK: 1823 官方三语,按 sc.json → tc.json → en.json 顺序取(ICS 为格式兜底)
//   GB: gov.uk 仅英文(=第三优先;当地语言即英语,重合)
//   SG: data.gov.sg 仅英文(官方工作语言;马来语无机读源)
// 所有函数失败返回 null,绝不抛错、绝不返回半截数据 —— 调用方自行决定退档策略。

// ── 🇨🇳 CN: NateScarlet/holiday-cn(国务院公告机读版,简中) ────────────────────
export const CN_MIRRORS = [
  'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json',
  'https://fastly.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json',
  'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/{year}.json'
];

/** 某年 → [{date, isOffDay, names:{sc}}] | null(空壳年/全镜像失败 → null;schema 2 条目) */
export async function fetchCnYear(year, fetchImpl) {
  const f = fetchImpl || globalThis.fetch;
  for (const tpl of CN_MIRRORS) {
    try {
      const resp = await f(tpl.replace('{year}', year));
      if (resp && resp.ok) {
        const data = await resp.json();
        const days = (data.days || []).map(d => ({
          date: d.date,
          isOffDay: d.isOffDay === true,
          names: d.name != null ? { sc: d.name } : {}
        }));
        return days.length > 0 ? days : null;
      }
    } catch (e) { /* 换下一个镜像 */ }
  }
  return null;
}

// ── 🇭🇰 HK: 1823.gov.hk 官方(三语皆官方 → 三语全收;JSON 主源,ICS 格式兜底) ──
const HK_LANG_SOURCES = [
  { lang: 'sc', urls: [{ url: 'https://www.1823.gov.hk/common/ical/sc.json', type: 'json' }, { url: 'https://www.1823.gov.hk/common/ical/sc.ics', type: 'ics' }] },
  { lang: 'tc', urls: [{ url: 'https://www.1823.gov.hk/common/ical/tc.json', type: 'json' }, { url: 'https://www.1823.gov.hk/common/ical/tc.ics', type: 'ics' }] },
  { lang: 'en', urls: [{ url: 'https://www.1823.gov.hk/common/ical/en.json', type: 'json' }, { url: 'https://www.1823.gov.hk/common/ical/en.ics', type: 'ics' }, { url: 'https://r.jina.ai/https://www.1823.gov.hk/common/ical/en.ics', type: 'ics' }] }
];

/** RFC5545 反折叠: 行首空白的续行并回上一行 */
export function unfold(text) {
  return String(text).replace(/\r?\n[ \t]/g, '');
}

/** 1823 JSON(iCal 的 JSON 化形态)→ Map<'YYYY-MM-DD', name|null> */
export function parseHkJson(jsonObj) {
  const map = new Map();
  const vc = jsonObj?.vcalendar;
  const events = (Array.isArray(vc) && vc[0]?.vevent) || jsonObj?.vevent || [];
  for (const e of events) {
    const ds = Array.isArray(e?.dtstart) ? e.dtstart[0] : e?.dtstart;
    const raw = String(ds ?? '').slice(0, 8);
    if (!/^\d{8}$/.test(raw)) continue;
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    if (!map.has(date)) map.set(date, (e.summary ?? '').toString().trim() || null);
  }
  return map;
}

/** 1823 ICS → Map<'YYYY-MM-DD', name|null>(块解析抽 SUMMARY;全空回退整文扫日期) */
export function parseHkIcs(icsText) {
  const map = new Map();
  const t = unfold(icsText);
  for (const block of t.split(/BEGIN:VEVENT/).slice(1)) {
    const dm = /DTSTART[^:\r\n]*:(\d{8})/.exec(block);
    if (!dm) continue;
    const raw = dm[1];
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    const sm = /SUMMARY[^:\r\n]*:([^\r\n]*)/.exec(block);
    const name = sm ? sm[1].trim() || null : null;
    if (!map.has(date)) map.set(date, name);
  }
  if (map.size === 0) {
    const re = /DTSTART[^:\r\n]*:(\d{8})/g;
    let m;
    while ((m = re.exec(t)) !== null) {
      const raw = m[1];
      map.set(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`, null);
    }
  }
  return map;
}

/**
 * 三语全收抓 HK → { 'YYYY-MM-DD': { names: {sc?, tc?, en?} } } | null
 * 每种语言独立走"JSON → ICS"降级;任一语言成功即算成功(缺失的语言键不出现,
 * 读取端回落链自然处理)。三语皆官方(officialLangs),这里没有主次,只有全收。
 */
export async function fetchHkTrilingual(fetchImpl) {
  const f = fetchImpl || globalThis.fetch;
  const out = {};
  let anyLang = false;
  for (const { lang, urls } of HK_LANG_SOURCES) {
    for (const src of urls) {
      try {
        const resp = await f(src.url);
        if (!resp || !resp.ok) continue;
        const parsed = src.type === 'json' ? parseHkJson(await resp.json()) : parseHkIcs(await resp.text());
        if (parsed.size === 0) continue;
        for (const [date, name] of parsed) {
          if (!out[date]) out[date] = { names: {} };
          if (name != null) out[date].names[lang] = name;
        }
        anyLang = true;
        break; // 该语言已到手,换下一种语言
      } catch (e) { /* 换该语言的下一个源 */ }
    }
  }
  return anyLang ? out : null;
}

// ── 🇬🇧 GB: gov.uk 官方 JSON(三分治域一次抓齐;替代日 observed) ───────────────
export const GB_URL = 'https://www.gov.uk/bank-holidays.json';

/** → { eaw: {date:{name,observed}}, sct: {...}, nir: {...} } | null */
export async function fetchGbDivisions(fetchImpl) {
  const f = fetchImpl || globalThis.fetch;
  try {
    const resp = await f(GB_URL);
    if (!resp || !resp.ok) return null;
    const j = await resp.json();
    const keyOf = { 'england-and-wales': 'eaw', 'scotland': 'sct', 'northern-ireland': 'nir' };
    const out = { eaw: {}, sct: {}, nir: {} };
    let n = 0;
    for (const [divName, key] of Object.entries(keyOf)) {
      for (const ev of (j[divName]?.events || [])) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ev.date || '')) continue;
        out[key][ev.date] = { name: ev.title ?? null, observed: /substitute/i.test(`${ev.title || ''} ${ev.notes || ''}`) };
        n++;
      }
    }
    return n > 0 ? out : null;
  } catch (e) {
    return null;
  }
}

// ── 🇸🇬 SG: data.gov.sg(MOM 公众假期,按年数据集) ────────────────────────────
const SG_DATASET_SEARCH = 'https://api-production.data.gov.sg/v2/public/api/datasets?query=Public%20Holidays';
const SG_POLL_DOWNLOAD = (id) => `https://api-open.data.gov.sg/v1/public/api/datasets/${id}/poll-download`;

/** 极简 CSV 行切分(带引号感知) */
export function splitCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') { q = !q; continue; }
    if (ch === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(x => x.trim());
}

/**
 * → { 'YYYY-MM-DD': name } | null
 * ⚠️ 全库唯一未经实网验证的接口编排(交付环境无外网):data.gov.sg 新版 API 的
 * "搜数据集 → poll-download 取 CSV"两步。失败安全(返回 null,调用方退档);
 * 若接口形状有变,调整点集中在本函数;权威备用源: MOM 官网 public-holidays 页。
 */
export async function fetchSgDays(fetchImpl) {
  const f = fetchImpl || globalThis.fetch;
  try {
    const list = await (await f(SG_DATASET_SEARCH)).json();
    const datasets = (list?.data?.datasets || []).filter(d => /^Public Holidays for \d{4}$/i.test(d.name || ''));
    if (!datasets.length) return null;
    const days = {};
    for (const ds of datasets) {
      try {
        const poll = await (await f(SG_POLL_DOWNLOAD(ds.datasetId))).json();
        const url = poll?.data?.url;
        if (!url) continue;
        const lines = (await (await f(url)).text()).split(/\r?\n/).filter(Boolean);
        const header = splitCsvLine(lines[0] || '').map(h => h.toLowerCase());
        const di = header.indexOf('date'), hi = header.indexOf('holiday');
        if (di < 0 || hi < 0) continue;
        for (const line of lines.slice(1)) {
          const cols = splitCsvLine(line);
          if (/^\d{4}-\d{2}-\d{2}$/.test(cols[di] || '')) days[cols[di]] = cols[hi] || null;
        }
      } catch (e) { /* 单个数据集失败不影响其余 */ }
    }
    return Object.keys(days).length ? days : null;
  } catch (e) {
    return null;
  }
}
