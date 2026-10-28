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
  { id: "d", label: "b4", rows: [day("2026-09-01", 90000, 60000)] },
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
assert.equal(forViewer(q, "b", true).ranking[0].profit, 75000);
console.log("home leaderboard: ok");
