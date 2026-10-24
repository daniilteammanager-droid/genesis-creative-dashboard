// Самопроверка расписания авточека. Запуск: npx tsx lib/alerts/autocheck.test.ts
import assert from "node:assert/strict";
import { dueSlot, parseCheckTimes } from "./autocheck";

// Разбор: разделители любые, ведущий ноль дописывается, дубли и порядок
assert.deepEqual(parseCheckTimes("18:00, 9:00; 18:00 14:30"), ["09:00", "14:30", "18:00"]);
assert.deepEqual(parseCheckTimes(["10:15"]), ["10:15"]);
assert.deepEqual(parseCheckTimes(""), []);
assert.throws(() => parseCheckTimes("10:10"), /кратны 15/);
assert.throws(() => parseCheckTimes("25:00"), /не время/);
assert.throws(() => parseCheckTimes("утром"), /не время/);

const D = "2026-10-24";
const times = ["10:00", "18:00"];
// Ровно в слот и чуть позже — отправить; раньше — нет
assert.equal(dueSlot(times, D, "10:00", null), `${D} 10:00`);
assert.equal(dueSlot(times, D, "10:15", null), `${D} 10:00`);
assert.equal(dueSlot(times, D, "09:45", null), null);
// Уже отправлен — второй раз нет
assert.equal(dueSlot(times, D, "10:15", `${D} 10:00`), null);
// Вчерашняя отметка не мешает сегодняшнему слоту
assert.equal(dueSlot(times, D, "10:00", "2026-10-23 10:00"), `${D} 10:00`);
// Опоздание дольше получаса не догоняется
assert.equal(dueSlot(times, D, "10:30", null), null);
// Два наступивших — берём последний
assert.equal(dueSlot(["10:00", "10:15"], D, "10:15", `${D} 10:00`), `${D} 10:15`);

console.log("autocheck: расписание разбирается, слоты не повторяются и не догоняются");
