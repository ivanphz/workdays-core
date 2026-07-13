// 🇬🇧 GB fetcher — gov.uk 官方 JSON,一次抓齐三分治域。官方仅英文。
// 返回 { 'GB-EAW': {date:条目}, 'GB-SCT': {...}, 'GB-NIR': {...} } | null(多 dataset 键)。
const URL = 'https://www.gov.uk/bank-holidays.json';
const KEY = { 'england-and-wales': 'GB-EAW', 'scotland': 'GB-SCT', 'northern-ireland': 'GB-NIR' };

export async function fetchGb(fetchImpl) {
  const f = fetchImpl || globalThis.fetch;
  try {
    const resp = await f(URL);
    if (!resp || !resp.ok) return null;
    const j = await resp.json();
    const out = { 'GB-EAW': {}, 'GB-SCT': {}, 'GB-NIR': {} };
    let n = 0;
    for (const [div, dsId] of Object.entries(KEY)) {
      for (const ev of (j[div]?.events || [])) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ev.date || '')) continue;
        out[dsId][ev.date] = { names: { en: ev.title ?? null }, observed: /substitute/i.test(`${ev.title || ''} ${ev.notes || ''}`) };
        n++;
      }
    }
    return n > 0 ? out : null;
  } catch (e) { return null; }
}
