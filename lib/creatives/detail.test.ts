// Самопроверка модалки крео. Запуск: npx tsx lib/creatives/detail.test.ts
import assert from "node:assert/strict";
import { buildDetail, metricsOf, weekStart } from "./detail";

// Неделя начинается с понедельника; 31.10.2026 — суббота, 2.11.2026 — понедельник.
assert.equal(weekStart("2026-10-31"), "2026-10-26");
assert.equal(weekStart("2026-10-26"), "2026-10-26");
assert.equal(weekStart("2026-11-01"), "2026-10-26");
assert.equal(weekStart("2026-11-02"), "2026-11-02");

const d = buildDetail("vid-x", "2026-10-01", "2026-10-31",
  [
    { date: "2026-10-01", spend: 0, impressions: 0, clicks: 0 }, // пустой день недель не открывает
    { date: "2026-10-08", spend: 100, impressions: 10000, clicks: 100 },
    { date: "2026-10-30", spend: 50, impressions: 5000, clicks: 50 },
    { date: "2026-11-02", spend: 999, impressions: 1, clicks: 1 }, // вне периода
  ],
  [{ date: "2026-10-09", subs: 10, dia: 4, deps: 1, rev: 300 }],
);

// Суммы — только за период.
assert.deepEqual(d.sums, { spend: 150, impressions: 15000, clicks: 150, subs: 10, dia: 4, deps: 1, rev: 300 });

// Недели — от первой с цифрами до недели конца, пустые внутри не пропадают, края обрезаны периодом.
assert.deepEqual(d.weeks.map((w) => [w.start, w.end, w.sums.spend]), [
  ["2026-10-05", "2026-10-11", 100],
  ["2026-10-12", "2026-10-18", 0],
  ["2026-10-19", "2026-10-25", 0],
  ["2026-10-26", "2026-10-31", 50],
]);
assert.equal(d.weeks[0].sums.deps, 1);

// Производные — из сумм.
const m = metricsOf(d.sums);
assert.equal(m.romi, 100);
assert.equal(m.roas, 2);
assert.equal(m.cpm, 10);
assert.equal(m.cpdp, 15);
assert.equal(m.cdep, 150);
assert.equal(m.avgDep, 300);                                   // средний депозит: $300 / 1 деп
assert.equal(metricsOf({ spend: 0, impressions: 0, clicks: 0, subs: 0, dia: 4, deps: 2, rev: 1700 }).avgDep, 850); // без спенда тоже есть
assert.equal(metricsOf({ spend: 50, impressions: 0, clicks: 0, subs: 0, dia: 0, deps: 0, rev: 0 }).avgDep, null);
assert.equal(m.subToDia, 40);
assert.equal(metricsOf(d.weeks[1].sums).romi, null);
// Депы без спенда (поздние депы со старого трафика): цены нет, а не $0.
assert.equal(metricsOf({ spend: 0, impressions: 0, clicks: 0, subs: 0, dia: 4, deps: 2, rev: 1700 }).cdep, null);
assert.equal(metricsOf({ spend: 0, impressions: 0, clicks: 0, subs: 0, dia: 4, deps: 2, rev: 1700 }).cdia, null);

// Ничего нет — недель нет.
assert.deepEqual(buildDetail("vid-x", "2026-10-01", "2026-10-31", [], []).weeks, []);

console.log("detail: ok");
