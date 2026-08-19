// Self-check for the WA parser + totals. No framework:
//   npx tsx lib/general-report/parseWaSheet.test.ts
import assert from "node:assert/strict";
import { parseWaSheet } from "./parseWaSheet";
import { computeWaTotals } from "./aggregate";

// 46204 = 2026-07-01. Header/TOTAL/month/summary rows must all be skipped.
const totalSheet: unknown[][] = [
  ["AD DATE", "Ad Budget", "Ad Clicks"],
  ["TOTAL", 999, 999],
  ["JULY", "", ""],
  //     0      1     2    3     4  5  6  7    8      9   10  11  12  13   14   15 16  17   18 19  20
  [46204, 100, 200, 5000, 0, 0, 0, 0, 10, 10, 0, 4, 3, 0, 2, 50, 0, 1, 0, 0, 1],
  ["Weekly Summary", 100, 200],
  [46205, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // all-zero → dropped
];

const rows = parseWaSheet("WA TOTAL", totalSheet);
assert.equal(rows.length, 1, "only the one non-empty day row survives");
assert.equal(rows[0].date, "2026-07-01");
assert.deepEqual(
  { budget: rows[0].budget, clicks: rows[0].clicks, impressions: rows[0].impressions,
    registrations: rows[0].registrations, wroteForBonus: rows[0].wroteForBonus,
    filledForm: rows[0].filledForm, enteredWeb: rows[0].enteredWeb,
    applications: rows[0].applications, payments: rows[0].payments },
  { budget: 100, clicks: 200, impressions: 5000, registrations: 10, wroteForBonus: 4,
    filledForm: 3, enteredWeb: 2, applications: 1, payments: 1 },
);
// Columns that only exist on the other funnel stay at zero.
assert.equal(rows[0].enteredBot, 0);
assert.equal(rows[0].opened1, 0);

// The articles sheet uses different indices for the same funnel stages.
const articlesSheet: unknown[][] = [
  ["AD DATE"],
  //     0     1   2    3     4  5  6  7   8   9  10 11 12 13 14 15 16 17 18 19 20 21 22 23
  [46235, 60, 40, 4000, 0, 0, 0, 0, 8, 0, 0, 5, 0, 0, 3, 0, 2, 2, 0, 0, 1, 0, 0, 1],
];
const aRows = parseWaSheet("WA СТАТЬИ", articlesSheet);
assert.equal(aRows.length, 1);
assert.equal(aRows[0].enteredBot, 5);
assert.equal(aRows[0].opened1, 3);
assert.equal(aRows[0].opened2, 2);
assert.equal(aRows[0].filledForm, 2);
assert.equal(aRows[0].applications, 1);
assert.equal(aRows[0].payments, 1);
assert.equal(aRows[0].wroteForBonus, 0, "TOTAL-only column stays zero here");

// A cell holding a formula error string must read as 0, not NaN.
const dirty = parseWaSheet("WA СТАТЬИ", [[46235, "#DIV/0!", 10]]);
assert.equal(dirty[0].budget, 0);
assert.equal(dirty[0].clicks, 10);

// Totals sum both funnels and derive ratios from the sums.
const t = computeWaTotals([...rows, ...aRows]);
assert.equal(t.budget, 160);
assert.equal(t.clicks, 240);
assert.equal(t.registrations, 18);
assert.equal(t.payments, 2);
assert.equal(t.cac, 80);                       // 160 / 2
assert.equal(t.costPerReg, 160 / 18);
assert.equal(t.siteCr, 18 / 240);
assert.equal(computeWaTotals([]).cac, null, "no payments → CAC is null, never Infinity");

console.log("✅ parseWaSheet + computeWaTotals self-check passed");
