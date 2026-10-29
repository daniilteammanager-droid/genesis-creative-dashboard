// Самопроверка рейтинга. Запуск: npx tsx lib/home/leaderboard.test.ts
import assert from "node:assert/strict";
import { forViewer, rankBuyers } from "./leaderboard";

const day = (date: string, budget: number, revenue: number) => ({ date, budget, revenue });
const buyers = [
  // самый большой расход в плюсе — «Объём»
  { id: "a", label: "b1", rows: [day("2026-08-01", 30000, 60000), day("2026-09-01", 30000, 60000)] },
  // ROMI 400%, но $500 — в «Эффективность» не проходит по порогу
  { id: "b", label: "b2", rows: [day("2026-09-10", 500, 2500)] },
  // лучший профит и ROMI при расходе выше порога
  { id: "c", label: "b3", rows: [day("2026-09-05", 50000, 125000), day("2026-07-05", 1000, 0)] },
  // расход больше всех, но в минус — не «Объём»
  { id: "d", label: "b4", gone: true, rows: [day("2026-09-01", 90000, 60000)] },
  // без расхода в рейтинг не попадает
  { id: "e", label: "b5", rows: [day("2026-09-01", 0, 100)] },
];

const all = rankBuyers(buyers, null, "2026-10-28", null);
assert.deepEqual(all.ranking.map((x) => x.id), ["c", "a", "b", "d"]);
assert.equal(all.volume?.id, "a");
assert.equal(all.efficiency?.id, "c");

const q = rankBuyers(buyers, "2026-08-01", "2026-10-28", 3);
assert.equal(q.ranking.find((x) => x.id === "c")?.spend, 50000);   // июль не в окне
assert.equal(q.efficiency?.id, "c");                                 // 16.7k/мес — проходит

const tight = rankBuyers([buyers[1]], null, "2026-10-28", null);
assert.equal(tight.efficiency, null);                                // никто не прошёл порог

const hidden = forViewer(q, "b", false);
assert.equal(hidden.ranking[0].profit, undefined);
assert.equal(hidden.ranking.find((x) => x.id === "b")?.me, true);
assert.equal(hidden.ranking.find((x) => x.id === "b")?.profit, 2000);   // свой профит баер видит
assert.equal(forViewer(q, "b", true).ranking[0].profit, 75000);
assert.equal(hidden.ranking.find((x) => x.id === "d")?.gone, true);    // выбывший — в рейтинге, с пометкой
assert.equal(hidden.ranking.find((x) => x.id === "c")?.gone, false);
// «Прогресс»: окно 29.09–28.10, прошлое — 30.08–28.09.
const pr = [
  { id: "n", label: "новичок", rows: [day("2026-09-10", 2000, 0), day("2026-10-10", 2000, 2400)] },        // −100% → +20%
  { id: "s", label: "стабильный", rows: [day("2026-09-10", 5000, 10000), day("2026-10-10", 5000, 12500)] }, // 100% → 150%
  { id: "t", label: "мало в прошлом", rows: [day("2026-09-10", 100, 0), day("2026-10-10", 2000, 6000)] },   // прошлое ниже $1k
  { id: "f", label: "без прошлого", rows: [day("2026-10-10", 9000, 30000)] },
  { id: "x", label: "до окон", rows: [day("2026-08-29", 5000, 0), day("2026-10-10", 5000, 5000)] },        // 29.08 — уже не прошлое окно
];
const m = rankBuyers(pr, "2026-09-29", "2026-10-28", 1);
assert.equal(m.progress?.id, "n");
assert.equal(m.ranking.find((x) => x.id === "n")?.prevRomi, -1);
assert.equal(m.ranking.find((x) => x.id === "x")?.prevRomi, null);
assert.equal(rankBuyers(pr, null, "2026-10-28", null).progress, undefined);          // у «всего времени» нет
assert.equal(rankBuyers([pr[1]].map((b) => ({ ...b, rows: [day("2026-09-10", 5000, 10000), day("2026-10-10", 5000, 5000)] })), "2026-09-29", "2026-10-28", 1).progress, null); // все просели
assert.equal(forViewer(m, "n", false).progress?.prevRomi, -1);
assert.equal(forViewer(all, "a", false).progress, undefined);
console.log("home leaderboard: ok");
