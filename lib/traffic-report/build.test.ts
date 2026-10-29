// Самопроверка отчёта по трафику. Запуск: npx tsx lib/traffic-report/build.test.ts
import assert from "node:assert/strict";
import { buildReport, romiBand, stageOf, totalOf } from "./build";

// Цвет ROMI — по отсечкам владельца.
assert.equal(romiBand(-100), "red");
assert.equal(romiBand(-99), "orange");
assert.equal(romiBand(0), "orange");
assert.equal(romiBand(1), "yellow");
assert.equal(romiBand(130), "yellow");
assert.equal(romiBand(131), "green");
assert.equal(romiBand(null), null);

// Этап: граница теста — 2,5 × целевая цена депа страны (Испания $750, Латам $500).
const s = (spend: number, deps = 0) => ({ spend, impr: 0, clicks: 0, subs: 0, dia: 0, deps, rev: 0 });
assert.equal(stageOf(s(749), "ES"), "test");
assert.equal(stageOf(s(750), "ES"), "loser");
assert.equal(stageOf(s(499), "MX"), "test");
assert.equal(stageOf(s(500), "MX"), "loser");
assert.equal(stageOf(s(900, 1), "MX"), "deps");
assert.equal(stageOf(s(0), "MX"), "nospend");

// Одно крео в двух странах: депы ложатся в страну своей кампании, а не по имени объявления.
const tree = buildReport(
  [
    { buyer: "A", campaign: "C_ES", ad: "creo-1", geo: "ES", spend: 100, impr: 10000, clicks: 100 },
    { buyer: "A", campaign: "C_MX", ad: "creo-1", geo: "MX", spend: 600, impr: 20000, clicks: 200 },
  ],
  [
    { buyer: "A", campaign: "C_ES", ad: "creo-1", subs: 10, dia: 5, deps: 1, rev: 400 },
    { buyer: "A", campaign: "C_MX", ad: "creo-1", subs: 20, dia: 4, deps: 0, rev: 0 },
    // кампании в периоде не было — страна из её имени, крео без спенда
    { buyer: "A", campaign: "CAB1_01.10_TG_EXP_PER_MTG_ROMAN_1", ad: "old-creo", subs: 0, dia: 0, deps: 1, rev: 700 },
  ],
  new Map([["A", { subs: 0, dia: 0, deps: 1, rev: 300 }]]),
);
const a = tree[0];
const es = a.children!.find((g) => g.geo === "ES")!, mx = a.children!.find((g) => g.geo === "MX")!, pe = a.children!.find((g) => g.geo === "PE")!;
assert.equal(es.children![0].stage, "deps");
assert.equal(es.children![0].m.romi, 300);
assert.equal(mx.children![0].stage, "loser");          // $600 > $500 Латама, депов нет
assert.equal(pe.children![0].stage, "nospend");
assert.equal(pe.children![0].m.cpdep, null);          // без спенда цены нет, а не $0
assert.ok(a.children!.some((g) => g.geo === "REST" && g.sums.rev === 300));
// Итог баера = весь Torro, включая «не разнесено».
assert.equal(a.sums.rev, 1400);
assert.equal(a.sums.deps, 3);
assert.deepEqual(a.counts, { test: 0, loser: 1, deps: 1, nospend: 1 });
assert.equal(totalOf(tree).sums.spend, 700);
assert.equal(es.m.ctr, 0.01);

console.log("traffic-report: этапы, цвет ROMI и страна депов верно");
