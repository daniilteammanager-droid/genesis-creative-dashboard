// Самопроверка разбора выгрузок для склада. Запуск: npx tsx lib/warehouse/parseCrm.test.ts
import assert from "node:assert/strict";
import { parseCrmSheet } from "./parseCrm";

// Шапка дневной выгрузки по крео — как она приходит на самом деле (замер 31.08.2026)
const creative = [
  ["Название", "Клики", "Подписчики", "Диалоги", "Кол-во регистраций",
   "Кол-во продаж", "Сумма продаж", "Кол-во повторных продаж", "Сумма повторных продаж"],
  ["EDIT18-PE", 3, 2, 0, 0, 1, 700, 0, 0],
  ["", 9, 9, 9, 9, 9, 9, 9, 9],          // строка без ключа — пропускается
];
const c = parseCrmSheet(creative);
assert.equal(c.length, 1, "строки без ключа не попадают в склад");
assert.equal(c[0].key, "EDIT18-PE");
assert.equal(c[0].clicks, 3);
assert.equal(c[0].depCount, 1);
assert.equal(c[0].depSum, 700);
assert.equal(c[0].redepCount, 0, "выгруженный ноль остаётся нулём");
// Отписок в дневной выгрузке нет — значит null, а не ноль
assert.equal(c[0].unsubscribes, null, "отсутствующая колонка даёт null, а не ноль");

// Шапка дневной по кампаниям: нет кликов и регистраций, есть имя кампании
const campaign = [
  ["Название", "Название кампании", "Подписчики", "Диалоги",
   "Кол-во продаж", "Сумма продаж", "Кол-во повторных продаж", "Сумма повторных продаж"],
  ["120243942514930606", "ig", 1, 0, 0, 0, 0, 0],
];
const k = parseCrmSheet(campaign);
assert.equal(k[0].key, "120243942514930606");
assert.equal(k[0].campaignName, "ig");
assert.equal(k[0].clicks, null, "кликов в дневной по кампаниям нет");
assert.equal(k[0].registrations, null);
assert.equal(k[0].subscribers, 1);

// Порядок колонок у выгрузок разный — читаем по заголовку, не по позиции
const swapped = [
  ["Название", "Подписчики", "Диалоги", "Кол-во регистраций",
   "Кол-во продаж", "Кол-во повторных продаж", "Сумма продаж", "Сумма повторных продаж"],
  ["123", 5, 4, 3, 2, 1, 500, 100],
];
const sw = parseCrmSheet(swapped);
assert.equal(sw[0].depCount, 2);
assert.equal(sw[0].redepCount, 1);
assert.equal(sw[0].depSum, 500, "сумма продаж не перепутана с повторными");
assert.equal(sw[0].redepSum, 100);

// Пустая клетка — это не ноль
const blank = parseCrmSheet([["Название", "Клики"], ["abc", ""]]);
assert.equal(blank[0].clicks, null, "пустая клетка не превращается в ноль");

// Деньги с разделителями и валютой
const money = parseCrmSheet([["Название", "Сумма продаж"], ["abc", "$1,250.50"]]);
assert.equal(money[0].depSum, 1250.5);

// Пустой лист не роняет разбор
assert.deepEqual(parseCrmSheet([]), []);
assert.deepEqual(parseCrmSheet([["Название"]]), []);

console.log("parseCrm: null отличается от нуля, порядок колонок не важен");
