import type { Topup } from "./requests";

// Что с заявкой сейчас, поиск и фильтры списка (13.11.2026). Без серверных зависимостей —
// этим пользуются и страница, и бот.

// status в базе — четыре значения; «в работе» и «ищу перевод» — состояния ожидающей заявки.
export type Stage = "pending" | "work" | "search" | "paid" | "rejected" | "expired";
export const STAGES: { key: Stage; label: string }[] = [
  { key: "pending", label: "Ждёт оплаты" }, { key: "work", label: "В работе" }, { key: "search", label: "Ищу перевод" },
  { key: "paid", label: "Оплачено" }, { key: "rejected", label: "Отклонено" }, { key: "expired", label: "Время вышло" },
];

export function stage(r: Pick<Topup, "status" | "searching_since" | "taken_by">): Stage {
  if (r.status !== "pending") return r.status;
  return r.searching_since ? "search" : r.taken_by ? "work" : "pending";
}

export interface TopupFilter { q: string; stages: Stage[]; authors: string[]; kinds: string[]; targets: string[] }

// Пустой фильтр пропускает всё. Поиск — подстрока в номере, сумме, адресе, хэше, комментарии,
// категории, «куда», авторе и тех, кто брал и закрывал; запятая в сумме — как точка.
export function filterTopups(rows: Topup[], f: TopupFilter): Topup[] {
  const q = f.q.trim().toLowerCase().replace(/,/g, ".");
  const has = <T>(list: T[], v: T) => !list.length || list.includes(v);
  return rows.filter((r) => has(f.stages, stage(r)) && has(f.authors, r.author ?? "—") && has(f.kinds, r.kind) && has(f.targets, r.target)
    && (!q || [`#${r.number}`, r.amount, r.asset, r.network, r.kind, r.target, r.address, r.tx_hash, r.comment, r.author, r.taken_by, r.closed_by]
      .join(" ").toLowerCase().includes(q)));
}

// Сколько оплачено по монетам: «2 400 USDT · 350 GRAM».
export function paidTotals(rows: Topup[]): string {
  const by = new Map<string, number>();
  for (const r of rows) if (r.status === "paid") by.set(r.asset, (by.get(r.asset) ?? 0) + r.amount);
  return [...by].map(([a, s]) => `${s.toLocaleString("ru-RU", { maximumFractionDigits: 9 })} ${a}`).join(" · ");
}
