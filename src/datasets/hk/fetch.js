// 🇭🇰 HK fetcher — 1823 官方三语(sc/tc/en 皆官方,全收);每语言 JSON→ICS 降级。
// 返回 { date: {names:{sc?,tc?,en?}, observed:false} } | null。契约见 DATASET-GUIDE.md。
const LANG_SOURCES = [
  { lang: 'sc', urls: [['https://www.1823.gov.hk/common/ical/sc.json','json'],['https://www.1823.gov.hk/common/ical/sc.ics','ics']] },
  { lang: 'tc', urls: [['https://www.1823.gov.hk/common/ical/tc.json','json'],['https://www.1823.gov.hk/common/ical/tc.ics','ics']] },
  { lang: 'en', urls: [['https://www.1823.gov.hk/common/ical/en.json','json'],['https://www.1823.gov.hk/common/ical/en.ics','ics'],['https://r.jina.ai/https://www.1823.gov.hk/common/ical/en.ics','ics']] }
];

function unfold(t) { return String(t).replace(/\r?\n[ \t]/g, ''); }
function parseJson(o) {
  const m = new Map();
  const vc = o?.vcalendar;
  const evs = (Array.isArray(vc) && vc[0]?.vevent) || o?.vevent || [];
  for (const e of evs) {
    const ds = Array.isArray(e?.dtstart) ? e.dtstart[0] : e?.dtstart;
    const raw = String(ds ?? '').slice(0, 8);
    if (!/^\d{8}$/.test(raw)) continue;
    const d = `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
    if (!m.has(d)) m.set(d, (e.summary ?? '').toString().trim() || null);
  }
  return m;
}
function parseIcs(text) {
  const m = new Map(), t = unfold(text);
  for (const b of t.split(/BEGIN:VEVENT/).slice(1)) {
    const dm = /DTSTART[^:\r\n]*:(\d{8})/.exec(b);
    if (!dm) continue;
    const raw = dm[1], d = `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
    const sm = /SUMMARY[^:\r\n]*:([^\r\n]*)/.exec(b);
    if (!m.has(d)) m.set(d, sm ? sm[1].trim() || null : null);
  }
  return m;
}

export async function fetchHk(fetchImpl) {
  const f = fetchImpl || globalThis.fetch;
  const out = {}; let any = false;
  for (const { lang, urls } of LANG_SOURCES) {
    for (const [url, type] of urls) {
      try {
        const resp = await f(url);
        if (!resp || !resp.ok) continue;
        const parsed = type === 'json' ? parseJson(await resp.json()) : parseIcs(await resp.text());
        if (parsed.size === 0) continue;
        for (const [date, name] of parsed) {
          if (!out[date]) out[date] = { names: {}, observed: false };
          if (name != null) out[date].names[lang] = name;
        }
        any = true; break;
      } catch (e) { /* 该语言下一个源 */ }
    }
  }
  return any ? out : null;
}
