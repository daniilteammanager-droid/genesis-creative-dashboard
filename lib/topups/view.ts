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

// Кнопки владельца у открытой заявки на странице (Decision 126) — те же, что в чате. Это только вид: условия
// проверяют take / release / pressPaid / reject в requests.ts, чей бы клик ни пришёл. me — имя профиля.
export function openActions(r: Pick<Topup, "status" | "searching_since" | "taken_by">, me: string) {
  const st = stage(r);
  const mine = st === "work" && r.taken_by === me;
  return {
    take: st === "pending", paid: st === "pending" || st === "work", release: mine, mine,
    reject: st === "pending" || st === "work" || st === "search", hash: st === "search",
  };
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

// Сколько ушло по оплаченной заявке: что пришло на адрес по блокчейну (paid_amount), а не что просили. Хэш ответом
// закрывает заявку любым переводом на её адрес — #144 (20.11.2026): просили 5000, пришло 500. Нет paid_amount — сумма заявки.
export const received = (r: Pick<Topup, "amount" | "paid_amount">) => r.paid_amount ?? r.amount;
