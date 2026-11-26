// Самопроверка автозалива через AI (Decision 129). Запуск: npx tsx lib/mcp/autoupload.test.ts
import assert from "node:assert/strict";
import { buildPlan } from "@/lib/autoupload/plan";
import { draftInput, type DraftForm } from "@/lib/autoupload/sets";
import type { Landing } from "@/lib/autoupload/options";
import { draftByName, formOf, planPrint, planView, repeatOf, setChildren, REPEAT_MS } from "./autoupload";
import { activeKey, APP_KEY, type UploadKey } from "@/lib/autoupload/key";

const c1 = { key: "b1/vid-storytell-t31-v1-b1-es-ar.mp4", code: "vid-storytell-t31-v1-b1-es-ar", kind: "video" as const };
const form: DraftForm = {
  accountIds: ["111", "222", "999"], pixelId: "9", pageId: "55", date: "2026-11-27", campaignNumber: 1, budget: "20",
  oneToOne: false, abo: false, paused: true, omitted: [], overrides: {},
  campaigns: [{ key: "k1", geo: "MEX", actor: "ROMAN", funnel: "TG", marker: "NEW", lander: "TGR", landingUrl: "", startAtByAccount: {} }],
  adsets: [{ id: "a1", target: "BROAD", creatives: [c1] }],
  text: { cta: "LEARN_MORE", primaryText: "hi" },
};
const landings: Landing[] = [
  { id: 30, name: "Латам свежий", url: "https://latam.example/new", series: "latam" },
  { id: 20, name: "Латам старый", url: "https://latam.example/old", series: "latam" },
  { id: 10, name: "Испания", url: "https://spain.example/x", series: "spain" },
];
const alive = new Set(["111", "222"]);
const accounts = new Map([["111", { id: "111", name: "CAB1111" }], ["222", { id: "222", name: "CAB2222" }]]);

// Сохранённая сборка → вход плана, как «Проверить сборку» на странице.
const input = draftInput(form, alive, landings);
assert.deepEqual(input.accountIds, ["111", "222"], "не живой кабинет из сборки не идёт в залив");
assert.equal(input.campaigns[0].landingUrl, "https://latam.example/new", "ссылка MVP по умолчанию — свежая своей серии");
assert.equal(draftInput({ ...form, campaigns: [{ ...form.campaigns[0], geo: "ESP" }] }, alive, landings).campaigns[0].landingUrl, "https://spain.example/x");
const old = { ...form } as Partial<DraftForm>;
delete old.omitted; delete old.overrides; delete old.abo;
assert.equal(draftInput(old as DraftForm, alive, landings).campaigns.length, 1, "сборка до 1-1-1 и ABO читается");

// Отпечаток: тот же вход — тот же plan_id, любое изменение того, что создастся, — другой.
const plan = buildPlan(input, accounts, 9567);
const id = planPrint(plan);
assert.equal(planPrint(buildPlan(draftInput(form, alive, landings), accounts, 9567)), id, "сборка детерминирована");
assert.match(id, /^[0-9a-f]{12}$/);
assert.notEqual(planPrint(buildPlan({ ...input, dailyBudgetUsd: 25 }, accounts, 9567)), id, "бюджет");
assert.notEqual(planPrint(buildPlan({ ...input, paused: false }, accounts, 9567)), id, "пауза");
assert.notEqual(planPrint(buildPlan({ ...input, accountIds: ["111"] }, accounts, 9567)), id, "кабинеты");
assert.notEqual(planPrint(buildPlan({ ...input, campaigns: [{ ...input.campaigns[0], startAtByAccount: { "111": "09:00" } }] }, accounts, 9567)), id, "время старта");

// Повтор того же залива за 30 минут — отказ; через 30 минут, отменённый или другой — можно.
const now = Date.parse("2026-11-27T12:00:00Z");
const ago = (min: number) => new Date(now - min * 60_000).toISOString();
const asDb = JSON.parse(JSON.stringify(plan));   // из базы — jsonb
assert.ok(repeatOf([{ plan: asDb, created_at: ago(5), status: "creating" }], plan, now));
assert.equal(repeatOf([{ plan: asDb, created_at: ago(5), status: "cancelled" }], plan, now), null);
assert.equal(repeatOf([{ plan: asDb, created_at: new Date(now - REPEAT_MS - 1000).toISOString(), status: "created" }], plan, now), null);
assert.equal(repeatOf([{ plan: buildPlan({ ...input, accountIds: ["111"] }, accounts, 9567), created_at: ago(5), status: "created" }], plan, now), null);

