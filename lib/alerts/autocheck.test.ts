// Самопроверка расписания авточека. Запуск: npx tsx lib/alerts/autocheck.test.ts
import assert from "node:assert/strict";
import { checkMessage, dueSlot, openCheckButton, parseCheckTimes } from "./autocheck";
import { faceTotals } from "@/lib/warehouse/check";

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

// Сообщение: верх по расходу, остаток лица одной строкой, итог в конце.
// 40 строк: чётные — ROMAN, нечётные — RICKY, у RICKY расход меньше.
const row = (i: number) => ({
  key: `k${i}`, label: `CAB_${i}`, platform: "fb" as const, face: i % 2 ? "RICKY" : "ROMAN", dailyBudget: 50, spend: 100 - i,
  subscribers: null, dialogs: null, revenue: null, costPdp: null, costDia: null, romi: null,
});
const rows40 = Array.from({ length: 40 }, (_, i) => row(i));
const result = {
  since: D, until: D, groupBy: "campaign" as const, live: true,
  rows: rows40, faces: faceTotals(rows40), platforms: [], totalBudget: 2000,
  totals: { spend: 3220, revenue: 500, romi: -84.5 }, text: "", buyers: [], sources: [],
  buyer: "all", isBuyer: false, generatedAt: "",
};
const msg = checkMessage(result, new Date("2026-10-24T07:00:00Z"));
assert.ok(msg.includes("CAB_14") && !msg.includes("CAB_15 "), "ровно 15 строк");
assert.ok(msg.indexOf("👤 ROMAN") < msg.indexOf("👤 RICKY"), "лица по расходу");
assert.ok(msg.indexOf("CAB_1 ") > msg.indexOf("👤 RICKY"), "строка RICKY — в блоке RICKY");
// ROMAN показал 0,2,…,14 (8 строк) — скрыто 12: 84+82+…+62 = 876.
assert.match(msg, /…и ещё 12 кампаний на 876,00\$/);
// RICKY показал 1,3,…,13 (7 строк) — скрыто 13: 85+83+…+61 = 949.
assert.match(msg, /…и ещё 13 кампаний на 949,00\$/);
assert.match(msg, /Итого: 3\s220,00\$ \/ доход 500,00\$ \/ ROMI -85%/);
assert.match(checkMessage({ ...result, rows: [], faces: [] }), /расхода пока нет/);

// Кнопка ведёт на тот же день и разрез; без адреса дашборда кнопки нет
delete process.env.APP_URL;
delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
assert.deepEqual(openCheckButton(D, "country"), {});
process.env.VERCEL_PROJECT_PRODUCTION_URL = "genesis-creative-dashboard.vercel.app";
const btn = openCheckButton(D, "country") as { reply_markup: { inline_keyboard: { url: string }[][] } };
assert.equal(btn.reply_markup.inline_keyboard[0][0].url,
  `https://genesis-creative-dashboard.vercel.app/check?since=${D}&until=${D}&group=country`);

console.log("autocheck: расписание, повторы, укороченный чек и кнопка в дашборд — верно");
