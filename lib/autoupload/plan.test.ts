// Самопроверка сборки автозалива. Запуск: npx tsx lib/autoupload/plan.test.ts
import assert from "node:assert/strict";
import { buildPlan, cabCode, codeForGeo, trackedUrl, zonedToUtc, type PlanInput } from "./plan";
import { childKey, rowsFor } from "./sets";

assert.equal(cabCode({ id: "1094001613550695", name: "CAB0695 Артём" }), "CAB0695");
assert.equal(cabCode({ id: "1094001613557777", name: "без кода" }), "CAB7777");
assert.equal(codeForGeo("vid-storytell-t31-v1-b2-es-ar", "MEX"), "vid-storytell-t31-v1-b2-es-mx");
assert.equal(codeForGeo("vid-storytell-t31-v1-b2-es-", "ESP"), "vid-storytell-t31-v1-b2-es-es");
assert.equal(codeForGeo("videoM2FXtoro", "ESP"), "videom2fxtoro");
const url = trackedUrl("https://land.example/x?utm=1&b=999", 9567, "123");
assert.ok(url.startsWith("https://land.example/x?utm=1&b=9567&pixel=123&campaign_id={{campaign.id}}"));
assert.equal(zonedToUtc("2026-10-27T09:00", "Europe/Moscow"), "2026-10-27T06:00:00.000Z");
assert.equal(zonedToUtc("2026-10-27T09:00", "America/Mexico_City"), "2026-10-27T15:00:00.000Z");

const c1 = { key: "b1/vid-storytell-t31-v1-b1-es-ar.mp4", code: "vid-storytell-t31-v1-b1-es-ar", kind: "video" as const };
const c2 = { key: "b1/vid-qa-t2-v1-b1-es-.mp4", code: "vid-qa-t2-v1-b1-es-", kind: "video" as const };
const row = { key: "k1", geo: "MEX", actor: "ROMAN", funnel: "TG", marker: "NEW", lander: "TGR", landingUrl: "https://l.example/a", startAtByAccount: { "111": "09:00" } };
const input: PlanInput = {
  accountIds: ["111", "222"], pixelId: "9", pageId: "55", date: "2026-10-27",
  campaignNumber: 3, dailyBudgetUsd: 20, oneToOne: false, paused: true,
  campaigns: [row],
  adsets: [{ id: "a1", target: "BROAD", creatives: [c1, c2] }],
  text: { cta: "learn_more", primaryText: "hi" },
};
const accounts = new Map([["111", { id: "111", name: "CAB1111" }], ["222", { id: "222", name: "CAB2222" }]]);
const p = buildPlan(input, accounts, 9567);
assert.deepEqual(p.summary, { campaigns: 2, adsets: 2, ads: 4, accounts: 2, sets: 0, bidCaps: 0 });
assert.equal(p.campaigns[0].name, "CAB1111_27.10_TG_NEW_MEX_TGR_ROMAN_3");
assert.equal(p.campaigns[1].name, "CAB2222_27.10_TG_NEW_MEX_TGR_ROMAN_3");
assert.equal(p.campaigns[0].startLocal, "2026-10-27T09:00");
assert.equal(p.campaigns[1].startLocal, "2026-10-27T00:00");
assert.equal(p.campaigns[0].adsets[0].name, "MEX_BROAD_TEST1");
assert.deepEqual(p.campaigns[0].adsets[0].ads.map((a) => a.name), ["vid-storytell-t31-v1-b1-es-mx", "vid-qa-t2-v1-b1-es-mx"]);
// Своя строка: бюджет, бидкап, шаблоны имён.
const own = buildPlan({ ...input, accountIds: ["111"], campaigns: [{ ...row, budgetUsd: "35", bidCapEnabled: true, bidCapUsd: "2,5", campaignName: "{{CAB}}_{{GEO}}_X{{N}}", adsetNames: ["{{GEO}}_B{{ADSET_N}}"] }] }, accounts, 9567);
assert.equal(own.campaigns[0].name, "CAB1111_MEX_X3");
assert.equal(own.campaigns[0].adsets[0].name, "MEX_B1_TEST1");
assert.equal(own.campaigns[0].budgetUsd, 35);
assert.equal(own.campaigns[0].bidCapUsd, 2.5);
assert.throws(() => buildPlan({ ...input, campaigns: [{ ...row, campaignName: "{{FOO}}" }] }, accounts, 9567), /неизвестный токен/);
assert.throws(() => buildPlan({ ...input, campaigns: [{ ...row, bidCapEnabled: true, bidCapUsd: "" }] }, accounts, 9567), /Bid cap/);

// 1-1-1: сет MEX раскрывается по креативу; второй сет CHL без одного креатива и с правкой.
const sets = [{ ...row, key: "s1" }, { ...row, key: "s2", geo: "CHL" }];
const omitted = new Set([childKey("s2", "a1", c2.key)]);
const overrides = { [childKey("s2", "a1", c1.key)]: { budgetUsd: "50" } };
const rows = rowsFor(true, sets, input.adsets, omitted, overrides);
assert.equal(rows.length, 3);
const q = buildPlan({ ...input, oneToOne: true, accountIds: ["111"], campaigns: rows }, accounts, 9567);
assert.deepEqual(q.campaigns.map((c) => c.name), ["CAB1111_27.10_TG_NEW_MEX_TGR_ROMAN_3", "CAB1111_27.10_TG_NEW_MEX_TGR_ROMAN_4", "CAB1111_27.10_TG_NEW_CHL_TGR_ROMAN_3"]);
assert.equal(q.campaigns[2].adsets[0].ads[0].name, "vid-storytell-t31-v1-b1-es-cl");
assert.equal(q.campaigns[2].budgetUsd, 50);
assert.equal(q.summary.sets, 2);
// Набор поменялся после сборки — честная ошибка.
assert.throws(() => buildPlan({ ...input, oneToOne: true, campaigns: rows, adsets: [{ ...input.adsets[0], creatives: [c2, c1] }] }, accounts, 9567), /изменился/);
assert.throws(() => buildPlan({ ...input, pixelId: "" }, accounts, 9567), /пиксель/);
assert.throws(() => buildPlan({ ...input, campaigns: [{ ...row, lander: "ART1" }] }, accounts, 9567), /воронку/);
console.log("autoupload plan: ok");