// Сборка по названию.
const drafts = [{ name: "ESP MTG Роман" }, { name: "LATAM t38" }, { name: "LATAM t36" }];
assert.equal(draftByName(drafts, "esp mtg роман").name, "ESP MTG Роман");
assert.equal(draftByName(drafts, "MTG").name, "ESP MTG Роман", "единственное частичное совпадение");
assert.throws(() => draftByName(drafts, "LATAM"), /Есть: «ESP MTG Роман», «LATAM t38»/, "несколько — не угадываем");
assert.throws(() => draftByName([], "x"), /Сохранённых сборок нет/);

// План для человека.
const v = planView(plan, 1);
assert.equal(v.campaigns.length, 1);
assert.equal(v.more_campaigns, 1);
assert.equal(v.campaigns[0].cabinet, "CAB1111 (111)");
assert.deepEqual(v.campaigns[0].adsets[0].ads, ["vid-storytell-t31-v1-b1-es-mx"]);
assert.equal(v.paused, true);
// Форма от модели: поля по умолчанию как у пустой формы страницы, ключи строк — сами.
const bare = formOf({ accountIds: ["act_111"], pixelId: "9", pageId: "55", campaigns: [{ geo: "MEX", actor: "ROMAN", funnel: "TG", marker: "NEW", lander: "TGR", landingUrl: "https://x" } as never], adsets: [{ target: "BROAD", creatives: [c1] } as never] });
assert.deepEqual(bare.accountIds, ["111"], "act_ снимается");
assert.equal(bare.campaigns[0].key, "c1");
assert.equal(bare.adsets[0].id, "a1");
assert.equal(bare.budget, "20");
assert.equal(bare.text.cta, "LEARN_MORE");
assert.equal(buildPlan(draftInput(bare, new Set(["111"]), []), accounts, null).summary.campaigns, 1);

// 1-1-1: сет раскрывается в кампанию на каждый «адсет × креатив»; omit_key из preview убирает лишнюю.
const c2 = { key: "b1/vid-qa-t2-v1-b1-es-es.mp4", code: "vid-qa-t2-v1-b1-es-es", kind: "video" as const };
const sets = formOf({ ...bare, oneToOne: true, adsets: [{ id: "a1", target: "BROAD", creatives: [c1, c2] }] });
const kids = setChildren(sets)!;
assert.deepEqual(kids.map((k) => [k.set, k.adset, k.creative]), [[1, 1, c1.code], [1, 1, c2.code]]);
assert.equal(buildPlan(draftInput(sets, new Set(["111"]), []), accounts, null).summary.campaigns, 2);
const cut = { ...sets, omitted: [kids[1].omit_key] };
assert.deepEqual(setChildren(cut)!.map((k) => k.creative), [c1.code], "убранная кампания сета не раскрывается");
assert.equal(buildPlan(draftInput(cut, new Set(["111"]), []), accounts, null).summary.campaigns, 1, "и не заливается");
assert.equal(setChildren(bare), undefined, "без 1-1-1 — нечего раскрывать");

// Каким ключом заливать (Decision 130): отмеченный главнее приложения автозалива, без отметки — как раньше.
const k = (id: string, o: Partial<UploadKey> = {}): UploadKey => ({ id, name: id, appId: null, canWrite: true, marked: false, lastError: null, ...o });
assert.equal(activeKey([k("m1"), k("m2")])?.id, "m1", "без приложения и отметки — первый ключ с ads_management");
assert.equal(activeKey([k(APP_KEY), k("m1")])?.id, APP_KEY, "без отметки — приложение автозалива");
assert.equal(activeKey([k(APP_KEY), k("m1"), k("m2", { marked: true })])?.id, "m2", "отмеченный — главнее");
assert.equal(activeKey([k("m1", { canWrite: false }), k("m2", { marked: true, canWrite: false }), k("m3")])?.id, "m3", "без права управления — мимо");
assert.equal(activeKey([k("m1", { canWrite: false })]), null);

console.log("mcp autoupload: ok");
