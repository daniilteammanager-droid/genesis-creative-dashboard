// Самопроверка текста чека. Запуск: npx tsx lib/warehouse/check.test.ts
//
// Формат задан владельцем и уходит в телегу как есть, поэтому накрыт проверкой:
// молчаливое изменение разделителя или порядка чисел заметят уже в чате.
import assert from "node:assert/strict";
import { buildCheckText, faceInName, faceTotals, platformTotals, NO_FACE, MANY_FACES, type CheckRow } from "./check";

const row = (over: Partial<CheckRow>): CheckRow => ({
  key: "k", label: "L", platform: "fb", face: "ROMAN", dailyBudget: null, spend: 0,
  subscribers: null, dialogs: null, revenue: null,
  costPdp: null, costDia: null, romi: null, ...over,
});

const rows: CheckRow[] = [
  row({ label: "29.08 T2A 79Genesis ES 1", dailyBudget: 350, spend: 125.3, costPdp: 10.44, costDia: 25.06, revenue: 0, romi: -100 }),
  row({ label: "29.08 T2A 79Genesis ES 2", dailyBudget: 350, spend: 154.24, costPdp: 10.28, costDia: 154.24, revenue: 700, romi: 353 }),
];

const text = buildCheckText(rows, faceTotals(rows), 700, new Date("2026-08-30T10:53:00Z"));
const lines = text.split("\n");

assert.equal(lines[0], "Отчет по трафу / 30.08 - 13:53 / [700$]");
assert.equal(lines[1], "");
// Лицо — заголовком блока, с бюджетом и итогом лица
assert.equal(lines[2], "👤 ROMAN - [700$]");
assert.equal(lines[3], "279,54 / — / — / 700,00 / 150%");
assert.equal(lines[5], "29.08 T2A 79Genesis ES 1 - [350$]");
// Разделитель дробной части — запятая, как в примере владельца
assert.equal(lines[6], "125,30 / 10,44 / 25,06 / 0,00 / -100%");
assert.equal(lines[8], "29.08 T2A 79Genesis ES 2 - [350$]");
assert.equal(lines[9], "154,24 / 10,28 / 154,24 / 700,00 / 353%");

// Без бюджета — ни в шапке, ни в строках: у прошлых периодов его взять неоткуда
const pastRows = [row({ label: "Испания", spend: 10, revenue: 20, romi: 100 })];
const past = buildCheckText(pastRows, faceTotals(pastRows), null, new Date("2026-08-30T06:05:00Z"));
assert.equal(past.split("\n")[0], "Отчет по трафу / 30.08 - 09:05");
assert.ok(!past.includes("["), "квадратных скобок без бюджета быть не должно");

// Пустой чек не роняет сборку
assert.ok(buildCheckText([], [], null, new Date("2025-12-31T21:00:00Z")).startsWith("Отчет по трафу / 01.01 - 00:00"));

// Неизвестное и ноль — разные вещи. Когда выгрузка за период не подошла, доход
// не «ноль», а «не знаем»: строка «420,59 / 0 / 0 / 0 / —» читается как
// «подписчики бесплатные, дохода нет» и по ней выключают связку.
const unknownRows = [row({ label: "videoM17CLst-es", spend: 420.59, subscribers: null, dialogs: null, revenue: null, costPdp: null, costDia: null, romi: null })];
const unknown = buildCheckText(unknownRows, faceTotals(unknownRows),
  null,
  new Date("2026-08-31T07:27:00Z")
);
assert.equal(unknown.split("\n")[6], "420,59 / — / — / — / —");

// Настоящий ноль по-прежнему ноль, формат владельца не сломан.
const zeroRows = [row({ label: "Испания", spend: 10, subscribers: 2, dialogs: 1, revenue: 0, costPdp: 5, costDia: 10, romi: -100 })];
const zero = buildCheckText(zeroRows, faceTotals(zeroRows),
  null,
  new Date("2026-08-31T07:27:00Z")
);
assert.equal(zero.split("\n")[6], "10,00 / 5,00 / 10,00 / 0,00 / -100%");

// Лица: порядок по расходу, неузнанные в конце, итоги из сумм
const mixed = [
  row({ face: NO_FACE, spend: 500, subscribers: 10 }),
  row({ face: "RICKY", spend: 50, subscribers: 5 }),
  row({ face: "ROMAN", spend: 100, subscribers: 4 }),
  row({ face: "ROMAN", spend: 100, subscribers: 6 }),
  row({ face: MANY_FACES, spend: 900 }),
];
const f = faceTotals(mixed);
assert.deepEqual(f.map((x) => x.face), ["ROMAN", "RICKY", MANY_FACES, NO_FACE]);
assert.equal(f[0].spend, 200);
assert.equal(f[0].costPdp, 20, "цена ПДП лица — из сумм, а не средним строк");
assert.equal(f[0].count, 2);

// Площадки: две подключены — заголовок площадки над лицами; подключена без
// расхода — «расхода нет»; одна площадка — без заголовка, как раньше
const both = [
  row({ label: "FB camp", platform: "fb", face: "ROMAN", spend: 100 }),
  row({ label: "Static 2 Mexico", platform: "tg", face: "ROMAN", spend: 30 }),
];
const twoText = buildCheckText(both, faceTotals(both), null, new Date("2026-10-24T15:00:00Z"), undefined, platformTotals(both, new Set(["fb", "tg"])));
assert.ok(twoText.indexOf("📘 FACEBOOK") < twoText.indexOf("FB camp") && twoText.indexOf("FB camp") < twoText.indexOf("✈️ TG ADS"), "FB-блок, потом TG");
assert.ok(twoText.indexOf("Static 2 Mexico") > twoText.indexOf("✈️ TG ADS"));
const fbOnly = [both[0]];
const emptyTg = buildCheckText(fbOnly, faceTotals(fbOnly), null, new Date(), undefined, platformTotals(fbOnly, new Set(["fb", "tg"])));
assert.match(emptyTg, /✈️ TG ADS\nрасхода нет/, "подключена без расхода — не молчим");
const oneP = buildCheckText(fbOnly, faceTotals(fbOnly), null, new Date(), undefined, platformTotals(fbOnly, new Set(["fb"])));
assert.ok(!oneP.includes("FACEBOOK") && !oneP.includes("TG ADS"), "не подключена — не пишем; одна — без заголовка");
assert.equal(faceInName("TG ADS Испания roman"), "ROMAN");
assert.equal(faceInName("TG ADS Латам"), null);

console.log("check: шаблон для телеги совпадает с образцом, блоки по площадкам и лицам");
console.log("check: «не знаем» печатается прочерком, а не нулём ✓");
