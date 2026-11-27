// Самопроверка аналитики «Пополнений»: npx tsx lib/topups/analytics.test.ts
import assert from "node:assert/strict";
import { inRange, series, totalsOf, whereTo, whoAsks } from "./analytics";

type Row = Parameters<typeof totalsOf>[0][number];
const row = (p: Partial<Row>): Row => ({
  status: "paid", asset: "USDT", amount: 100, paid_amount: null, fee: 0, kind: "Карты", target: "Brocard",
  created_at: "2026-11-20T10:00:00Z", author: "Даниил", ...p,
});
const rows = [
  row({ amount: 5000, paid_amount: 500, fee: 1 }),                                  // ушло 500, а не 5000 (#144)
  row({ target: "FBMcards", amount: 2500, created_at: "2026-11-21T22:30:00Z" }),     // 22.11 по Москве
  row({ kind: "Агенты", target: "TSR", amount: 1000, author: "Артём", created_at: "2026-11-26T09:00:00Z" }),
  row({ asset: "GRAM", network: undefined, amount: 350, author: "Вика" } as Partial<Row>),
  row({ status: "pending", amount: 300 }),
  row({ status: "rejected", amount: 9999 }),
];

const t = totalsOf(rows);
assert.deepEqual(t, { sent: 4000, sentN: 3, paid: 4, fee: 1, other: { GRAM: 350 }, waiting: 1, waitingSum: 300 });

// Период — по дню создания в Москве: 21.11 22:30 UTC — уже 22.11.
assert.equal(inRange(rows, { since: "2026-11-22", until: "2026-11-22" }).length, 1);
assert.equal(inRange(rows, { since: "", until: "" }).length, rows.length);

const where = whereTo(rows);
assert.deepEqual(where.map((c) => [c.name, c.v, c.n]), [["Карты", 3000, 2], ["Агенты", 1000, 1]]);
assert.deepEqual(where[0].subs.map((s) => [s.name, s.v]), [["FBMcards", 2500], ["Brocard", 500]]);

const who = whoAsks(rows);
assert.deepEqual(who.map((w) => [w.name, w.v, w.n, w.top]), [["Даниил", 3000, 2, "Карты · FBMcards"], ["Артём", 1000, 1, "Агенты · TSR"]]);

// По дням — пустые дни нулём; по неделям — куски по 7 от начала периода.
const days = series(rows, { since: "2026-11-20", until: "2026-11-26" }, "day");
assert.deepEqual(days.map((p) => p.v), [500, 0, 2500, 0, 0, 0, 1000]);
assert.equal(days[0].label, "20");
const weeks = series(rows, { since: "2026-11-16", until: "2026-11-30" }, "week");
assert.deepEqual(weeks.map((p) => [p.label, p.v]), [["16–22", 3000], ["23–29", 1000], ["30", 0]]);
// Без границ — от первой оплаченной заявки до «сегодня».
assert.equal(series(rows, { since: "", until: "" }, "day", "2026-11-27").length, 8);

console.log("topups analytics: ok");
