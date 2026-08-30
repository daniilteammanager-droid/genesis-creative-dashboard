// Самопроверка слияния источников. Запуск: npx tsx lib/general-report/sources.test.ts
//
// Проверяется одно правило: env добавляет таблицы, которых ещё нет в базе, и
// никогда не отключается целиком. Прежняя версия работала выключателем — стоило
// подключить таблицу одному баеру, и три остальные пропадали из «Сводной». Отчёт
// при этом не падал, а показывал меньшие суммы.
import assert from "node:assert/strict";
import { envExtras } from "./sources";

process.env.T_A = "sheet-a";
process.env.T_B = "sheet-b";
process.env.T_C = "";

const LIST = [
  { id: "env:a", label: "A", env: "T_A", kind: "country" as const },
  { id: "env:b", label: "B", env: "T_B", kind: "wa" as const },
  { id: "env:c", label: "C", env: "T_C", kind: "country" as const },
  { id: "env:d", label: "D", env: "T_MISSING", kind: "country" as const },
];

// База пуста — берём всё, что задано
const all = envExtras(LIST, new Set(), "common");
assert.deepEqual(all.map((s) => s.id), ["env:a", "env:b"], "пустые и незаданные переменные пропускаются");
assert.equal(all[0].spreadsheetId, "sheet-a");
assert.equal(all[1].kind, "wa", "тип таблицы не теряется");
assert.equal(all[0].group, "common");

// Одна таблица переехала в базу — остальные обязаны остаться
const partial = envExtras(LIST, new Set(["sheet-a"]), "buyers");
assert.deepEqual(partial.map((s) => s.id), ["env:b"], "переезд одной таблицы не выключает остальные");
assert.equal(partial[0].group, "buyers");

// Переехали все — env больше ничего не добавляет
assert.deepEqual(envExtras(LIST, new Set(["sheet-a", "sheet-b"]), "common"), []);

// Одна и та же таблица в двух переменных не удваивается: в «Сводной» это был бы
// двойной спенд без единого признака ошибки
process.env.T_DUP = "sheet-a";
const dup = envExtras(
  [...LIST, { id: "env:dup", label: "Dup", env: "T_DUP", kind: "country" as const }],
  new Set(),
  "common"
);
assert.deepEqual(dup.map((s) => s.spreadsheetId), ["sheet-a", "sheet-b"], "дубль таблицы отбрасывается");

// Переданное множество не портится — вызывающий использует его дальше
const known = new Set(["sheet-a"]);
envExtras(LIST, known, "common");
assert.deepEqual([...known], ["sheet-a"], "known не мутируется");

console.log("sources: слияние env и базы проверено");
