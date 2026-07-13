// 🇸🇬 SG fetcher — mom.gov.sg(MOM 官方 ICS 按年文件,官方仅英文)。
// 返回 { date: { names: { en }, observed: false } } | null。失败返 null。
export async function fetchSg(fetchImpl, years) {
  const f = fetchImpl || globalThis.fetch;
  try {
    const out = {};
    let hasData = false;

    for (const year of years) {
      const url = `https://www.mom.gov.sg/-/media/mom/documents/employment-practices/public-holidays/public-holidays-sg-${year}.ics`;
      try {
        const res = await f(url);
        if (!res.ok) continue;

        const text = await res.text();
        const lines = text.split(/\r?\n/);
        
        let inEvent = false;
        let currentDate = null;
        let currentSummary = null;

        for (const line of lines) {
          if (line.startsWith('BEGIN:VEVENT')) {
            inEvent = true; currentDate = null; currentSummary = null;
          } else if (line.startsWith('END:VEVENT')) {
            inEvent = false;
            if (currentDate && currentSummary) {
              out[currentDate] = { names: { en: currentSummary }, observed: false };
              hasData = true;
            }
          } else if (inEvent) {
            if (line.startsWith('DTSTART')) {
              const match = line.match(/:(\d{4})(\d{2})(\d{2})/);
              if (match) currentDate = `${match[1]}-${match[2]}-${match[3]}`;
            } else if (line.startsWith('SUMMARY:')) {
              currentSummary = line.substring(8).trim();
            }
          }
        }
      } catch (e) { /* 单个年份拉取失败不影响其余 */ }
    }
    return hasData ? out : null;
  } catch (e) { 
    return null; 
  }
}