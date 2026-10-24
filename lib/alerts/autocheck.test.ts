// Самопроверка расписания авточека. Запуск: npx tsx lib/alerts/autocheck.test.ts
import assert from "node:assert/strict";
import { checkMessage, dueSlot, parseCheckTimes } from "./autocheck";

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

// Сообщение: верх по расходу, остаток одной строкой, итог в конце
const row = (i: number) => ({
  key: `k${i}`, label: `CAB_${i}`, dailyBudget: 50, spend: 100 - i,
  subscribers: null, dialogs: null, revenue: null, costPdp: null, costDia: null, romi: null,
});
const result = {
  since: D, until: D, groupBy: "campaign" as const, live: true,
  rows: Array.from({ length: 40 }, (_, i) => row(i)), totalBudget: 2000,
  totals: { spend: 3220, revenue: 500, romi: -84.5 }, text: "", buyers: [], sources: [],
  buyer: "all", isBuyer: false, generatedAt: "",
};
const msg = checkMessage(result, new Date("2026-10-24T07:00:00Z"));
assert.ok(msg.includes("CAB_14") && !msg.includes("CAB_15\n"), "ровно 15 строк");
// 85 + 84 + … + 61. Разделитель тысяч у ru-RU — неразрывный пробел.
assert.match(msg, /…и ещё 25 кампаний на 1\s825,00\$/);
assert.match(msg, /Итого: 3\s220,00\$ \/ доход 500,00\$ \/ ROMI -85%/);
assert.match(checkMessage({ ...result, rows: [] }), /расхода пока нет/);

console.log("autocheck: расписание разбирается, слоты не повторяются, чек укорачивается до верха");
