// Самопроверка чека в формате Артёма. Запуск: npx tsx lib/warehouse/checkArtem.test.ts
import assert from "node:assert/strict";
import { buildArtemText, groupOf, reasons, type ArtemCampaign } from "./checkArtem";

const c = (name: string, spend: number, sub: number | null, chat: number | null, extra: Partial<ArtemCampaign> = {}): ArtemCampaign =>
  ({ name, spend, budget: 50, status: "ACTIVE", banned: false, subscribers: sub, dialogs: chat, revenue: null, ...extra });

assert.equal(groupOf("CAB2074_26.10_TG_EXP_ESP_MTG_ROMAN_3"), "испания тг");
assert.equal(groupOf("26.10_1818_TG_EXP_AR_MTG_ROMAN_1"), "латам");
assert.equal(groupOf("ACC6773_26.10_TG_EXP_CHILE_TGR_ROMAN_T37"), "латам");
assert.equal(groupOf("T2A0317_24.08_WA_NEW_ESP_ART1_ROMAN_BROAD"), "испания wa");
assert.equal(groupOf("T2A/72 01.08 EXP TG SPAIN"), "испания тг");
assert.deepEqual(reasons("латам", c("x", 12, 0, 0)), ["нет ПДП при спенде $12"]);
assert.deepEqual(reasons("латам", c("x", 40, 10, 2)), ["ПДП $4 >= $3.50", "чат $20 >= $10"]);
assert.deepEqual(reasons("испания тг", c("x", 120, 10, 3)), ["ДИА $40 > $35 при спенде $120 > $100"]);

const text = buildArtemText([
  c("26.10_1818_TG_EXP_AR_MTG_ROMAN_1", 40, 10, 2),
  c("08.10_1818_TG_EXP_AR_MTG_ROMAN_1", 20, 10, 4, { budget: 200 }),
  c("26.10_1818_TG_EXP_AR_MTG_ROMAN_3", 7, 1, 0, { banned: true }),
  c("26.10_1818_TG_EXP_ES_MTG_ROMAN_1", 0, null, null, { budget: 100 }),
], [{ name: "T2A/70 19.08 EXP TG LATAM", subscribers: 3, dialogs: 1, revenue: 650 }, { name: "{{campaign.name}}", subscribers: 2, dialogs: 0, revenue: 0 }],
{ since: "2026-10-26", until: "2026-10-26", today: "2026-10-26" });
assert.ok(text.startsWith("Сегодня - Кампании\n\nЛатам - $200 + $50 тест\n\nАргентина · Роман\n\nАктивные\n\n08.10_1818_TG_EXP_AR_MTG_ROMAN_1 [$200]\n$20 / $2 / $5"));
assert.ok(text.includes("Проблемные активные\n\n26.10_1818_TG_EXP_AR_MTG_ROMAN_1 [$50]\n$40 / $4 / $20\nПричина: ПДП $4 >= $3.50, чат $20 >= $10"));
assert.ok(text.includes("Стопнутые / Бан\n\n26.10_1818_TG_EXP_AR_MTG_ROMAN_3 [$50] - БАН"));
assert.ok(text.includes("Общ. Латам:\n$67 / $2.79 / $9.57\nПДП: 24 / ДИА: 7"), "латам с Torro LATAM без расхода");
assert.ok(text.includes("Испания TG - $100 тест"), "свежая кампания без расхода — в бюджете и в чеке");
assert.ok(text.includes("Неразобранное (Торро):\n\n{{campaign.name}} — 2 лидов, 0 чатов"));
assert.ok(!buildArtemText([c("26.10_1818_TG_EXP_AR_MTG_ROMAN_3", 7, 1, 0, { status: "PAUSED" })], [], { since: "2026-10-26", until: "2026-10-26", today: "2026-10-26", activeOnly: true }).includes("ROMAN_3 ["));
console.log("checkArtem: формат Артёма — группы, разделы, причины, итоги и Torro без расхода верно");
