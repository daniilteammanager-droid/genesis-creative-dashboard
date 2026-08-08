import type { CrmAdRow } from "./types";
import { resolveCrmColumns, crmAt } from "./crmColumns";

// Parses the CRM ad-level export (weekly sheet or "All Data"): flat table, one row per Ad ID.
// Columns are resolved by header text, not fixed position — this sheet's column order
// does not match the by-name export's (see crmColumns.ts).

export function parseCrmAdExport(rows: unknown[][]): CrmAdRow[] {
  if (rows.length < 2) return [];
  const col = resolveCrmColumns(rows[0] ?? []);
  const out: CrmAdRow[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const adId = String(row[0] ?? "").trim();
    if (!adId || !/^\d+$/.test(adId)) continue;

    out.push({
      adId,
      pdp: crmAt(row, col, "pdp"),
      dia: crmAt(row, col, "dia"),
      registrations: crmAt(row, col, "registrations"),
      deposits: crmAt(row, col, "depCount") + crmAt(row, col, "redepCount"),
      revenue: crmAt(row, col, "depSummary") + crmAt(row, col, "redepSummary"),
      unsubscribes: crmAt(row, col, "unsubscribes"),
    });
  }
  return out;
}
