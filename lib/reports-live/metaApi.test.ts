// Самопроверка разбора полей Meta. Запуск: npx tsx lib/reports-live/metaApi.test.ts
import assert from "node:assert/strict";
import { resultsOf } from "./metaApi";

// Результаты: поле есть, значений нет — ноль; поля нет — не знаем (Decision 089).
assert.equal(resultsOf({}), null);
assert.equal(resultsOf({ results: [{ indicator: "conversions:subscribe_website" }] }), 0);
assert.equal(resultsOf({ results: [{ indicator: "conversions:subscribe_website", values: [{ value: "4" }] }] }), 4);
console.log("metaApi: results ok");
