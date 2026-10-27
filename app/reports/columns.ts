import type { TreeNode } from "@/lib/warehouse/reportTree";

// Столбцы отчёта — как в General 4.0, кроме CPA/IB: тут просто число депов и доход.
// Общие для дерева кампаний и таблицы по креативам. Производные — из сумм строки,
// а не средним детей (Decision 024). Прочерк — числа не было в выгрузке (Decision 039).

export type Metrics = Pick<TreeNode, "spend" | "clicks" | "impressions" | "lpClicks" | "subscribers" | "dialogs" | "depCount" | "depSum" | "quals">
  // Decision 089: только у строк склада Reports; в Креативах их нет — там прочерк.
  & Partial<Pick<TreeNode, "linkClicks" | "results" | "reach">>;

export const n = (v: number | null, d = 0) =>
  v === null ? "—" : v.toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d });
export const money = (v: number | null) => (v === null ? "—" : `$${n(v, 2)}`);

export function romi(spend: number, revenue: number | null): string {
  if (revenue === null) return "—";
  if (spend <= 0) return revenue > 0 ? "∞" : "—";
  return `${(((revenue - spend) / spend) * 100).toFixed(0)}%`;
}

const ratio = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : a / b);
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
const quals = (x: Metrics) => (x.quals ? x.quals.reduce((s, v) => s + v, 0) : null);
const QUAL = ["A", "B", "C", "D", "E"];
export type Col = { label: string; cell: (x: Metrics) => string; strong?: boolean };
export const COLS: Col[] = [
  { label: "Расход", cell: (x) => money(x.spend), strong: true },
  { label: "Доход", cell: (x) => money(x.depSum), strong: true },
  { label: "Net Profit", cell: (x) => (x.depSum === null ? "—" : money(x.depSum - x.spend)) },
  { label: "ROMI", cell: (x) => romi(x.spend, x.depSum) },
  { label: "ROAS", cell: (x) => { const v = ratio(x.depSum, x.spend); return v === null ? "—" : v.toFixed(2); } },
  { label: "Показы", cell: (x) => n(x.impressions) },
  // Охват — за один день из склада, за период — живьём из Meta (Decision 089).
  { label: "Охват", cell: (x) => n(x.reach ?? null) },
  { label: "Частота", cell: (x) => { const v = ratio(x.reach ? x.impressions : null, x.reach ?? null); return v === null ? "—" : v.toFixed(2); } },
  { label: "Клики", cell: (x) => n(x.clicks) },
  { label: "Клики по ссылке", cell: (x) => n(x.linkClicks ?? null) },
  { label: "Результаты", cell: (x) => n(x.results ?? null) },
  { label: "Цена результата", cell: (x) => money(ratio(x.results ? x.spend : null, x.results ?? null)) },
  { label: "CPM", cell: (x) => money(x.impressions ? (x.spend / x.impressions) * 1000 : null) },
  { label: "CPC", cell: (x) => money(ratio(x.spend, x.clicks)) },
  { label: "CTR", cell: (x) => pct(ratio(x.clicks, x.impressions)) },
  { label: "Клики на ленде", cell: (x) => n(x.lpClicks) },
  { label: "CR% клик → ленд", cell: (x) => pct(ratio(x.lpClicks, x.clicks)) },
  { label: "CR% ленд → канал", cell: (x) => pct(ratio(x.subscribers, x.lpClicks)) },
  { label: "Подписки", cell: (x) => n(x.subscribers) },
  { label: "Общая CR", cell: (x) => pct(ratio(x.subscribers, x.clicks)) },
  { label: "Цена подписки", cell: (x) => money(ratio(x.spend, x.subscribers)), strong: true },
  { label: "Диалоги", cell: (x) => n(x.dialogs) },
  { label: "CR% в диалог", cell: (x) => pct(ratio(x.dialogs, x.subscribers)) },
  { label: "Цена диалога", cell: (x) => money(ratio(x.spend, x.dialogs)), strong: true },
  { label: "Депы", cell: (x) => n(x.depCount) },
  { label: "CR% диалог → деп", cell: (x) => pct(ratio(x.depCount, x.dialogs)) },
  { label: "CAC", cell: (x) => money(ratio(x.spend, x.depCount)) },
  { label: "Квалы", cell: (x) => n(quals(x)) },
  { label: "Неквалы", cell: (x) => { const q = quals(x); return q === null || x.dialogs === null ? "—" : n(x.dialogs - q); } },
  ...QUAL.map((k, i): Col => ({ label: `Квал ${k}`, cell: (x) => n(x.quals ? x.quals[i] : null) })),
  ...QUAL.map((k, i): Col => ({ label: `% ${k}`, cell: (x) => pct(x.quals ? ratio(x.quals[i], quals(x)) : null) })),
];


// Итоги того, что сейчас на экране, — для карточек Live Manager (как у Артёма).
export function totalsOf(list: Metrics[]) {
  const sum = (f: (x: Metrics) => number | null | undefined) => list.reduce((s, x) => s + (f(x) ?? 0), 0);
  const spend = sum((x) => x.spend), sub = sum((x) => x.subscribers), dia = sum((x) => x.dialogs);
  return {
    spend, clicks: sum((x) => x.clicks), impressions: sum((x) => x.impressions), lpClicks: sum((x) => x.lpClicks),
    subscribers: sub, dialogs: dia, depCount: sum((x) => x.depCount), depSum: sum((x) => x.depSum),
    cpaPdp: sub ? spend / sub : null, cpaDia: dia ? spend / dia : null,
  };
}

// Сортировки Live Manager — как у Артёма.
export const SORTS: { id: string; label: string; key: (x: Metrics & { name: string }) => number | string | null; asc?: boolean }[] = [
  { id: "spend", label: "Spend ↓", key: (x) => x.spend },
  { id: "pdp", label: "ПДП ↓", key: (x) => x.subscribers },
  { id: "dia", label: "ДИА ↓", key: (x) => x.dialogs },
  { id: "cpaPdp", label: "Цена ПДП ↑", key: (x) => ratio(x.subscribers ? x.spend : null, x.subscribers), asc: true },
  { id: "cpaDia", label: "Цена ДИА ↑", key: (x) => ratio(x.dialogs ? x.spend : null, x.dialogs), asc: true },
  { id: "romi", label: "ROMI ↓", key: (x) => (x.depSum === null || !x.spend ? null : (x.depSum - x.spend) / x.spend) },
  { id: "name", label: "Название А→Я", key: (x) => x.name, asc: true },
];
export function sortBy<T extends Metrics & { name: string }>(list: T[], id: string): T[] {
  const s = SORTS.find((x) => x.id === id) ?? SORTS[0];
  return [...list].sort((a, b) => {
    const ka = s.key(a), kb = s.key(b);
    if (ka === null && kb === null) return 0;
    if (ka === null) return 1;
    if (kb === null) return -1;
    const c = typeof ka === "string" ? ka.localeCompare(String(kb), "ru", { numeric: true }) : (ka as number) - (kb as number);
    return s.asc ? c : -c;
  });
}
