// Самопроверка окна и догрузки. Запуск: npx tsx lib/warehouse/ingest.test.ts
import assert from "node:assert/strict";
import { nextChunk, windowFrom } from "./ingest";

// Окно: «сегодня» — один день, полное — четырнадцать, включая опорный
assert.deepEqual(windowFrom("2026-08-31", "today"), { since: "2026-08-31", until: "2026-08-31" });
assert.deepEqual(windowFrom("2026-08-31", "window"), { since: "2026-08-18", until: "2026-08-31" });
// Переход через месяц, год и високосный февраль
assert.equal(windowFrom("2026-03-05", "window").since, "2026-02-20");
assert.equal(windowFrom("2027-01-03", "window").since, "2026-12-21");
assert.equal(windowFrom("2028-03-01", "window").since, "2028-02-17");

// Догрузка идёт назад кусками, начиная со дня перед уже загруженным
assert.deepEqual(nextChunk("2026-10-11", "2020-01-01", 14), { since: "2026-09-27", until: "2026-10-10" });
// Упирается в дату создания самого старого кабинета и не заходит за неё
assert.deepEqual(nextChunk("2026-10-11", "2026-10-05", 14), { since: "2026-10-05", until: "2026-10-10" });
// Дошли до начала — кусков больше нет
assert.equal(nextChunk("2026-10-05", "2026-10-05", 14), null);

console.log("ingest: окно и догрузка истории считаются верно");
