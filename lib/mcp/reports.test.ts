// Самопроверка General 4.0 и рейтинга через AI. Запуск: npx tsx lib/mcp/reports.test.ts
import assert from "node:assert/strict";
import { boardView, filtersOf } from "./reports";
import { DIMENSIONS, type Gr4Dim } from "@/lib/general-report-4/types";

// Фильтр — без учёта регистра, к написанию из таблицы; чего нет — отказ со списком; одно значение — как список.
const values = Object.fromEntries(DIMENSIONS.map((d) => [d, [] as string[]])) as Record<Gr4Dim, string[]>;
values.country = ["ES", "MX"]; values.face = ["Роман"];
assert.deepEqual(filtersOf({ country: ["es"], face: "роман" }, values), { country: ["ES"], face: ["Роман"] });
assert.throws(() => filtersOf({ country: ["PE"] }, values), /нет «PE»\. Есть: ES, MX/);
assert.throws(() => filtersOf({ town: ["X"] }, values), /Нет разреза «town»/);
assert.deepEqual(filtersOf(undefined, values), {});

// Рейтинг: место по порядку, суммы — только если пришли (баеру чужие forViewer не отдаёт), номинации — по имени.
const a = { id: "1", label: "Артём", romi: 0.25, prevRomi: 0.1, spend: 1000, revenue: 1250, profit: 250, me: true };
const b = { id: "2", label: "Андрей", romi: -0.1, prevRomi: null };
const v = boardView({ ranking: [a, b], volume: a, efficiency: null, progress: a });
assert.deepEqual(v.ranking.map((x) => [x.place, x.buyer, x.romi_pct, x.spend]), [[1, "Артём", 25, 1000], [2, "Андрей", -10, undefined]]);
assert.equal(v.ranking[0].me, true);
assert.equal(v.ranking[1].prev_romi_pct, null);
assert.deepEqual([v.volume, v.efficiency, v.progress], ["Артём", null, "Артём"]);
assert.equal(boardView({ ranking: [], volume: null, efficiency: null }).progress, undefined, "у всего времени «Прогресса» нет");

console.log("mcp reports: ok");
