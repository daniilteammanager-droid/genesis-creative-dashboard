// Самопроверка календаря. Запуск: npx tsx lib/calendar.test.ts
import assert from "node:assert/strict";
import { monthGrid, rangeLabel, shiftMonth } from "./calendar";

const oct = monthGrid(2026, 9);   // октябрь 2026: 1-е — четверг
assert.equal(oct.length, 42);
assert.equal(oct[0].iso, "2026-09-28");
assert.equal(oct[3].iso, "2026-10-01");
assert.ok(oct[3].inMonth && !oct[0].inMonth);
assert.deepEqual(shiftMonth(2026, 11, 1), { y: 2027, m: 0 });
assert.equal(rangeLabel("2026-10-22", "2026-10-28"), "22–28 окт 2026");
assert.equal(rangeLabel("2026-10-28", "2026-10-28"), "28 окт 2026");
assert.equal(rangeLabel("2026-10-22", "2026-11-03"), "22 окт — 3 ноя 2026");
assert.equal(rangeLabel("2026-12-28", "2027-01-03"), "28 дек 2026 — 3 янв 2027");
console.log("calendar: ok");
