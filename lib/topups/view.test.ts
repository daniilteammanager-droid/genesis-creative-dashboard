// Самопроверка поиска и фильтров заявок. Запуск: npx tsx lib/topups/view.test.ts
import assert from "node:assert/strict";
import type { Topup } from "./requests";
import { filterTopups, paidTotals, stage, type TopupFilter } from "./view";

const row = (p: Partial<Topup>): Topup => ({
  id: "x", number: 1, user_id: "u", kind: "Карты", target: "Brocard", amount: 100, fee: 0, asset: "USDT", network: "TRC20",
  address: "TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G", comment: null, expires_at: null, status: "pending", taken_by: null, taken_at: null,
  searching_since: null, tx_hash: null, paid_amount: null, paid_at: null, closed_by: null, messages: [], created_at: "", author: "Андрей", ...p,
});
const rows = [
  row({ number: 118 }),
  row({ number: 117, taken_by: "@danya", kind: "Расходники", target: "Прокси", amount: 120.5, asset: "USDC", network: "ERC20", author: "Влад" }),
  row({ number: 116, status: "paid", tx_hash: "68249536abc", amount: 0.0154, asset: "BTC", network: "BTC", comment: "агент в BTC" }),
  row({ number: 115, status: "paid", amount: 2400 }),
];
const none: TopupFilter = { q: "", stages: [], authors: [], kinds: [], targets: [] };

assert.deepEqual(rows.map(stage), ["pending", "work", "paid", "paid"]);
assert.equal(stage(row({ taken_by: "@a", searching_since: "t" })), "search");   // «Оплачено» после «Беру» — уже поиск
assert.equal(filterTopups(rows, none).length, 4);
const nums = (f: Partial<typeof none>) => filterTopups(rows, { ...none, ...f }).map((r) => r.number);
assert.deepEqual(nums({ q: "#117" }), [117]);
assert.deepEqual(nums({ q: "120,5" }), [117]);            // запятая в сумме — как точка
assert.deepEqual(nums({ q: "68249536" }), [116]);         // по хэшу
assert.deepEqual(nums({ q: "  АГЕНТ " }), [116]);          // регистр и пробелы по краям
assert.deepEqual(nums({ q: "@danya" }), [117]);           // кто взял
assert.deepEqual(nums({ stages: ["work", "pending"] }), [118, 117]);
assert.deepEqual(nums({ authors: ["Влад"] }), [117]);
assert.deepEqual(nums({ kinds: ["Карты"], targets: ["Brocard"], stages: ["paid"] }), [116, 115]);
assert.equal(paidTotals(rows).replace(/\s/g, " "), "0,0154 BTC · 2 400 USDT");   // ru-RU ставит неразрывный пробел
console.log("topups view: ok");
