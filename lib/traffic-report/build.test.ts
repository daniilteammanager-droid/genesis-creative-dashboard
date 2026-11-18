// Самопроверка отчёта по трафику. Запуск: npx tsx lib/traffic-report/build.test.ts
import assert from "node:assert/strict";
import { buildReport, cellsOf, creoGeo, filterCells, geoOf, groupCreos, lifeMap, romiBand, sortCreos, stageOf, sumAllTime, textKey, totalOf, treeOf, type SpendRow } from "./build";

const sp = (r: Omit<SpendRow, "face" | "funnel" | "platform"> & Partial<SpendRow>): SpendRow => ({ face: "ROMAN", funnel: "TG", platform: "fb", ...r });

// Страна: таргет главный, код крео — подсказка (несколько стран в таргете, таргета нет).
assert.equal(creoGeo("vid-storytell-t26-v1-b1-es-ar"), "AR");
assert.equal(geoOf(["MX"], "", "vid-balance-t30-v9-b3-es-es"), "MX");
assert.equal(geoOf(["AR", "MX"], "", "vid-storytell-t26-v1-b1-es-ar"), "AR");
assert.equal(geoOf(["AR", "MX"], "", "vid-storytell-t26-v1-b1-es-pe"), "MULTI");
assert.equal(geoOf([], "New Traffic Campaign", "vid-storytell-t26-v1-b1-es-pe"), "PE");

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

// Всё время склейки — сумма крео; не пустая строка из нулей, когда данных нет.
assert.deepEqual(sumAllTime([s(100, 1), s(50, 2)]), s(150, 3));
assert.equal(sumAllTime([]), null);
assert.equal(stageOf(s(749), "ES"), "test");
assert.equal(stageOf(s(750), "ES"), "loser");
assert.equal(stageOf(s(499), "MX"), "test");
assert.equal(stageOf(s(500), "MX"), "loser");
assert.equal(stageOf(s(900, 1), "MX"), "deps");
assert.equal(stageOf(s(0), "MX"), "nospend");

