// Самопроверка сборки автозалива. Запуск: npx tsx lib/autoupload/plan.test.ts
import assert from "node:assert/strict";
import { buildPlan, cabCode, codeForGeo, trackedUrl, zonedToUtc, type PlanInput } from "./plan";

assert.equal(cabCode({ id: "1094001613550695", name: "CAB0695 Артём" }), "CAB0695");
assert.equal(cabCode({ id: "1094001613557777", name: "без кода" }), "CAB7777");
assert.equal(codeForGeo("vid-storytell-t31-v1-b2-es-ar", "MEX"), "vid-storytell-t31-v1-b2-es-mx");
assert.equal(codeForGeo("vid-storytell-t31-v1-b2-es-", "ESP"), "vid-storytell-t31-v1-b2-es-es");
assert.equal(codeForGeo("videoM2FXtoro", "ESP"), "videom2fxtoro");
const url = trackedUrl("https://land.example/x?utm=1&b=999", 9567, "123");
assert.ok(url.startsWith("https://land.example/x?utm=1&b=9567&pixel=123&campaign_id={{campaign.id}}"));
assert.equal(zonedToUtc("2026-10-27T09:00", "Europe/Moscow"), "2026-10-27T06:00:00.000Z");
assert.equal(zonedToUtc("2026-10-27T09:00", "America/Mexico_City"), "2026-10-27T15:00:00.000Z");

const input: PlanInput = {
  accountIds: ["111", "222"], pixelByAccount: { "111": "9", "222": "8" }, pageId: "55", date: "2026-10-27", launchTime: "09:00",
  campaignNumber: 3, dailyBudgetUsd: 20, oneToOne: false, paused: true,
  campaigns: [{ geo: "MEX", actor: "ROMAN", funnel: "TG", marker: "NEW", lander: "TGR", landingUrl: "https://l.example/a" }],
  adsets: [{ target: "BROAD", creatives: [{ key: "b1/vid-storytell-t31-v1-b1-es-ar.mp4", code: "vid-storytell-t31-v1-b1-es-ar", kind: "video" }, { key: "b1/vid-qa-t2-v1-b1-es-.mp4", code: "vid-qa-t2-v1-b1-es-", kind: "video" }] }],
  text: { cta: "learn_more", primaryText: "hi" },
};
const accounts = new Map([["111", { id: "111", name: "CAB1111" }], ["222", { id: "222", name: "CAB2222" }]]);
const p = buildPlan(input, accounts, 9567);
assert.deepEqual(p.summary, { campaigns: 2, adsets: 2, ads: 4, accounts: 2 });
assert.equal(p.campaigns[0].name, "CAB1111_27.10_TG_NEW_MEX_TGR_ROMAN_3");
assert.equal(p.campaigns[1].name, "CAB2222_27.10_TG_NEW_MEX_TGR_ROMAN_3");
assert.equal(p.campaigns[0].adsets[0].name, "MEX_BROAD_TEST1");
assert.deepEqual(p.campaigns[0].adsets[0].ads.map((a) => a.name), ["vid-storytell-t31-v1-b1-es-mx", "vid-qa-t2-v1-b1-es-mx"]);
// 1-1-1: по кампании на креатив, номер растёт.
const q = buildPlan({ ...input, oneToOne: true, accountIds: ["111"] }, accounts, 9567);
assert.deepEqual(q.campaigns.map((c) => c.name), ["CAB1111_27.10_TG_NEW_MEX_TGR_ROMAN_3", "CAB1111_27.10_TG_NEW_MEX_TGR_ROMAN_4"]);
assert.equal(q.campaigns[1].adsets[0].ads.length, 1);
assert.throws(() => buildPlan({ ...input, pixelByAccount: {} }, accounts, 9567), /пиксель/);
assert.throws(() => buildPlan({ ...input, campaigns: [{ ...input.campaigns[0], lander: "ART1" }] }, accounts, 9567), /воронку/);
console.log("autoupload plan: ok");
