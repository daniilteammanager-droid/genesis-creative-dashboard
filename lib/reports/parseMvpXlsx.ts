import type { MvpRow } from "./types";

type ColumnKey = "id" | "pdp" | "dia" | "depCount" | "redepCount" | "depSummary" | "redepSummary";

// Each column may appear under a technical (English) export name or the
// Russian MVP UI export name. Exact match is tried first, then substring,
// so "Подписчики" matches the "подписчик" candidate, etc.
const COLUMN_CANDIDATES: Record<ColumnKey, string[]> = {
  id:           ["campaign_id", "campaign id", "название", "name"],
  pdp:          ["sub", "подписчик"],
  dia:          ["chat", "диалог"],
  depCount:     ["dep_count", "кол-во продаж"],
  redepCount:   ["redep_count", "кол-во повторных"],
  depSummary:   ["dep_summary", "сумма продаж"],
  redepSummary: ["redep_summary", "сумма повторных"],
};

export type MvpColumnMap = Record<ColumnKey, number>;

function resolveColumn(header: string[], candidates: string[]): number {
  for (const c of candidates) {
    const i = header.indexOf(c);
    if (i !== -1) return i;
  }
  for (const c of candidates) {
    const i = header.findIndex((h) => h.includes(c));
    if (i !== -1) return i;
  }
  return -1;
}

function resolveMvpColumns(rawHeader: unknown[]): MvpColumnMap {
  const header = rawHeader.map((h) => String(h ?? "").trim().toLowerCase());
  const map = {} as MvpColumnMap;
  for (const key of Object.keys(COLUMN_CANDIDATES) as ColumnKey[]) {
    map[key] = resolveColumn(header, COLUMN_CANDIDATES[key]);
  }
  return map;
}

// "52639523402910.0" -> "52639523402910"; always a trimmed string
function normalizeCampaignId(v: unknown): string {
  return String(v ?? "").trim().replace(/\.0+$/, "");
}

function n(v: unknown): number {
  const s = String(v ?? "").replace(/\s/g, "").replace(",", ".");
  const num = parseFloat(s);
  return isNaN(num) ? 0 : num;
}

function toRow(row: unknown[], col: MvpColumnMap): MvpRow | null {
  const campaignId = normalizeCampaignId(row[col.id]);
  // Skip placeholders / non-campaign rows (empty, {{campaign.id}}, not_exists, __CAMPAIGN_ID__, etc.)
  if (!campaignId || !/^\d+$/.test(campaignId)) return null;
  return {
    campaignId,
    pdp:      col.pdp      !== -1 ? n(row[col.pdp])      : 0,
    dia:      col.dia      !== -1 ? n(row[col.dia])      : 0,
    deposits: (col.depCount   !== -1 ? n(row[col.depCount])   : 0) +
              (col.redepCount !== -1 ? n(row[col.redepCount]) : 0),
    revenue:  (col.depSummary   !== -1 ? n(row[col.depSummary])   : 0) +
              (col.redepSummary !== -1 ? n(row[col.redepSummary]) : 0),
  };
}

// Parses an MVP campaign-weekly XLSX sheet. Supports both the technical
// export (name/sub/chat/dep_count/redep_count/dep_summary/redep_summary)
// and the Russian UI export (Название/Подписчики/Диалоги/Кол-во продаж/...).
export function parseMvpXlsx(rawRows: unknown[][]): MvpRow[] {
  if (rawRows.length < 2) return [];
  const col = resolveMvpColumns(rawRows[0] as unknown[]);
  if (col.id === -1) return [];

  const results: MvpRow[] = [];
  for (let i = 1; i < rawRows.length; i++) {
    const row = toRow(rawRows[i] as unknown[], col);
    if (row) results.push(row);
  }
  return results;
}

// Same parse, but keeps rows whose campaign id is a CRM placeholder ("not_exists",
// "{{campaign.id}}", "__CAMPAIGN_ID__", ...) instead of dropping them — those still
// carry real deposits/revenue from clients with no linked ad-campaign data, and should
// still count toward totals (they just won't match any real Meta campaign — same
// "Долёты" bucket as a campaign_id with no current Meta counterpart). Used only by
// Reports Live; parseMvpXlsx() keeps the original strict behavior for Manual Report.
export function parseMvpXlsxWithPlaceholders(rawRows: unknown[][]): MvpRow[] {
  if (rawRows.length < 2) return [];
  const col = resolveMvpColumns(rawRows[0] as unknown[]);
  if (col.id === -1) return [];

  const results: MvpRow[] = [];
  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i] as unknown[];
    const campaignId = normalizeCampaignId(row[col.id]);
    if (!campaignId) continue;
    results.push({
      campaignId,
      pdp:      col.pdp      !== -1 ? n(row[col.pdp])      : 0,
      dia:      col.dia      !== -1 ? n(row[col.dia])      : 0,
      deposits: (col.depCount   !== -1 ? n(row[col.depCount])   : 0) +
                (col.redepCount !== -1 ? n(row[col.redepCount]) : 0),
      revenue:  (col.depSummary   !== -1 ? n(row[col.depSummary])   : 0) +
                (col.redepSummary !== -1 ? n(row[col.redepSummary]) : 0),
    });
  }
  return results;
}
