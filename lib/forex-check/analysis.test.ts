import assert from "node:assert";
import { parseFB, parseMVP, formatMoney } from "./parse";
import { buildCheckFromItems, buildRows, buildAdCreativeAnalysis } from "./analysis";
import type { SheetData, FBDetailedItem, CheckRow } from "./types";

// Ручной чек — запасной путь на случай, когда склад или подключения недоступны.
// Значит ломаться он не имеет права тем более. Правило Decision 004: источник
// строк — выгрузка FB, и кампания без пары в MVP остаётся в чеке с нулями,
// а не исчезает. Молча потерянная кампания и есть худший исход этого модуля.

const fb: SheetData[] = [{
  sheetName: "Лист1",
  rows: [
    ["Отчёт за 31.08"],                              // мусорная строка над шапкой
    ["Кампания", "Расход", "Клики (все)"],
    ["31.08 - SPAIN-ES - EDIT-1 - 7T2A", "125,30", "40"],
    ["31.08 - CZECH-CS - EDIT-2", "80", "10"],
    ["31.08 - GERM-DE - PAUSED", "0", "0"],          // без расхода — в чек не идёт
    ["", "999", "1"],                                // без имени — не строка
  ],
}];

const mvp: SheetData[] = [{
  sheetName: "data",
  rows: [
    ["Name", "sub", "chat", "dep_summary", "redep_summary", "click"],
    ["31.08 - SPAIN-ES - EDIT-1 - 7T2A", "12", "5", "400", "100", "70"],
    ["31.08 - ONLY-IN-MVP - EDIT-9", "3", "1", "50", "0", "8"],
  ],
}];

const fbItems = parseFB(fb, { entity: "campaign" }).items;
const mvpItems = parseMVP(mvp, { entity: "campaign" });

// ── Разбор ───────────────────────────────────────────────────────────────────
assert.equal(fbItems.length, 2, "строки без расхода и без имени в чек не попадают");
assert.equal(fbItems[0].spend, 125.3, "запятая как десятичный разделитель");
assert.equal(fbItems[0].clicks, 40);
assert.equal(mvpItems.length, 2);

// ── Decision 004: нет в MVP — остаётся с нулями ──────────────────────────────
const rows = buildRows(fbItems, mvpItems, false);
assert.equal(rows.length, 2, "строки только из MVP без флага не добавляются");

const spain = rows.find((r) => r.title.includes("SPAIN"))!;
const czech = rows.find((r) => r.title.includes("CZECH"))!;

assert.equal(czech.status, "⚠️ Есть в ФБ, нет в MVP");
assert.equal(czech.spend, 80, "расход кампании без пары не теряется");
assert.equal(czech.sub, 0);
assert.equal(czech.chat, 0);
assert.equal(czech.costPerSub, null, "деление на ноль даёт null, а не Infinity");
assert.equal(czech.costPerChat, null);

assert.equal(spain.status, "✅ OK");
assert.equal(spain.sub, 12);
assert.equal(spain.chat, 5);
assert.equal(spain.deposits, 500, "депозиты и редепозиты складываются");
assert.equal(spain.depSummary, 400);
assert.equal(spain.redepSummary, 100);
assert.ok(Math.abs(spain.costPerSub! - 125.3 / 12) < 1e-9);
assert.equal(spain.geo, "Испания");
assert.equal(spain.cabinet, "7T2A");
assert.equal(spain.date, "31.08");

// ── Диагностика отдельно от результата ───────────────────────────────────────
const withDiagnostics = buildRows(fbItems, mvpItems, true);
const mvpOnly = withDiagnostics.find((r) => r.title.includes("ONLY-IN-MVP"))!;
assert.equal(withDiagnostics.length, 3);
assert.equal(mvpOnly.status, "⚠️ Есть в MVP, нет в ФБ");
assert.equal(mvpOnly.inCheck, false, "строка из MVP помечена как не входящая в чек");
assert.equal(mvpOnly.spend, 0);

// ── Текст чека ───────────────────────────────────────────────────────────────
const text = buildCheckFromItems(fbItems, mvpItems);
assert.ok(text.includes("Испания") && text.includes("Чехия"), "оба гео в чеке");
assert.ok(text.includes("31.08 - CZECH-CS - EDIT-2"), "кампания без MVP остаётся в тексте");
assert.ok(!text.includes("ONLY-IN-MVP"), "строки только из MVP в чек не попадают");
assert.ok(text.includes(`Общ.: ${formatMoney(125.3)}`) || text.includes("Общ.:"), "есть итог по гео");

// Пустой ввод не роняет сборку
assert.equal(buildCheckFromItems([], []), "");
assert.deepEqual(buildRows([], [], true), []);

// ── Крео по странам: метрики кампании не размножаются по числу крео ──────────
// Когда MVP-файла по объявлениям нет, метрики берутся из основного чека на
// уровне кампании. Раньше каждое крео получало ПДП кампании целиком: у кампании
// с 10 ПДП и тремя крео сводка показывала 30 — и это уезжало в телегу.
const ad = (adTitle: string, spend: number): FBDetailedItem => ({
  title: adTitle, normalizedTitle: adTitle, entity: "ad",
  campaignTitle: "31.08 - SPAIN-ES - CAMP", campaignNormalizedTitle: "31.08 - SPAIN-ES - CAMP",
  adTitle, adNormalizedTitle: adTitle, creative: adTitle, geo: "Испания",
  date: "31.08", cabinet: "", spend, budget: null, clicks: null, views: null,
  status: "", adStatus: "", accountStatus: "", rawId: "", adId: adTitle,
  campaignId: "c1", rowNumber: 1, firstSeenIndex: 0,
});

const campaignRow: CheckRow = {
  status: "✅ OK", title: "31.08 - SPAIN-ES - CAMP", geo: "Испания", date: "31.08",
  cabinet: "", budget: "", spend: 100, sub: 10, chat: 5, deposits: 300,
  depSummary: 300, redepSummary: 0, websiteClicks: 0,
  costPerSub: 10, costPerChat: 20, fbClicks: null, views: null,
  fbRow: 1, mvpRow: 1, inCheck: true,
};

const analysis = buildAdCreativeAnalysis({
  adItemsRaw: [ad("EDIT-1", 40), ad("EDIT-2", 30), ad("EDIT-3", 30)],
  mvpAdItemsRaw: [],
  metricRows: [campaignRow],
});

const totalSub = analysis.summaryRows.reduce((s, r) => s + r.sub, 0);
const totalChat = analysis.summaryRows.reduce((s, r) => s + r.chat, 0);
const totalDep = analysis.summaryRows.reduce((s, r) => s + r.deposits, 0);
const totalSpend = analysis.summaryRows.reduce((s, r) => s + r.spendTotal, 0);

assert.ok(Math.abs(totalSub - 10) < 1e-9, `ПДП по крео должны сойтись с кампанией, а не утроиться: ${totalSub}`);
assert.ok(Math.abs(totalChat - 5) < 1e-9, `диалоги: ${totalChat}`);
assert.ok(Math.abs(totalDep - 300) < 1e-9, `депозиты: ${totalDep}`);
assert.equal(totalSpend, 100);

// Доля считается по расходу: 40% расхода — 40% лидов.
const first = analysis.summaryRows.find((r) => r.creative === "EDIT-1")!;
assert.ok(Math.abs(first.sub - 4) < 1e-9, `у крео на 40% расхода должно быть 4 ПДП: ${first.sub}`);

console.log("forex-check: кампания без пары в MVP остаётся в чеке с нулями ✓");
console.log("forex-check: метрики кампании разносятся по крео, а не размножаются ✓");
