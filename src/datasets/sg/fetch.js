// 🇸🇬 SG fetcher — data.gov.sg(MOM 按年数据集,官方仅英文)。
// 返回 { date: {names:{en}} } | null。多步编排偏慢;失败返 null。
const SEARCH = 'https://api-production.data.gov.sg/v2/public/api/datasets?query=Public%20Holidays';
const POLL = (id) => `https://api-open.data.gov.sg/v1/public/api/datasets/${id}/poll-download`;
function splitCsv(line) {
  const out = []; let cur = '', q = false;
  for (const ch of line) { if (ch === '"') { q = !q; continue; } if (ch === ',' && !q) { out.push(cur); cur = ''; continue; } cur += ch; }
  out.push(cur); return out.map(x => x.trim());
}
export async function fetchSg(fetchImpl) {
  const f = fetchImpl || globalThis.fetch;
  try {
    const list = await (await f(SEARCH)).json();
    const dsets = (list?.data?.datasets || []).filter(d => /^Public Holidays for \d{4}$/i.test(d.name || ''));
    if (!dsets.length) return null;
    const out = {};
    for (const ds of dsets) {
      try {
        const poll = await (await f(POLL(ds.datasetId))).json();
        const url = poll?.data?.url; if (!url) continue;
        const lines = (await (await f(url)).text()).split(/\r?\n/).filter(Boolean);
        const h = splitCsv(lines[0] || '').map(x => x.toLowerCase());
        const di = h.indexOf('date'), hi = h.indexOf('holiday');
        if (di < 0 || hi < 0) continue;
        for (const line of lines.slice(1)) {
          const c = splitCsv(line);
          if (/^\d{4}-\d{2}-\d{2}$/.test(c[di] || '')) out[c[di]] = { names: { en: c[hi] || null }, observed: false };
        }
      } catch (e) { /* 单个数据集失败不影响其余 */ }
    }
    return Object.keys(out).length ? out : null;
  } catch (e) { return null; }
}
