import type { TreeNode } from "@/lib/warehouse/reportTree";

// Столбцы отчёта — как в General 4.0, кроме CPA/IB: тут просто число депов и доход.
// Общие для дерева кампаний и таблицы по креативам. Производные — из сумм строки,
// а не средним детей (Decision 024). Прочерк — числа не было в выгрузке (Decision 039).

export type Metrics = Pick<TreeNode, "spend" | "clicks" | "impressions" | "lpClicks" | "subscribers" | "dialogs" | "depCount" | "depSum" | "quals">;

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
  { label: "Клики", cell: (x) => n(x.clicks) },
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

