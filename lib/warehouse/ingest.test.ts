// Самопроверка окна загрузки. Запуск: npx tsx lib/warehouse/ingest.test.ts
//
// Проверяется одно: опорная дата берётся из данных, а не с часов сервера.
// Замер 31.08.2026 показал, почему это важно: UTC на сервере был ещё на 30-м,
// и единственный лист выгрузки по крео за 31-е выпадал из окна целиком.
import assert from "node:assert/strict";
import { windowFrom } from "./ingest";

// Режим «сегодня» — ровно один день, самый свежий из выгрузки
assert.deepEqual(windowFrom("2026-08-31", "today"), { since: "2026-08-31", until: "2026-08-31" });

// Полное окно — четырнадцать дней, включая опорный
const w = windowFrom("2026-08-31", "window");
assert.deepEqual(w, { since: "2026-08-18", until: "2026-08-31" });

const days = (Date.parse(w.until) - Date.parse(w.since)) / 86_400_000 + 1;
assert.equal(days, 14, "окно ровно четырнадцать дней");

// Переход через границу месяца и года не ломает арифметику
assert.equal(windowFrom("2026-03-05", "window").since, "2026-02-20");
assert.equal(windowFrom("2027-01-03", "window").since, "2026-12-21");
// Високосный февраль
assert.equal(windowFrom("2028-03-01", "window").since, "2028-02-17");

console.log("ingest: окно опирается на данные, границы месяцев проходит");
