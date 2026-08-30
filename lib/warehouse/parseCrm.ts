import { resolveCrmColumns, type CrmColumnMap, type CrmColumnKey } from "@/lib/reports-live/crmColumns";

// Разбор выгрузок Torro для склада.
//
// Отличается от разбора для отчёта одним: здесь ничего не складывается и не
// подменяется нулями. Депозиты и повторные лежат четырьмя числами (Decision 039),
// а отсутствующая в выгрузке колонка даёт null, а не ноль — «не выгружали» и
// «выгрузили ноль» это разные утверждения, и склад обязан их различать.

export interface CrmNumbers {
  clicks: number | null;
  subscribers: number | null;
  dialogs: number | null;
  registrations: number | null;
  depCount: number | null;
  depSum: number | null;
  redepCount: number | null;
  redepSum: number | null;
  unsubscribes: number | null;
}

export interface CrmRow extends CrmNumbers {
  key: string;          // id кампании, id объявления или имя объявления
  campaignName?: string;
}

function at(row: unknown[], col: CrmColumnMap, k: CrmColumnKey): number | null {
  const i = col[k];
  if (i < 0) return null;                       // колонки не было в выгрузке
  const raw = String(row[i] ?? "").replace(/[$,\s]/g, "").replace(",", ".");
  if (raw === "") return null;                  // пустая клетка — тоже не ноль
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

// Второй столбец бывает именем кампании (в выгрузке по кампаниям) и не бывает
// в остальных. Определяем по заголовку, а не по позиции.
export function parseCrmSheet(values: unknown[][]): CrmRow[] {
  if (values.length < 2) return [];
  const header = values[0].map((h) => String(h ?? "").trim().toLowerCase());
  const col = resolveCrmColumns(values[0]);
  const nameIdx = header.findIndex((h) => h.includes("название кампании"));

  const out: CrmRow[] = [];
  for (const row of values.slice(1)) {
    const key = String(row[0] ?? "").trim();
    if (!key) continue;
    out.push({
      key,
      campaignName: nameIdx >= 0 ? String(row[nameIdx] ?? "").trim() || undefined : undefined,
      clicks: at(row, col, "clicks"),
      subscribers: at(row, col, "pdp"),
      dialogs: at(row, col, "dia"),
      registrations: at(row, col, "registrations"),
      depCount: at(row, col, "depCount"),
      depSum: at(row, col, "depSummary"),
      redepCount: at(row, col, "redepCount"),
      redepSum: at(row, col, "redepSummary"),
      unsubscribes: at(row, col, "unsubscribes"),
    });
  }
  return out;
}