// Одно крео в двух странах: депы ложатся в страну своей кампании, а не по имени объявления.
const tree = buildReport(
  [
    sp({ buyer: "A", campaign: "C_ES", ad: "creo-1", geo: "ES", spend: 100, impr: 10000, clicks: 100 }),
    sp({ buyer: "A", campaign: "C_MX", ad: "creo-1", geo: "MX", spend: 600, impr: 20000, clicks: 200 }),
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

// Склейка по тексту и по тексту + версии, старое имя без tN — отдельной строкой.
assert.equal(textKey("vid-storytell-t30-v14-b1-es-mx", "text"), "t30");
assert.equal(textKey("vid-balance-t11-v8-b1-es-ar", "version"), "t11_v8");
assert.equal(textKey("static21-es", "text"), null);
const g = buildReport(
  [
    sp({ buyer: "B", campaign: "K", ad: "vid-storytell-t30-v14-b1-es-mx", geo: "MX", spend: 300, impr: 0, clicks: 0 }),
    sp({ buyer: "B", campaign: "K", ad: "vid-balance-t30-v12-b1-es-mx", geo: "MX", spend: 300, impr: 0, clicks: 0 }),
    sp({ buyer: "B", campaign: "K", ad: "edit18-mx", geo: "MX", spend: 50, impr: 0, clicks: 0 }),
  ],
  [{ buyer: "B", campaign: "K", ad: "vid-balance-t30-v12-b1-es-mx", subs: 0, dia: 0, deps: 1, rev: 900 }],
);
const byText = groupCreos(g, "text")[0].children![0];
assert.equal(byText.children!.length, 2);                       // t30 и edit18-mx
const t30 = byText.children!.find((n) => n.label === "t30")!;
assert.equal(t30.children!.length, 2);
assert.equal(t30.stage, "deps");                                 // этап — по сумме склейки
assert.equal(t30.sums.spend, 600);
assert.equal(groupCreos(g, "text")[0].counts!.deps, 1);          // считаем строки страны, а не крео
const byVersion = groupCreos(g, "version")[0].children![0];
assert.deepEqual(byVersion.children!.map((n) => n.label).sort(), ["edit18-mx", "t30_v12", "t30_v14"]);
// Сортировка внутри страны по ROMI: окупившийся выше, без спенда — в конце.
const sorted = sortCreos(g, "romi")[0].children![0].children!.map((n) => n.label);
assert.equal(sorted[0], "vid-balance-t30-v12-b1-es-mx");

// Фильтр по лицу режет ячейки до сборки: итог и этапы — только своего лица, Torro — по лицу своей пары.
const cells = cellsOf(
  [sp({ buyer: "C", campaign: "R", ad: "x", geo: "ES", spend: 100, impr: 0, clicks: 0 }), sp({ buyer: "C", campaign: "K", ad: "x", geo: "ES", face: "RICKY", spend: 900, impr: 0, clicks: 0 })],
  [{ buyer: "C", campaign: "K", ad: "x", subs: 0, dia: 0, deps: 1, rev: 500 }],
);
const ricky = treeOf(filterCells(cells, { face: ["Рики"] }));
assert.equal(ricky[0].sums.spend, 900);
assert.equal(ricky[0].sums.rev, 500);
assert.equal(treeOf(filterCells(cells, { face: ["Роман"] }))[0].children![0].children![0].stage, "test");
assert.equal(treeOf(cells)[0].sums.spend, 1000);

// Этап — по всему времени крео в стране (Daniil 17.11.2026), цифры строки — по периоду.
const period = cellsOf(
  [
    sp({ buyer: "D", campaign: "E", ad: "old-loser", geo: "ES", spend: 100, impr: 0, clicks: 0 }),
    sp({ buyer: "D", campaign: "E", ad: "young", geo: "ES", spend: 100, impr: 0, clicks: 0 }),
    sp({ buyer: "D", campaign: "M", ad: "old-loser", geo: "MX", spend: 50, impr: 0, clicks: 0 }),
    sp({ buyer: "D", campaign: "E", ad: "vid-a-t5-v1-b1-es-es", geo: "ES", spend: 100, impr: 0, clicks: 0 }),
    sp({ buyer: "D", campaign: "E", ad: "vid-b-t5-v2-b1-es-es", geo: "ES", spend: 100, impr: 0, clicks: 0 }),
  ],
  [{ buyer: "D", campaign: "E", ad: "dep-later", subs: 0, dia: 0, deps: 1, rev: 300 }],
);
const life = lifeMap([
  { buyer: "D", creo: "old-loser", geos: { ES: { spend: 900, deps: 0 }, MX: { spend: 50, deps: 0 } } },
  { buyer: "D", creo: "young", geos: { ES: { spend: 40, deps: 0 } } },                  // меньше периода — берём период
  { buyer: "D", creo: "dep-later", geos: { ES: { spend: 600, deps: 2 } } },             // в периоде не крутилось
  { buyer: "D", creo: "vid-a-t5-v1-b1-es-es", geos: { ES: { spend: 400, deps: 0 } } },
  { buyer: "D", creo: "vid-b-t5-v2-b1-es-es", geos: { ES: { spend: 400, deps: 0 } } },
]);
const dEs = treeOf(period, life)[0].children!.find((g) => g.geo === "ES")!;
const row = (label: string) => dEs.children!.find((n) => n.label === label)!;
assert.equal(row("old-loser").stage, "loser");                  // за период $100 — «на тесте», за всё время $900
assert.equal(row("old-loser").sums.spend, 100);                 // цифры — периода
assert.equal(row("young").stage, "test");
assert.equal(row("young").left, 650);                           // $750 − $100: всё время не меньше периода
assert.equal(row("dep-later").stage, "deps");                   // раньше — «Без спенда»
assert.equal(treeOf(period, life)[0].children!.find((g) => g.geo === "MX")!.children![0].stage, "test");  // своя граница у страны
assert.equal(treeOf(period)[0].children!.find((g) => g.geo === "ES")!.children!.find((n) => n.label === "old-loser")!.stage, "test");  // без всего времени — по периоду (алерты)
assert.equal(row("vid-a-t5-v1-b1-es-es").stage, "test");
const t5 = groupCreos(treeOf(period, life), "text")[0].children!.find((g) => g.geo === "ES")!.children!.find((n) => n.label === "t5")!;
assert.deepEqual(t5.life, { spend: 800, deps: 0 });              // склейка — сумма всего времени её крео
assert.equal(t5.stage, "loser");
assert.deepEqual(dEs.counts, { test: 3, loser: 1, deps: 1, nospend: 0 });

console.log("traffic-report: этапы за всё время, цвет ROMI, страна депов, склейка, сортировка и фильтры верно");
