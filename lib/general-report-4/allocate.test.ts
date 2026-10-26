// Самопроверка раскладки выплат по баерам. Запуск: npx tsx lib/general-report-4/allocate.test.ts
import assert from "node:assert/strict";
import { allocate, NO_BUYER } from "./allocate";
import type { Gr4Row } from "./types";

const row = (p: Partial<Gr4Row>): Gr4Row => ({
  date: "2026-10-05", country: "", face: "Роман", lang: "", region: "Испания", source: "", platform: "", funnel: "", buyer: "",
  revenue: 0, budget: 0, adClicks: 0, websiteClicks: 0, impressions: 0, registrations: 0, dialogs: 0,
  depCountCpa: 0, depCountIb: 0, depAmountCpa: 0, depAmountIb: 0, payoutsCpa: 0, payoutsIb: 0, revenueCpa: 0, revenueIb: 0,
  qualA: 0, qualB: 0, qualC: 0, qualD: 0, qualE: 0, ...p,
});
const main = [
  row({ buyer: "Артём - b1", budget: 100 }),                                   // трафик — как есть
  row({ revenue: 1100, revenueCpa: 1100, depCountCpa: 11 }),                   // выплаты Испании без баера
  row({ region: "LATAM", revenue: 300, revenueCpa: 300 }),                     // LATAM — Torro нет ни у кого
];
const buyers = [
  row({ buyer: "Артём - b1", revenue: 600 }), row({ buyer: "Матвей - b2", revenue: 400 }),
  row({ buyer: "Матвей - b2", revenue: 999, date: "2026-11-01" }),             // вне периода
];
const a = allocate(main, buyers, {}, { from: "2026-10-01", to: "2026-10-31" });
const rev = (b: string) => a.rows.filter((r) => r.buyer === b).reduce((s, r) => s + r.revenue, 0);
assert.equal(rev("Артём - b1"), 660);          // 1100 × 600/1000
assert.equal(rev("Матвей - b2"), 440);
assert.equal(rev(NO_BUYER), 300);
assert.equal(a.rows.reduce((s, r) => s + r.revenue, 0), 1400);   // сумма фактов сохраняется
assert.equal(a.coef.get("Роман|Испания"), 1.1);
assert.equal(a.coef.get("Роман|LATAM"), null);
assert.equal(a.torro.get("Матвей - b2"), 400);
assert.equal(a.rows.filter((r) => r.buyer === "Артём - b1").reduce((s, r) => s + r.depCountCpa, 0), 6.6);
console.log("gr4 allocate: ok");
