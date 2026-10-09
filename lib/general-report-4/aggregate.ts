import { computeTotals, type Granularity } from "../general-report/aggregate";
import type { Gr4Dim, Gr4Row, Gr4Totals } from "./types";

// Суммы и производные — общие с GR 3.0 (computeTotals), сверху только то,
// чего в его итогах нет. Всё считается из сумм, а не из формул таблицы.

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export function computeTotals4(rows: Gr4Row[]): Gr4Totals {
  const t = computeTotals(rows);
  const deps = t.depCountCpa + t.depCountIb;
  return {
    ...t,
    romiCpa: ratio(t.revenueCpa - t.budget, t.budget),
    crTotal: ratio(t.registrations, t.adClicks),
    cacPayouts: ratio(t.budget, t.payoutsCpa + t.payoutsIb),
    awDep: ratio(t.depAmountCpa + t.depAmountIb, deps),
  };
}

export type Filters = Partial<Record<Gr4Dim, string[]>>;

// Пустой или отсутствующий список по разрезу — «все».
export function applyFilters(rows: Gr4Row[], f: Filters, range: { from: string; to: string } | null): Gr4Row[] {
  const active = (Object.entries(f) as [Gr4Dim, string[] | undefined][])
    .filter(([, v]) => v && v.length > 0)
    .map(([k, v]) => [k, new Set(v)] as const);
  return rows.filter((r) =>
    (!range || (r.date >= range.from && r.date <= range.to)) &&
    active.every(([k, set]) => set.has(r[k])),
  );
}

export type Period = Granularity | "all";

const MONTHS = ["ЯНВАРЬ", "ФЕВРАЛЬ", "МАРТ", "АПРЕЛЬ", "МАЙ", "ИЮНЬ",
  "ИЮЛЬ", "АВГУСТ", "СЕНТЯБРЬ", "ОКТЯБРЬ", "НОЯБРЬ", "ДЕКАБРЬ"];

const dm = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

// Неделя — с понедельника по воскресенье, ключ — дата понедельника: сортируется
// строкой и не путается на стыке годов, в отличие от номера ISO-недели.
export function periodOf(date: string, p: Period): { key: string; label: string } {
  if (p === "all") return { key: "all", label: "Весь период" };
  const [y, m, d] = date.split("-");
  if (p === "day") return { key: date, label: `${d}.${m}.${y}` };
  if (p === "month") return { key: `${y}-${m}`, label: `${MONTHS[+m - 1]} ${y}` };
  const day = new Date(date + "T00:00:00Z");
  const mon = new Date(day);
  mon.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  return { key: mon.toISOString().slice(0, 10), label: `${dm(mon)}–${dm(sun)}.${sun.getUTCFullYear()}` };
}

export interface Gr4Group extends Gr4Totals {
  key: string;
  label: string;
  children?: Gr4Group[];   // разбивка внутри периода
}

function group(rows: Gr4Row[], keyOf: (r: Gr4Row) => { key: string; label: string }) {
  const buckets = new Map<string, { label: string; rows: Gr4Row[] }>();
  for (const r of rows) {
    const { key, label } = keyOf(r);
    const b = buckets.get(key) ?? buckets.set(key, { label, rows: [] }).get(key)!;
    b.rows.push(r);
  }
  return [...buckets].map(([key, b]) => ({ key, label: b.label, rows: b.rows }));
}

// Периоды — новые сверху. Разбивка внутри периода — по спенду, потом по доходу:
// живые строки наверх, нулевые вниз.
export function buildGroups(rows: Gr4Row[], period: Period, by: Gr4Dim | null): Gr4Group[] {
  return group(rows, (r) => periodOf(r.date, period))
    .sort((a, b) => b.key.localeCompare(a.key))
    .map((p) => ({
      key: p.key,
      label: p.label,
      ...computeTotals4(p.rows),
      children: by
        ? group(p.rows, (r) => ({ key: r[by] || "—", label: r[by] || "—" }))
            .map((c) => ({ key: c.key, label: c.label, ...computeTotals4(c.rows) }))
            .sort((a, b) => b.budget - a.budget || b.revenue - a.revenue || a.label.localeCompare(b.label, "ru"))
        : undefined,
    }));
}

// Значения разреза, которые реально встречаются в данных, — для фильтров.
export function distinctValues(rows: Gr4Row[], dim: Gr4Dim): string[] {
  return [...new Set(rows.map((r) => r[dim]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
}
