import { applyFilters, type Filters } from "./aggregate";
import type { Gr4Row } from "./types";

// Выплаты общей таблицы по баерам (Decision 084). В «Депах» выплаты внесены по
// направлению (лицо + регион) без баера — поэтому в отчёте у баеров был 0.
// Делим, как лист «Факт выплат» финансовой таблицы:
//   доход баера в направлении = его Torro × (выплаты направления / Torro всех баеров в нём)
// Torro баера — доход из его таблицы GR4 за тот же период и с теми же фильтрами.
// Нет Torro ни у кого в направлении — выплата остаётся «без баера».
// Чистая функция.

export const NO_BUYER = "без баера";
const SPLIT: (keyof Gr4Row)[] = ["revenue", "depCountCpa", "depCountIb", "depAmountCpa", "depAmountIb", "payoutsCpa", "payoutsIb", "revenueCpa", "revenueIb"];
const dirOf = (r: Pick<Gr4Row, "face" | "region" | "country">) => `${r.face}|${r.region || r.country}`;
const isPayout = (r: Gr4Row) => !r.buyer && SPLIT.some((k) => Number(r[k]) !== 0);

export interface Allocation {
  rows: Gr4Row[];                    // общая таблица, выплаты разложены по баерам
  torro: Map<string, number>;        // Torro баера за период — для сравнения с фактом
  coef: Map<string, number | null>;  // направление → факт / Torro
}

export function allocate(main: Gr4Row[], buyers: Gr4Row[], filters: Filters, range: { from: string; to: string } | null): Allocation {
  const noBuyer = { ...filters, buyer: [] };
  const torroRows = applyFilters(buyers, noBuyer, range);
  const byDir = new Map<string, Map<string, number>>();
  const torro = new Map<string, number>();
  for (const r of torroRows) {
    if (!r.revenue) continue;
    const d = byDir.get(dirOf(r)) ?? byDir.set(dirOf(r), new Map()).get(dirOf(r))!;
    d.set(r.buyer, (d.get(r.buyer) ?? 0) + r.revenue);
    torro.set(r.buyer, (torro.get(r.buyer) ?? 0) + r.revenue);
  }

  const fact = new Map<string, number>();
  for (const r of applyFilters(main, noBuyer, range)) if (isPayout(r)) fact.set(dirOf(r), (fact.get(dirOf(r)) ?? 0) + r.revenue);
  const coef = new Map<string, number | null>();
  for (const [dir, f] of fact) {
    const t = [...(byDir.get(dir)?.values() ?? [])].reduce((s, v) => s + v, 0);
    coef.set(dir, t > 0 ? f / t : null);
  }

  const rows: Gr4Row[] = [];
  for (const r of main) {
    const shares = isPayout(r) ? byDir.get(dirOf(r)) : undefined;
    const total = shares ? [...shares.values()].reduce((s, v) => s + v, 0) : 0;
    if (!isPayout(r)) { rows.push(r); continue; }
    if (!shares || total <= 0) { rows.push({ ...r, buyer: NO_BUYER }); continue; }
    for (const [buyer, v] of shares) {
      const k = v / total;
      const part: Gr4Row = { ...r, buyer };
      for (const f of SPLIT) (part[f] as number) = Number(r[f]) * k;
      rows.push(part);
    }
  }
  return { rows, torro, coef };
}
