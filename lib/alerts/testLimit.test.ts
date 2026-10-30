// Самопроверка алерта «крео за границей теста». Запуск: npx tsx lib/alerts/testLimit.test.ts
import assert from "node:assert/strict";
import { activeLosers, firstDeps, loserText } from "./testLimit";
import { buildReport, type SpendRow } from "@/lib/traffic-report/build";

const sp = (ad: string, geo: string, spend: number): SpendRow => ({ buyer: "A", campaign: `K_${geo}`, ad, geo, face: "ROMAN", funnel: "TG", platform: "fb", spend, impr: 0, clicks: 0 });
const window = buildReport(
  [sp("lose-1", "MX", 520), sp("lose-2", "ES", 760), sp("old-loser", "AR", 900), sp("test-1", "ES", 700), sp("dep-1", "MX", 900)],
  [{ buyer: "A", campaign: "K_MX", ad: "dep-1", subs: 3, dia: 2, deps: 1, rev: 500 }],
);
// Вчера–сегодня крутились все, кроме old-loser: остановленный лузер — не повод для алерта.
const recent = buildReport([sp("lose-1", "MX", 20), sp("lose-2", "ES", 10), sp("test-1", "ES", 5), sp("dep-1", "MX", 30)], []);
const l = activeLosers(window, recent);
assert.deepEqual(l.map((x) => `${x.geo}|${x.creo}`).sort(), ["ES|lose-2", "MX|lose-1"]);
assert.equal(l.find((x) => x.geo === "MX")!.limit, 500);
assert.match(loserText(l[0]), /границей|границе/);
// Первые депы: dep-1 дал деп за окно, но не за последние два дня — не первый; new-dep — весь деп свежий.
const w2 = buildReport([sp("dep-1", "MX", 900), sp("new-dep", "ES", 300)], [
  { buyer: "A", campaign: "K_MX", ad: "dep-1", subs: 3, dia: 2, deps: 2, rev: 500 },
  { buyer: "A", campaign: "K_ES", ad: "new-dep", subs: 3, dia: 2, deps: 1, rev: 800 },
]);
const r2 = buildReport([sp("dep-1", "MX", 30), sp("new-dep", "ES", 40)], [
  { buyer: "A", campaign: "K_MX", ad: "dep-1", subs: 1, dia: 1, deps: 1, rev: 250 },
  { buyer: "A", campaign: "K_ES", ad: "new-dep", subs: 1, dia: 1, deps: 1, rev: 800 },
]);
assert.deepEqual(firstDeps(w2, r2), ["new-dep"]);
console.log("testLimit: алерт только по крутящимся лузерам, граница страны верна");
