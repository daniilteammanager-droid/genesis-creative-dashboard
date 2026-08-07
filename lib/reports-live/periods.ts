// CRM exports are organized as one sheet per week, named "YYYY-MM-DD_YYYY-MM-DD".
// ponytail: weekly only for now — daily sheets (MVP_CAMPAIGN_DAILY_XLSX_URL) can reuse
// this same key format once that granularity is wired up.

export interface Period {
  key: string;
  since: string;
  until: string;
}

const WEEK_RE = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/;

export function parsePeriod(key: string): Period | null {
  const m = WEEK_RE.exec(key);
  return m ? { key, since: m[1], until: m[2] } : null;
}

export function toPeriods(sheetTitles: string[]): Period[] {
  return sheetTitles
    .map(parsePeriod)
    .filter((p): p is Period => p !== null)
    .sort((a, b) => b.since.localeCompare(a.since));
}
