import type { CrmAdRow } from "./types";

// Parses the CRM ad-level export (weekly sheet or "All Data"): flat table, one row per Ad ID.
// Header: Название | Подписчики | Диалоги | Кол-во регистраций |
//         Кол-во продаж | Сумма продаж | Кол-во повторных продаж | Сумма повторных продаж | Отписки | ...

function n(v: unknown): number {
  const s = String(v ?? "").replace(/[$,\s]/g, "");
  const num = parseFloat(s);
  return Number.isFinite(num) ? num : 0;
}

export function parseCrmAdExport(rows: unknown[][]): CrmAdRow[] {
  if (rows.length < 2) return [];
  const out: CrmAdRow[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const adId = String(row[0] ?? "").trim();
    if (!adId || !/^\d+$/.test(adId)) continue;

    out.push({
      adId,
      pdp: n(row[1]),
      dia: n(row[2]),
      registrations: n(row[3]),
      deposits: n(row[4]) + n(row[6]), // Кол-во продаж + Кол-во повторных продаж
      revenue: n(row[5]) + n(row[7]),  // Сумма продаж + Сумма повторных продаж
      unsubscribes: n(row[8]),
    });
  }
  return out;
}
