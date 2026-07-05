import type { MvpRow } from "./types";

// Accepts raw rows from XLSX.utils.sheet_to_json(ws, { header: 1 })
// Expected columns (by index in the header row):
//   0: "Название"                   → campaign_id
//   2: "Подписчики"                 → PDP
//   3: "Диалоги"                    → DIA
//   5: "Кол-во продаж"              → sales count
//   6: "Сумма продаж"               → sales revenue
//   7: "Кол-во повторных продаж"    → re-sales count
//   8: "Сумма повторных продаж"     → re-sales revenue
export function parseMvpReport(rawRows: unknown[][]): MvpRow[] {
  if (rawRows.length < 2) return [];

  const header = rawRows[0] as string[];
  const colIdx = buildColIndex(header);

  const results: MvpRow[] = [];
  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i] as unknown[];
    const campaignId = String(row[colIdx.id] ?? "").trim();
    if (!campaignId) continue;

    const pdp      = toNum(row[colIdx.pdp]);
    const dia      = toNum(row[colIdx.dia]);
    const sales    = toNum(row[colIdx.sales]);
    const salesAmt = toNum(row[colIdx.salesAmt]);
    const reSales  = toNum(row[colIdx.reSales]);
    const reSalesAmt = toNum(row[colIdx.reSalesAmt]);

    results.push({
      campaignId,
      pdp,
      dia,
      deposits: sales + reSales,
      revenue: salesAmt + reSalesAmt,
    });
  }
  return results;
}

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Finds column indices by header text, falls back to positional defaults.
function buildColIndex(header: string[]): {
  id: number; pdp: number; dia: number;
  sales: number; salesAmt: number; reSales: number; reSalesAmt: number;
} {
  const find = (candidates: string[]) => {
    for (const c of candidates) {
      const i = header.findIndex((h) => String(h ?? "").toLowerCase().includes(c.toLowerCase()));
      if (i >= 0) return i;
    }
    return -1;
  };

  return {
    id:         find(["название"]) !== -1 ? find(["название"]) : 0,
    pdp:        find(["подписчик"]) !== -1 ? find(["подписчик"]) : 2,
    dia:        find(["диалог"]) !== -1 ? find(["диалог"]) : 3,
    sales:      find(["кол-во продаж", "кол-во прод"]) !== -1 ? find(["кол-во продаж", "кол-во прод"]) : 5,
    salesAmt:   find(["сумма продаж"]) !== -1 ? find(["сумма продаж"]) : 6,
    reSales:    find(["кол-во повторных"]) !== -1 ? find(["кол-во повторных"]) : 7,
    reSalesAmt: find(["сумма повторных"]) !== -1 ? find(["сумма повторных"]) : 8,
  };
}
