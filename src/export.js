// ==============================================================================
// 📤 src/export.js — 事实的序列化导出(JSON / ICS),纯函数,不含任何 HTTP
// ==============================================================================
// 与公理的关系(v2.2 决策,见 DEVLOG):这里输出的是【换了衣服的事实】——
// 假期清单的 JSON 信封与全天事件 ICS,不含提醒时刻/VALARM/时区策略等交付语义
// (那些仍是消费方 reminder-hub 的领地)。"订阅"= 消费方用一个极小的 Worker 路由
// 把这两个函数的返回值端出去(现成片段见 INTEGRATION.md),core 本身仍然不是服务。
//
// ICS 工程要点(沿袭 reminder-hub 的血泪经验):
//   · CRLF 行尾(RFC5545 强制,iOS 日历对此敏感);
//   · UID 与 DTSTAMP 【稳定】(由日期+数据集派生,不随生成时刻变)——
//     订阅客户端刷新时不会看到幽灵更新;
//   · 全天事件: DTSTART;VALUE=DATE + DTEND=次日;TRANSP:TRANSPARENT(不占忙闲)。

import { parseToken, resolveKind, datasetOf, getRegionMeta } from './tokens.js';
import { pickName } from './i18n.js';

/**
 * JSON 信封(v2: 多语全量): { v, source, token, region, kind, dataset,
 *   officialLangs, tz, lang, days:[{date, isOffDay, observed, name, names}] }
 * name = 按 opts.lang(缺省 hub.lang)解析的单名;names = 官方∪译名全量,
 * 判官方/译名: lang ∈ officialLangs ? 官方 : 译名。
 */
export function exportJson(hub, token, opts = {}) {
  const p = parseToken(token);
  const kind = p.known ? resolveKind(p.region, p.kind, hub.cnDefaultRule) : null;
  const lang = opts.lang ?? hub.lang ?? null;
  const days = hub.listDaysFull(token).map(d => ({
    ...d, name: lang !== hub.lang ? pickName(d.names, lang) : d.name
  }));
  return {
    v: 2,
    source: 'workdays-core',
    token: String(token),
    region: p.region,
    kind,
    dataset: p.known ? datasetOf(p.region, kind) : null,
    officialLangs: hub.officialLangsOf(token),
    tz: getRegionMeta()[p.region]?.tz ?? null,
    lang,
    days
  };
}

function icsEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function compact(dateStr) {
  return dateStr.replace(/-/g, '');
}

function nextDayCompact(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  const pad = n => ('0' + n).slice(-2);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

const MAKEUP_PREFIX = { sc: '补班 · ', tc: '補班 · ', en: 'Makeup workday · ' };
const OFFDAY_FALLBACK = { sc: '公众假期', tc: '公眾假期', en: 'Public holiday' }; // 最小档(无名条目)的占位名

/**
 * 可导入/可订阅的 ICS 日历(全天事件)。
 * @param opts { calName?: 日历名(默认 "<token> 假期"),
 *               lang?: SUMMARY 语言(缺省 hub.lang;再缺省走铁律回落链),
 *               includeMakeup?: 是否包含 CN 补班日事件(默认 true,前缀按 lang 本地化) }
 */
export function exportIcs(hub, token, opts = {}) {
  const includeMakeup = opts.includeMakeup !== false;
  const lang = opts.lang ?? hub.lang ?? null;
  const p = parseToken(token);
  const kind = p.known ? resolveKind(p.region, p.kind, hub.cnDefaultRule) : null;
  const dataset = p.known ? datasetOf(p.region, kind) : 'UNKNOWN';
  const calName = opts.calName ?? `${String(token)} 假期`;

  const L = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//workdays-core//holiday feed//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsEscape(calName)}`
  ];
  for (const d of hub.listDaysFull(token)) {
    if (!d.isOffDay && !includeMakeup) continue;
    const name = pickName(d.names, lang) ?? d.name;
    const summary = d.isOffDay
      ? (name ?? (OFFDAY_FALLBACK[lang] ?? OFFDAY_FALLBACK.sc))
      : `${MAKEUP_PREFIX[lang] ?? MAKEUP_PREFIX.sc}${name ?? '调休'}`;
    L.push(
      'BEGIN:VEVENT',
      `UID:${d.date}-${dataset}@workdays-core`,
      `DTSTAMP:${compact(d.date)}T000000Z`,
      `DTSTART;VALUE=DATE:${compact(d.date)}`,
      `DTEND;VALUE=DATE:${nextDayCompact(d.date)}`,
      `SUMMARY:${icsEscape(summary)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT'
    );
  }
  L.push('END:VCALENDAR');
  return L.join('\r\n') + '\r\n';
}
