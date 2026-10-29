// Самопроверка алерта «крео за границей теста». Запуск: npx tsx lib/alerts/testLimit.test.ts
import assert from "node:assert/strict";
import { activeLosers, loserText } from "./testLimit";
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
console.log("testLimit: алерт только по крутящимся лузерам, граница страны верна");
