// Комиссия заявки (Decision 132, 27.11.2026): «из суммы» — платёжка снимает процент с перевода (перевели 5 000, зашло 4 775);
// «сверху» — агент добавляет процент к бюджету (на бюджет 1 500, переводим 1 620). Без процента — разовый сбор суммой,
// справкой, как было. Чистые функции: форма, сервер и сообщение в чате считают одинаково.

export type FeeMode = "deduct" | "top";
export interface Fee { mode: FeeMode; pct: number }

const r2 = (n: number) => Math.round(n * 100) / 100;
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

// Что ввели → сколько переводим (amount заявки, по нему ищется перевод), комиссия и сколько зайдёт (на бюджет).
// input — «Переводим» для «из суммы» и без процента, «Нужно на бюджет» для «сверху». Перевод «сверху» — до цента.
export function feeCalc(fee: Fee | null, input: number, flat = 0): { amount: number; fee: number; net: number } {
  if (fee?.mode === "deduct") { const f = r2(input * fee.pct / 100); return { amount: input, fee: f, net: r6(input - f) }; }
  if (fee?.mode === "top") { const amount = r2(input * (1 + fee.pct / 100)); return { amount, fee: r6(amount - input), net: input }; }
  return { amount: input, fee: flat, net: r6(input - flat) };
}

export const feeTag = (f: Fee | null | undefined) =>
  !f ? "" : `${String(f.pct).replace(".", ",")}% ${f.mode === "top" ? "сверху" : "из суммы"}`;

// Строка заявки про комиссию: «зайдёт 4 775 · комиссия 225 (4,5% из суммы)», «на бюджет 1 500 · комиссия 120 (8% сверху)»,
// без процента — «комиссия 1». Нет комиссии — пусто.
type Row = { amount: number; fee: number; fee_mode?: FeeMode | null; fee_pct?: number | null };
const money = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 6 });
export function feeLine(r: Row): string {
  if (!r.fee) return "";
  const f = r.fee_mode && r.fee_pct ? { mode: r.fee_mode, pct: r.fee_pct } : null;
  if (!f) return `комиссия ${money(r.fee)}`;
  return `${f.mode === "top" ? "на бюджет" : "зайдёт"} ${money(r6(r.amount - r.fee))} · комиссия ${money(r.fee)} (${feeTag(f)})`;
}
