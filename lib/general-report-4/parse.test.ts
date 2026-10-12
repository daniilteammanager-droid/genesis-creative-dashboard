// Самопроверка разбора и расчётов GR 4.0. Запуск: npx tsx lib/general-report-4/parse.test.ts
//
// Проверяется то, на чём отчёт может молча соврать: колонки ищутся по заголовкам
// (перестановка не ломает разбор), CPA/IB в депах, добор CRM с квалами, лист баера,
// CAC на выплату, квалы и их доли, границы недели.
import assert from "node:assert/strict";
import { parseBuyer, parseMain } from "./parse";
import { applyFilters, buildGroups, computeTotals4, periodOf } from "./aggregate";

const D = 46286; // 21.09.2026, понедельник (серийный номер дня в Sheets)
const ES = ["Роман", "ES", "🇪🇸 ES", "FB", "TG"];
const DIMS = ["Дата", "Лицо", "Язык", "Гео", "Источник", "Воронка", "Баер"];
const Q = ["Квал A", "Квал B", "Квал C", "Квал D", "Квал E"];

const main = parseMain({
  traffic: [[...DIMS, "Спенд", "Показы", "Клики", "Клики на ленд", "Подписки", "Диалоги", ...Q, "Регион (авто)"],
            [D, ...ES, "Матвей", 100, 5000, 200, 150, 10, 4, 1, 1, 0, 0, 0, "Испания"],
            [D + 6, ...ES, "Артём", 50, 1000, 50, 40, 5, 1, 0, 0, 1, 0, 0, "Испания"],
            ["", "", "", "", "", "", "", "", "", "", "", "", ""]],                  // пустая строка формулы
  deps: [[...DIMS, "Тип (CPA/IB)", "Кол-во деп", "Сумма деп", "Кол-во выплат", "Выплата", "Регион (авто)"],
         [D, ...ES, "", "CPA", 2, 1000, 2, 600, "Испания"],
         [D, ...ES, "", "IB", 1, 500, 1, 200, "Испания"]],
  crm: [[...DIMS, "Подписки CRM", "Диалоги CRM", ...Q.map((q) => q + " CRM"),
         "Добор подписок", "Добор диалогов", "Добор A", "Добор B", "Добор C", "Добор D", "Добор E", "Регион"],
        [D, ...ES, "добор CRM", 15, 6, 2, 1, 1, 0, 0, 5, 2, 1, 0, 0, 0, 0, "Испания"]],
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

// Квалы: A = 1 (Матвей) + 1 (добор), B = 1, C = 1 (Артём) → 4 квала, неквалов 7 − 4.
assert.equal(t.qualA, 2);
assert.equal(t.quals, 4);
assert.equal(t.unquals, 3);
assert.equal(t.qualShare.qualA, 0.5);
assert.equal(computeTotals4([]).qualShare.qualA, null);   // нет квалов — доли нет, а не NaN

// Колонки по заголовкам: та же строка с переставленными колонками разбирается так же.
const shuffled = parseMain({
  traffic: [["Спенд", "Квал A", ...DIMS, "Подписки", "Диалоги", "Регион (авто)"],
            [100, 1, D, ...ES, "Матвей", 10, 4, "Испания"]],
  deps: [[...DIMS, "Тип (CPA/IB)"]],
});
assert.equal(shuffled.rows[0].budget, 100);
assert.equal(shuffled.rows[0].qualA, 1);
assert.equal(shuffled.rows[0].buyer, "Матвей");
assert.throws(() => parseMain({ traffic: [["Дата", "Спенд"], [D, 1]], deps: [] }), /нет колонок/);

// Фильтр по баеру: депы хэда без баера в него не попадают — так и задумано.
assert.equal(computeTotals4(applyFilters(main.rows, { buyer: ["Матвей"] }, null)).revenue, 0);
assert.equal(computeTotals4(applyFilters(main.rows, { buyer: ["Матвей", "Артём"] }, null)).budget, 150);
assert.equal(applyFilters(main.rows, {}, { from: "2026-09-27", to: "2026-09-27" }).length, 1);

// Неделя — пн 21.09 … вс 27.09, обе строки в одной неделе; разбивка по баеру.
assert.deepEqual(periodOf("2026-09-27", "week"), { key: "2026-09-21", label: "21.09–27.09.2026" });
const weeks = buildGroups(main.rows, "week", "buyer");
assert.equal(weeks.length, 1);
assert.equal(weeks[0].children?.[0].label, "Матвей");  // по спенду сверху

// Таблица баера: «Ввод» + «История», депы и доход из Torro, квалы.
const BUYER = [...DIMS, "Спенд", "Показы", "Клики", "Клики на ленд", "Подписки", "Диалоги", ...Q,
  "Депы (Torro)", "Доход (Torro)", "CPM", "CPC", "CTR", "CR клик→ленд", "Цена подписки", "Цена диалога", "ROMI", "Регион (авто)"];
const buyer = parseBuyer([
  [BUYER, [D, ...ES, "Илья", 100, 5000, 200, 150, 10, 3, 0, 1, 0, 0, 0, 1, 300, "", "", "", "", "", "", "", "Испания"]],
  [BUYER, [D - 30, ...ES, "Илья", 50, 0, 0, 0, 2, 0]],
], [[9], [31], [0.34], [0.13]]);
const bt = computeTotals4(buyer.rows);
assert.equal(bt.budget, 150);
assert.equal(bt.revenue, 300);
assert.equal(bt.cac, 150);                            // у баера CAC на деп
assert.equal(bt.qualB, 1);
assert.equal(buyer.rows[0].region, "Испания");

// Площадка — по заголовку; нет колонки — пусто. Фильтр по площадке режет только размеченные строки.
const plat = parseBuyer([[[...DIMS, "Спенд", "Площадка"], [D, "Роман", "ES", "🇪🇸 ES", "УБТ", "TG", "Игорь", 30, "YouTube"],
  [D, "Роман", "ES", "🇪🇸 ES", "УБТ", "TG", "Игорь", 20, ""]]]);
assert.equal(plat.rows[0].platform, "YouTube");
assert.equal(computeTotals4(applyFilters(plat.rows, { platform: ["YouTube"] }, null)).budget, 30);
assert.equal(main.rows[0].platform, "");

console.log("parse.test: ok");
