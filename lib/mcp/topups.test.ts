// Самопроверка пополнений через AI (Decision 121). Запуск: npx tsx lib/mcp/topups.test.ts
import assert from "node:assert/strict";
import { guard, PER_HOUR, pickTopups, rowOf, summarize, type Query } from "./topups";
import type { Topup } from "@/lib/topups/requests";

const row = (p: Partial<Topup>): Topup => ({
  id: "x", number: 1, user_id: "a", kind: "Карты", target: "Brocard", amount: 100, fee: 0, asset: "USDT", network: "TRC20",
  address: "T1", comment: null, expires_at: null, status: "pending", taken_by: null, taken_at: null,
  searching_since: null, tx_hash: null, paid_amount: null, paid_at: null, closed_by: null, messages: [], wallet: null, manual_address: false,
  created_at: "2026-11-10T09:00:00Z", author: "Андрей", ...p,
});
const rows = [
  row({ number: 5, status: "paid", amount: 0.1, created_at: "2026-11-15T22:30:00Z" }),       // 16.11 по Москве
  row({ number: 4, status: "paid", amount: 0.2, created_at: "2026-11-14T10:00:00Z" }),
  row({ number: 3, status: "paid", amount: 0.0154, asset: "BTC", network: "BTC", user_id: "b", author: "Влад", kind: "Агенты", target: "T2A", created_at: "2026-10-30T10:00:00Z" }),
  row({ number: 2, taken_by: "@danya", amount: 50, kind: "Расходники", target: "Прокси", user_id: "b", author: "Влад" }),
  row({ number: 1, status: "rejected", amount: 70, asset: "USDC", network: "ERC20", created_at: "2026-10-01T10:00:00Z" }),
];
const all: Query = { since: null, until: null, userId: null, stages: [], kinds: [], targets: [], assets: [], q: "" };
const nums = (f: Partial<Query>) => pickTopups(rows, { ...all, ...f }).map((r) => r.number);

assert.deepEqual(nums({}), [5, 4, 3, 2, 1]);
assert.deepEqual(nums({ since: "2026-11-16" }), [5], "день — по Москве, 22:30 UTC — уже 16.11");
assert.deepEqual(nums({ since: "2026-11-01", until: "2026-11-14" }), [4, 2]);
assert.deepEqual(nums({ userId: "b" }), [3, 2]);
assert.deepEqual(nums({ kinds: ["карты"] }), [5, 4, 1], "категория без учёта регистра");
assert.deepEqual(nums({ targets: ["t2a"], stages: ["paid"] }), [3]);
assert.deepEqual(nums({ stages: ["work"] }), [2]);
assert.deepEqual(nums({ assets: ["usdc"] }), [1]);
assert.deepEqual(nums({ q: "#3" }), [3]);

// Сводка: суммы по монетам, 0.1 + 0.2 без хвоста плавающей точки, оплаченное отдельно.
const [total] = summarize(rows, "total");
assert.deepEqual(total, { name: "Итого", count: 5, paid_count: 3, amount: { USDT: 50.3, BTC: 0.0154, USDC: 70 }, paid: { USDT: 0.3, BTC: 0.0154 } });
assert.deepEqual(summarize(rows, "author").map((s) => [s.name, s.count]), [["Андрей", 3], ["Влад", 2]]);
assert.deepEqual(summarize(rows, "status").map((s) => s.name), ["Оплачено", "В работе", "Отклонено"]);
assert.deepEqual(summarize(rows, "month").map((s) => s.name), ["2026-10", "2026-11"], "месяцы — по порядку");
assert.equal(summarize(rows, "coin")[0].name, "USDT · TRC20");
assert.equal(summarize(rows, "target").find((s) => s.name === "Агенты · T2A")?.paid.BTC, 0.0154);
assert.deepEqual(summarize([], "total"), []);
// paid — что пришло по блокчейну, amount — что просили (#144: 5000 → 500).
assert.deepEqual(summarize([row({ status: "paid", amount: 5000, paid_amount: 500 })], "total")[0].paid, { USDT: 500 });
assert.deepEqual(summarize([row({ status: "paid", amount: 5000, paid_amount: 500 })], "total")[0].amount, { USDT: 5000 });

// Строка списка: статус словами, пустое не тащим.
const r = rowOf(rows[0]);
assert.equal(r.status, "Оплачено");
assert.equal(r.created, "2026-11-16 01:30");
assert.equal(r.fee, undefined);
assert.equal(r.expires, undefined);
// Защита платёжного чата: повтор той же заявки и поток заявок.
const now = Date.parse("2026-11-16T12:00:00Z");
const ago = (min: number) => new Date(now - min * 60_000).toISOString();
const sent = [{ chat_id: 1, message_id: 1 }];
const fresh = row({ number: 9, address: "TA", amount: 120.5, created_at: ago(5), messages: sent });
assert.match(guard([fresh], { address: "TA", amount: 120.5 }, now) ?? "", /уже есть: #9/, "повтор после обрыва не задваивает");
assert.equal(guard([fresh], { address: "TA", amount: 120 }, now), null, "другая сумма — можно");
assert.equal(guard([fresh], { address: "TB", amount: 120.5 }, now), null, "другой адрес — можно");
assert.equal(guard([{ ...fresh, created_at: ago(31) }], { address: "TA", amount: 120.5 }, now), null, "полчаса прошло");
assert.equal(guard([{ ...fresh, status: "paid" }], { address: "TA", amount: 120.5 }, now), null, "оплаченная не мешает");
assert.equal(guard([{ ...fresh, messages: [] }], { address: "TA", amount: 120.5 }, now), null, "не дошла до чата — повтор можно");
const many = Array.from({ length: PER_HOUR }, (_, i) => row({ number: 20 + i, address: `T${i}`, created_at: ago(50) }));
assert.match(guard(many, { address: "TZ", amount: 1 }, now) ?? "", /За последний час/);
assert.equal(guard(many.map((r) => ({ ...r, created_at: ago(61) })), { address: "TZ", amount: 1 }, now), null);
console.log("mcp topups: ok");
