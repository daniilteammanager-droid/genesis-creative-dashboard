// Самопроверка парсера кода и индекса медиа. Без фреймворков:
//   npx tsx lib/creatives/code.test.ts
import assert from "node:assert/strict";
import { parseCreativeCode, geoOf, approachOf, buyerOf, shootKey, parseCampaignName, parseAdSetName } from "./code";
import { buildMediaIndex, lookupMedia, type MediaFile } from "./media";

// ─── Новая схема ──────────────────────────────────────────────────────────────

const parsed = parseCreativeCode("vid-storytell-t31-v1-b2-es-ar");
assert.deepEqual(parsed, {
  scheme: "v2",
  medium: "vid",
  approach: "storytell",
  textNo: 31,
  version: 1,
  buyer: "b2",
  language: "es",
  geo: "ar",
});

// Имя файла с расширением и в верхнем регистре — тот же код.
assert.deepEqual(parseCreativeCode("VID-Storytell-t31-v1-b2-es-ar.MP4"), parsed);

assert.equal(geoOf("vid-storytell-t31-v1-b2-es-ar"), "ar", "гео — последняя позиция, не вторая");
assert.equal(approachOf("vid-storytell-t31-v1-b2-es-ar"), "storytell");
assert.equal(buyerOf("vid-storytell-t31-v1-b2-es-ar"), "b2");
assert.equal(shootKey("vid-storytell-t31-v1-b2-es-ar"), "vid-storytell-t31-v1-b2");

// Язык и гео часто совпадают — это не опечатка.
assert.equal(geoOf("stat-checklist-t23-v1-b2-es-es"), "es");

// Подход берётся из кода и НЕ из папки, даже когда папка есть: новые загрузки все падают
// в vid/ и stat/, так что папка перестала что-либо значить.
assert.equal(approachOf("vid-storytell-t31-v1-b2-es-ar", "vid/vid-storytell-t31-v1-b2-es-ar.mp4"), "storytell");

// ─── Старая схема ─────────────────────────────────────────────────────────────

assert.equal(parseCreativeCode("videoM17CLstr-es").scheme, "legacy");
assert.equal(parseCreativeCode("balance5-off-es-tg").scheme, "legacy");
assert.equal(shootKey("videoM17CLstr-es"), undefined, "у старых кодов ключа съёмки нет");
assert.equal(buyerOf("videoM17CLstr-es"), undefined, "принадлежности в старом имени не было");

// Для старых имён гео по-прежнему берётся из второго сегмента, как и раньше.
assert.equal(geoOf("videom17clstr-es"), "es");
assert.equal(geoOf("balance5-off-es-tg"), "off", "не гео — решает справочник, а не парсер");

// Подход старого кода — папка в R2.
assert.equal(approachOf("videom17clstr-es", "videom/videom17clstr-es.mov"), "videom");
assert.equal(approachOf("videom17clstr-es"), "unknown", "без файла подход неизвестен");

// Почти-новые имена не должны случайно пройти как новые.
for (const almost of ["vid-storytell-t31-v1-es-ar", "vid-storytell-31-1-2-es-ar", "vid-storytell-t31-v1-b2-es"]) {
  assert.equal(parseCreativeCode(almost).scheme, "legacy", `${almost} не полный код`);
}

// ─── Имена РК и адсетов ───────────────────────────────────────────────────────

assert.deepEqual(parseCampaignName("T2A0317_24.08_TG_EXP_ARG_TGR_ROMAN"), {
  account: "T2A0317", day: "24.08", funnel: "TG", marker: "EXP",
  geo: "ARG", land: "TGR", face: "ROMAN", tag: undefined,
});

// Старый формат кабинета живёт рядом с новым — переименовывать РК не будут.
assert.equal(parseCampaignName("T2A/63_24.08_WA_NEW_LATAM_ART1_RICKY")?.account, "T2A/63");
assert.equal(parseCampaignName("T2A0317_24.08_TG_MIX_ESP_VSL2_ROMAN_test3")?.tag, "test3");
assert.equal(parseCampaignName("что-то не по формату"), null);

assert.deepEqual(parseAdSetName("ARG_BROAD_TEST1"), { geo: "ARG", target: "BROAD", testTag: "TEST1" });
assert.deepEqual(parseAdSetName("ESP_INT"), { geo: "ESP", target: "INT", testTag: undefined });

// ─── Индекс медиа ─────────────────────────────────────────────────────────────

const file = (key: string): MediaFile => ({ key, url: `https://cdn/${key}` });
const media = [
  file("vid/vid-storytell-t31-v1-b2-es-es.mp4"),
  file("vid/vid-storytell-t40-v1-b2-es-es.mp4"),
  file("videom/videom17clstr-es.mov"),
  file("qa/qa-6-es.mp4"),
];
const suffixes = new Set(["es", "ar", "mx"]);
const index = buildMediaIndex(media, suffixes);

// Точное совпадение.
assert.equal(lookupMedia(index, "vid-storytell-t31-v1-b2-es-es")?.exact, true);
assert.equal(lookupMedia(index, "videoM17CLstr-es.mov")?.exact, true, "регистр и расширение не мешают");

// Другое гео той же съёмки — подставляем файл, но помечаем неточным.
const crossGeo = lookupMedia(index, "vid-storytell-t31-v1-b2-es-ar");
assert.equal(crossGeo?.exact, false);
assert.equal(crossGeo?.file.key, "vid/vid-storytell-t31-v1-b2-es-es.mp4");

// Другая озвучка той же съёмки — тоже одна съёмка.
assert.equal(lookupMedia(index, "vid-storytell-t31-v1-b2-pt-es")?.file.key, "vid/vid-storytell-t31-v1-b2-es-es.mp4");

// А вот это разные креативы, и подставлять чужое превью нельзя.
assert.equal(lookupMedia(index, "vid-storytell-t99-v1-b2-es-es"), undefined, "другой текст");
assert.equal(lookupMedia(index, "vid-storytell-t31-v2-b2-es-es"), undefined, "другая версия");
assert.equal(lookupMedia(index, "vid-storytell-t31-v1-b7-es-es"), undefined, "другой байер");
assert.equal(lookupMedia(index, "vid-checklist-t31-v1-b2-es-es"), undefined, "другой подход");
assert.equal(lookupMedia(index, "stat-storytell-t31-v1-b2-es-es"), undefined, "другой носитель");

// Старые имена продолжают матчиться по списку суффиксов.
assert.equal(lookupMedia(index, "qa-6-ar")?.file.key, "qa/qa-6-es.mp4");
assert.equal(lookupMedia(index, "qa-6")?.file.key, "qa/qa-6-es.mp4");

// Пустой список суффиксов выключает запасной путь для старых имён, но не для новых:
// у новых он структурный и от списка не зависит.
const noSuffix = buildMediaIndex(media, new Set());
assert.equal(lookupMedia(noSuffix, "qa-6-ar"), undefined, "без суффиксов старый запасной путь выключен");
assert.equal(lookupMedia(noSuffix, "vid-storytell-t31-v1-b2-es-ar")?.exact, false, "новый путь работает всегда");

console.log("✅ parseCreativeCode + buildMediaIndex self-check passed");
