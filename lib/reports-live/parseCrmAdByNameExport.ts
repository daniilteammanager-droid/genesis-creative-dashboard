import type { CrmAdByNameRow } from "./types";

// Parses the CRM ad-level export keyed by ad NAME (not Ad ID) — same column layout
// as parseCrmAdExport, but "Название" holds the raw Meta ad name (occasionally falls
// back to a bare numeric ad id when the name wasn't resolved on the CRM side).
// Header: Название | Подписчики | Диалоги | Кол-во регистраций |
//         Кол-во продаж | Сумма продаж | Кол-во повторных продаж | Сумма повторных продаж | Отписки | ...

function n(v: unknown): number {
  const s = String(v ?? "").replace(/[$,\s]/g, "");
  const num = parseFloat(s);
  return Number.isFinite(num) ? num : 0;
}

export function parseCrmAdByNameExport(rows: unknown[][]): CrmAdByNameRow[] {
  if (rows.length < 2) return [];
  const out: CrmAdByNameRow[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const adName = String(row[0] ?? "").trim();
    if (!adName) continue;

    out.push({
      adName,
      pdp: n(row[1]),
      dia: n(row[2]),
      registrations: n(row[3]),
      deposits: n(row[4]) + n(row[6]),
      revenue: n(row[5]) + n(row[7]),
      unsubscribes: n(row[8]),
    });
  }
  return out;
}
