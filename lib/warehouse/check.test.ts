// Самопроверка текста чека. Запуск: npx tsx lib/warehouse/check.test.ts
//
// Формат задан владельцем и уходит в телегу как есть, поэтому накрыт проверкой:
// молчаливое изменение разделителя или порядка чисел заметят уже в чате.
import assert from "node:assert/strict";
import { buildCheckText, type CheckRow } from "./check";

const row = (over: Partial<CheckRow>): CheckRow => ({
  key: "k", label: "L", dailyBudget: null, spend: 0,
  subscribers: null, dialogs: null, revenue: null,
  costPdp: null, costDia: null, romi: null, ...over,
});

const rows: CheckRow[] = [
  row({ label: "29.08 T2A 79Genesis ES 1", dailyBudget: 350, spend: 125.3, costPdp: 10.44, costDia: 25.06, revenue: 0, romi: -100 }),
  row({ label: "29.08 T2A 79Genesis ES 2", dailyBudget: 350, spend: 154.24, costPdp: 10.28, costDia: 154.24, revenue: 700, romi: 353 }),
];

const text = buildCheckText(rows, 700, new Date("2026-08-30T10:53:00Z"));
const lines = text.split("\n");

assert.equal(lines[0], "Отчет по трафу / 30.08 - 13:53 / [700$]");
assert.equal(lines[1], "");
assert.equal(lines[2], "29.08 T2A 79Genesis ES 1 - [350$]");
// Разделитель дробной части — запятая, как в примере владельца
assert.equal(lines[3], "125,30 / 10,44 / 25,06 / 0,00 / -100%");
assert.equal(lines[5], "29.08 T2A 79Genesis ES 2 - [350$]");
assert.equal(lines[6], "154,24 / 10,28 / 154,24 / 700,00 / 353%");

// Без бюджета — ни в шапке, ни в строках: у прошлых периодов его взять неоткуда
const past = buildCheckText([row({ label: "Испания", spend: 10, revenue: 20, romi: 100 })], null, new Date("2026-08-30T06:05:00Z"));
assert.equal(past.split("\n")[0], "Отчет по трафу / 30.08 - 09:05");
assert.ok(!past.includes("["), "квадратных скобок без бюджета быть не должно");

// Пустой чек не роняет сборку
assert.ok(buildCheckText([], null, new Date("2025-12-31T21:00:00Z")).startsWith("Отчет по трафу / 01.01 - 00:00"));

console.log("check: шаблон для телеги совпадает с образцом");
