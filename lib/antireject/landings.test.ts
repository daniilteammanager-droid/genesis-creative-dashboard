// Самопроверка подбора лендинга. Запуск: npx tsx lib/antireject/landings.test.ts
import assert from "node:assert/strict";
import { landingChoices, makeLink } from "./landings";
import { creativeForChange } from "./meta";

const L = (id: number, url: string, spot = "ИСПАНИЯ РОМАН", theme = "telegram") => ({ id, name: `L${id}`, url, spot, theme });
const landings = [
  L(1, "https://escuela-genesis.com/l/AAA"),
  L(2, "https://baques.blog/l/BBB"),
  L(3, "https://acd-genesis.online/l/CCC"),
  L(4, "https://escuela-genesis.com/l/DDD"),             // тот же домен — не вариант
  L(5, "https://axioma.cyou/l/EEE", "ЛАТАМ РИКАРДО"),    // чужой спот — не вариант
];

// Текущий находится по пути, без параметров и хвостового слэша
const c = landingChoices("https://www.escuela-genesis.com/l/AAA/?buyer=7&fbclid=x", landings);
assert.equal(c.current?.id, 1);
assert.deepEqual(c.candidates.map((x) => x.id), [3, 2], "тот же спот, другой домен, новые сверху");

const none = landingChoices("https://unknown.site/x", landings);
assert.equal(none.candidates.length, 0);
assert.match(none.reason!, /нет среди лендингов/);

// Ссылки нет в Torro — воронка по имени кампании: ROMAN + ESP → «ИСПАНИЯ РОМАН»
const funnel = [...landings.map((l) => ({ ...l, spot: l.spot === "ИСПАНИЯ РОМАН" ? "Academia (ИСПАНИЯ РОМАН)" : l.spot })),
  L(6, "https://other.site/l/T", "Academia (ИСПАНИЯ РОМАН)")].map((l) => (l.id === 6 ? { ...l, name: "Matvey Test" } : l));
const byName = landingChoices("https://genesisacademy.pro/mGvrDsF5?b=1", funnel, "Tessera- 265_2026-10-22_TG_MIX_ESP_MTG_ROMAN");
assert.deepEqual(byName.candidates.map((x) => x.id), [4, 3, 2, 1], "все домены воронки, кроме текущего; тест выкинут");
assert.equal(landingChoices("https://x.y/z", funnel, "T2A 07.10 RICKY MX").candidates.map((x) => x.id).join(), "5");
// Старая РК без лица, но с гео — Роман
assert.equal(landingChoices("https://x.y/z", funnel, "T2A/72 01.08 EXP TG SPAIN").candidates.length, 4);
assert.equal(landingChoices("https://x.y/z", funnel, "New Traffic Campaign").candidates.length, 0, "без гео и лица — не угадываем");

// Параметры старой ссылки переезжают на новую целиком
assert.equal(makeLink("https://escuela-genesis.com/l/AAA?buyer=7&px=1#h", landings[1]), "https://baques.blog/l/BBB?buyer=7&px=1#h");

// Креатив: меняется ровно одно поле, read-only поля вычищены
const creative = {
  id: "9", name: "vid", url_tags: "utm=1",
  object_story_spec: { page_id: "111", instagram_user_id: "222", video_data: { image_url: "x", video_id: "5", call_to_action: { value: { link: "https://a/l/1" } } } },
  contextual_multi_ads: { enroll_status: "OPT_IN" },
};
const link = creativeForChange(creative, { type: "link", newUrl: "https://b/l/2" }) as { object_story_spec: { video_data: { image_url?: string; call_to_action: { value: { link: string } } }; instagram_user_id?: string }; url_tags: string };
assert.equal(link.object_story_spec.video_data.call_to_action.value.link, "https://b/l/2");
assert.equal(link.object_story_spec.video_data.image_url, undefined, "image_url только для чтения");
assert.equal(link.object_story_spec.instagram_user_id, undefined);
assert.equal(link.url_tags, "utm=1");
assert.equal(creative.object_story_spec.video_data.call_to_action.value.link, "https://a/l/1", "исходник не тронут");
const multi = creativeForChange(creative, { type: "multi", enrollStatus: "OPT_OUT" }) as { contextual_multi_ads: { enroll_status: string } };
assert.equal(multi.contextual_multi_ads.enroll_status, "OPT_OUT");
assert.throws(() => creativeForChange({ id: "1", object_story_id: "p_1" }, { type: "page", pageId: "1" }), /опубликованного поста/);
assert.throws(() => creativeForChange({ ...creative, contextual_multi_ads: undefined }, { type: "multi", enrollStatus: "OPT_IN" }), /Multi-advertiser/);

console.log("antireject: лендинги той же воронки на другом домене, параметры ссылки и креатив — верно");
