import type { CrmAdByNameRow } from "./types";
import { resolveCrmColumns, crmAt } from "./crmColumns";

// Parses the CRM ad-level export keyed by ad NAME (not Ad ID) — "Название" holds the raw
// Meta ad name (occasionally falls back to a bare numeric ad id when the name wasn't
// resolved on the CRM side). Columns are resolved by header text, not fixed position —
// this sheet's own column order does not match the by-id export's (see crmColumns.ts).

export function parseCrmAdByNameExport(rows: unknown[][]): CrmAdByNameRow[] {
  if (rows.length < 2) return [];
  const col = resolveCrmColumns(rows[0] ?? []);
  const out: CrmAdByNameRow[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const adName = String(row[0] ?? "").trim();
    if (!adName) continue;

    out.push({
      adName,
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
