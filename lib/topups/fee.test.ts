// Самопроверка комиссии заявки: npx tsx lib/topups/fee.test.ts
import assert from "node:assert/strict";
import { feeCalc, feeLine, feeTag } from "./fee";

// Примеры Даниила: платёжка — 5 000 с 4,5% из суммы; агент — бюджет 1 500 и 8% сверху.
assert.deepEqual(feeCalc({ mode: "deduct", pct: 4.5 }, 5000), { amount: 5000, fee: 225, net: 4775 });
assert.deepEqual(feeCalc({ mode: "top", pct: 8 }, 1500), { amount: 1620, fee: 120, net: 1500 });
// Без процента — разовый сбор суммой, перевод как есть.
assert.deepEqual(feeCalc(null, 45, 0.5), { amount: 45, fee: 0.5, net: 44.5 });
// Перевод «сверху» — до цента, комиссия — разница без хвостов плавающей точки.
assert.deepEqual(feeCalc({ mode: "top", pct: 4.5 }, 1234.56), { amount: 1290.12, fee: 55.56, net: 1234.56 });
assert.deepEqual(feeCalc({ mode: "deduct", pct: 4.5 }, 1000.17), { amount: 1000.17, fee: 45.01, net: 955.16 });

assert.equal(feeTag({ mode: "deduct", pct: 4.5 }), "4,5% из суммы");
assert.equal(feeTag(null), "");
assert.equal(feeLine({ amount: 5000, fee: 225, fee_mode: "deduct", fee_pct: 4.5 }).replace(/\s/g, " "), "зайдёт 4 775 · комиссия 225 (4,5% из суммы)");
assert.equal(feeLine({ amount: 1620, fee: 120, fee_mode: "top", fee_pct: 8 }).replace(/\s/g, " "), "на бюджет 1 500 · комиссия 120 (8% сверху)");
assert.equal(feeLine({ amount: 45, fee: 0.5 }), "комиссия 0,5");
assert.equal(feeLine({ amount: 45, fee: 0 }), "");

console.log("topups fee: ok");
