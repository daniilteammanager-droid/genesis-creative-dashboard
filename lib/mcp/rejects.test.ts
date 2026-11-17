// Самопроверка отклонённых объявлений через AI. Запуск: npx tsx lib/mcp/rejects.test.ts
import assert from "node:assert/strict";
import { merge, pickAds, policiesOf, rowOf, summarize, NO_REASON, type CurrentRow, type EventRow, type Query, type Who } from "./rejects";

const cur = (p: Partial<CurrentRow>): CurrentRow => ({
  ad_id: "1", account_id: "1153895353840111", ad_name: "vid-edit-t38-v50-b1-es-cl", campaign_name: "CAB0111_17.11_TG_EXP_CHL_MTG_ROMAN_4",
  adset_name: "CHL_BROAD_TEST1", status: "DISAPPROVED", reason: null, first_seen_at: "2026-11-17T18:00:00Z", ...p,
});
const ev = (p: Partial<EventRow>): EventRow => ({
  created_at: "2026-11-17T18:00:01Z", kind: "rejected", ad_id: "1", account_id: "1153895353840111", ad_name: "vid-edit-t38-v50-b1-es-cl",
  campaign_name: "CAB0111_17.11_TG_EXP_CHL_MTG_ROMAN_4", actor: null, text: "DISAPPROVED", ok: null, status: null, ...p,
});

const ads = merge(
  [
    cur({}),                                                                                   // отклонено сейчас, событие есть
    cur({ ad_id: "2", ad_name: "vid-balance-t39-v50-b1-es-ec", first_seen_at: "2026-10-24T03:09:27Z", reason: "Spam: Похоже, ваше объявление…" }), // тихое: первый прогон
    cur({ ad_id: "__initialized__", account_id: "", status: "-" }),                            // отметка — не отдаём
    cur({ ad_id: "tg:555:9", account_id: "555", status: "declined" }),                         // TG Ads — не отдаём
    cur({ ad_id: "5", account_id: "6614923051880222", ad_name: "stat-qa-t2-v1-b3-es-es", campaign_name: "CAB0222_10.11_WA_NEW_ESP_TGR_RICKY_1", first_seen_at: "2026-11-12T10:00:00Z" }),
  ],
  [
    ev({}),
    ev({ ad_id: "3", ad_name: "vid-edit-t38-v49-b1-es-ar", created_at: "2026-11-01T10:00:00Z", text: "Unacceptable Business Practices: Ads must not…" }),  // одобрили
    ev({ ad_id: "3", ad_name: "vid-edit-t38-v49-b1-es-ar", created_at: "2026-11-05T21:30:00Z", text: "Недопустимые бизнес-модели: Похоже…\nplacement_specific · instagram · Дискриминация: …" }),  // снова отклонили
    ev({ ad_id: "3", kind: "action", created_at: "2026-11-05T22:00:00Z", actor: "Даниил", text: "Ссылка → other.com", ok: true, status: "PENDING_REVIEW" }),
    ev({ ad_id: "tg:555:7", account_id: "555", text: "declined" }),
    ev({ ad_id: "5", account_id: "6614923051880222", created_at: "2026-11-12T10:00:00Z", ad_name: "stat-qa-t2-v1-b3-es-es" }),
  ],
);

const byId = new Map(ads.map((a) => [a.adId, a]));
assert.deepEqual([...byId.keys()].sort(), ["1", "2", "3", "5"], "без отметок и TG Ads");
assert.equal(byId.get("1")!.times.length, 1, "событие текущего отклонения не задваивает момент");
assert.deepEqual(byId.get("2")!.times, ["2026-10-24T03:09:27Z"], "тихое отклонение — по first_seen_at");
assert.equal(byId.get("3")!.times.length, 2, "повторное отклонение после одобрения — второй момент");
assert.equal(byId.get("3")!.status, null, "сейчас не отклонено");
assert.equal(byId.get("3")!.actions[0].ok, true);
assert.equal(byId.get("1")!.reason, null, "DISAPPROVED вместо причины — причины нет");
assert.equal(byId.get("5")!.times.length, 1, "событие в ту же секунду, что строка, — один момент");

// Политики: русские и английские имена одной политики — одно имя, площадка отрезана.
assert.deepEqual(policiesOf(byId.get("3")!.reason), ["Недопустимые бизнес-модели", "Дискриминация"]);
assert.deepEqual(policiesOf("Unacceptable business practices: x"), ["Недопустимые бизнес-модели"]);
assert.deepEqual(policiesOf("Spam: It looks like…"), ["Спам"]);
assert.deepEqual(policiesOf("Реклама без подтвержденных идентификационных данных с таргетингом на страну"), ["Нет подтверждённого рекламодателя"]);
assert.deepEqual(policiesOf(null), [NO_REASON]);

// Отбор: период по Москве, область видимости, кабинет, поиск.
const all: Query = { since: null, until: null, accounts: null, account: "", search: "" };
const ids = (f: Partial<Query>) => pickAds(ads, { ...all, ...f }).map((h) => h.ad.adId);
assert.deepEqual(ids({}), ["1", "5", "3", "2"], "новые первыми");
assert.deepEqual(ids({ accounts: ["6614923051880222"] }), ["5"], "баер видит только свои кабинеты");
assert.deepEqual(ids({ accounts: [] }), [], "без кабинетов — ничего");
assert.deepEqual(ids({ since: "2026-11-06", until: "2026-11-06" }), ["3"], "21:30 UTC 05.11 — уже 06.11 по Москве");
assert.deepEqual(pickAds(ads, { ...all, since: "2026-11-02", until: "2026-11-10" })[0].times, ["2026-11-05T21:30:00Z"], "моменты — только в периоде");
assert.deepEqual(ids({ account: "CAB0222" }), ["5"]);
assert.deepEqual(ids({ account: "act_6614923051880222" }), ["5"]);
assert.deepEqual(ids({ search: "T38" }), ["1", "3"]);
assert.deepEqual(ids({ search: "ricky" }), ["5"], "поиск и по кампании");

// Сводка и строка.
const who: Who = (id) => ({ buyer: id === "6614923051880222" ? "Влад" : "Андрей", account: `CAB${id.slice(-4)}` });
const hits = pickAds(ads, all);
assert.deepEqual(summarize(hits, "text", who).map((b) => [b.name, b.ads, b.rejections, b.now_rejected]),
  [["b1 · t38", 2, 3, 1], ["b1 · t39", 1, 1, 1], ["b3 · t2", 1, 1, 1]]);
assert.deepEqual(summarize(hits, "reason", who).find((b) => b.name === NO_REASON)?.ads, 2);
assert.deepEqual(summarize(hits, "face", who).map((b) => b.name), ["ROMAN", "RICKY"]);
assert.deepEqual(summarize(hits, "buyer", who).map((b) => [b.name, b.ads]), [["Андрей", 3], ["Влад", 1]]);
const r = rowOf(hits.find((h) => h.ad.adId === "3")!, who, true);
assert.equal(r.text, "b1 · t38");
assert.equal(r.geo, "CL", "гео — из имени кампании");
assert.equal(r.land, "MTG");
assert.equal(r.now_rejected, false);
assert.deepEqual(r.rejected, ["2026-11-01 13:00", "2026-11-06 00:30"]);
assert.deepEqual(r.actions, [{ at: "2026-11-06 01:00", by: "Даниил", what: "Ссылка → other.com", ok: true, status: "PENDING_REVIEW" }]);
assert.equal(rowOf(hits[0], who, false).buyer, undefined, "баеру своё имя в строке не нужно");
console.log("mcp rejects: ok");
