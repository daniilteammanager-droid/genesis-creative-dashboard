// Самопроверка разбора и расчётов GR 4.0. Запуск: npx tsx lib/general-report-4/parse.test.ts
//
// Проверяется то, на чём отчёт может молча соврать: раскладка колонок трёх
// листов общей таблицы, CPA/IB в депах, добор CRM, лист баера, CAC на выплату
// и границы недели.
import assert from "node:assert/strict";
import { parseBuyer, parseMain } from "./parse";
import { applyFilters, buildGroups, computeTotals4, periodOf } from "./aggregate";

const D = 46286; // 21.09.2026, понедельник (серийный номер дня в Sheets)
const ES = ["Роман", "ES", "🇪🇸 ES", "FB", "TG"];

const main = parseMain({
  //          дата  разрезы  баер     спенд показы клики ленд подп диал  регион
  traffic: [[D, ...ES, "Матвей", 100, 5000, 200, 150, 10, 4, "Испания"],
            [D + 6, ...ES, "Артём", 50, 1000, 50, 40, 5, 1, "Испания"],
            ["", "", "", "", "", "", "", "", "", "", "", "", "", ""]],        // пустая строка формулы
  //        дата  разрезы  баер тип   кол сумма выпл выплата регион
  deps: [[D, ...ES, "", "CPA", 2, 1000, 2, 600, "Испания"],
         [D, ...ES, "", "IB", 1, 500, 1, 200, "Испания"]],
  //      дата  разрезы  «добор»       итого  баеры  добор  регион
  crm: [[D, ...ES, "добор CRM", 15, 6, 10, 4, 5, 2, "Испания"]],
  targets: [[9], [31], [0.34], [0.13]],
});

const t = computeTotals4(main.rows);
assert.equal(t.budget, 150);
assert.equal(t.registrations, 15 + 5);              // трафик + добор CRM
assert.equal(t.dialogs, 5 + 2);
assert.equal(t.revenue, 800);                        // доход = выплаты CPA + IB
assert.equal(t.revenueCpa, 600);
assert.equal(t.depCountIb, 1);
assert.equal(t.cacPayouts, 150 / 3);                 // CAC на выплату, как в таблице
assert.equal(t.awDep, 1500 / 3);
assert.equal(t.romiCpa, (600 - 150) / 150);
assert.deepEqual(main.targets, { costPerSub: 9, costPerDialog: 31, crToDialog: 0.34, crDialogToDep: 0.13 });
assert.equal(main.rows.find((r) => r.registrations === 5 && r.budget === 0)?.buyer, "добор CRM");

// Фильтр по баеру: депы хэда без баера в него не попадают — так и задумано.
assert.equal(computeTotals4(applyFilters(main.rows, { buyer: ["Матвей"] }, null)).revenue, 0);
assert.equal(computeTotals4(applyFilters(main.rows, { buyer: ["Матвей", "Артём"] }, null)).budget, 150);
assert.equal(applyFilters(main.rows, {}, { from: "2026-09-27", to: "2026-09-27" }).length, 1);

// Неделя — пн 21.09 … вс 27.09, обе строки в одной неделе; разбивка по баеру.
assert.deepEqual(periodOf("2026-09-27", "week"), { key: "2026-09-21", label: "21.09–27.09.2026" });
const weeks = buildGroups(main.rows, "week", "buyer");
assert.equal(weeks.length, 1);
assert.equal(weeks[0].children?.[0].label, "Матвей");  // по спенду сверху

// Таблица баера: «Ввод» + «История», депы и доход из Torro.
const buyer = parseBuyer([
  [[D, ...ES, "Илья", 100, 5000, 200, 150, 10, 3, 1, 300, "", "", "", "", "", "", "", "Испания"]],
  [[D - 30, ...ES, "Илья", 50, 0, 0, 0, 2, 0, 0, 0]],
], [[9], [31], [0.34], [0.13]]);
const bt = computeTotals4(buyer.rows);
assert.equal(bt.budget, 150);
assert.equal(bt.revenue, 300);
assert.equal(bt.cac, 150);                            // у баера CAC на деп
assert.equal(buyer.rows[0].region, "Испания");

console.log("parse.test: ok");
