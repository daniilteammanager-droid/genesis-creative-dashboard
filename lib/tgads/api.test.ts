// Самопроверка разбора имён TG Ads. Запуск: npx tsx lib/tgads/api.test.ts
import assert from "node:assert/strict";
import { creativeOfTitle, geoOfTitle, NO_GEO, regionOfCabinet, tgCampaignId, torroSpelling } from "./api";

// Страна — словом или кодом; PR — опечатка Перу
assert.equal(geoOfTitle("Static 2 Mexico"), "MX");
assert.equal(geoOfTitle("TG Ads Argentina Snow creo"), "AR");
assert.equal(geoOfTitle("Snow 1 Spain"), "ES");
assert.equal(geoOfTitle("TG_GR_UP MX"), "MX");
assert.equal(geoOfTitle("Static 1 PR"), "PE");
assert.equal(geoOfTitle("Creo A"), null);

// Крео — как ad_name в Torro: без страны и без «TG Ads»
assert.equal(creativeOfTitle("Static 2 Mexico"), "Static 2");
assert.equal(creativeOfTitle("TG Ads Argentina Snow creo"), "Snow creo");
assert.equal(creativeOfTitle("Snow 1 Spain"), "Snow 1");
assert.equal(creativeOfTitle("Static 6"), "Static 6");

// Каналы — «Без гео», если региона не узнать; v2-код — страна последней позицией
assert.equal(geoOfTitle("Static 4 channels"), NO_GEO);
assert.equal(geoOfTitle("Static 6 Spain Channels Crypto"), "📡 Каналы · Испания");
assert.equal(geoOfTitle("stat-balance-t7-v1-b9-es Channels"), NO_GEO);
assert.equal(geoOfTitle("stat-balance-t4-v1-b9-es-ar"), "AR");
assert.equal(geoOfTitle("stat-balance-t4-v1-b9-es-es"), "ES");
assert.equal(creativeOfTitle("stat-balance-t4-v1-b9-es-ar"), "stat-balance-t4-v1-b9-es");
assert.equal(creativeOfTitle("stat-balance-t7-v1-b9-es Channels"), "stat-balance-t7-v1-b9-es");
assert.equal(creativeOfTitle("Static 6 Channels Invest"), "Static 6");
assert.equal(creativeOfTitle("Static 6 channels PARSING FOREX"), "Static 6");
assert.equal(creativeOfTitle("Static 6 Spain Channels Crypto"), "Static 6");

// Регион кабинета делит каналы и мульти-гео; «es» в «…-es-multi» — язык, не Испания
const LA = regionOfCabinet("TG ADS | ЛАТАМ genacademy TON-1"), ES = regionOfCabinet("TG ADS | ИСПАНИЯ genacademy TON-1");
assert.deepEqual([LA, ES, regionOfCabinet("TG ADS")], ["LATAM", "ES", null]);
assert.equal(geoOfTitle("Static 4 Channels", LA), "📡 Каналы · Латам");
assert.equal(geoOfTitle("Static 6 Channels Invest", ES), "📡 Каналы · Испания");
assert.equal(geoOfTitle("stat-balance-t10-v1-b9-es-multi", LA), "LATAM");
assert.equal(geoOfTitle("stat-balance-t10-v1-b9-es-multi"), "MULTI", "регион не знаем — несколько стран, а не Испания");
assert.equal(geoOfTitle("stat-balance-t10-v1-b9-es-es", LA), "ES", "страна в коде главнее региона кабинета");
assert.equal(geoOfTitle("Static 2 Mexico", ES), "MX");
// Кабинета не знаем — регион каналов по слову страны, код крео («-es» — язык) не в счёт
assert.equal(geoOfTitle("Static 6 Spain Channels Invest"), "📡 Каналы · Испания");
assert.equal(geoOfTitle("Static 4 Mexico Channels"), "📡 Каналы · Латам");
assert.equal(geoOfTitle("stat-balance-t7-v1-b9-es Channels"), NO_GEO);
// Крипто без слова Channels — тоже каналы
assert.equal(geoOfTitle("Static 6 Spain Crypto", ES), "📡 Каналы · Испания");
assert.equal(geoOfTitle("Static 3 Spain Crypt", ES), "📡 Каналы · Испания");
assert.equal(creativeOfTitle("Static 6 Spain Crypto"), "Static 6");

// Имя Torro главнее регистра TG
assert.equal(torroSpelling("Static 4 channels", ["Static 4 Channels", "Static 2 Mexico"]), "Static 4 Channels");
assert.equal(torroSpelling("Static 6 Channels Invest", ["Static 6 Spain Channels Invest"]), "Static 6 Channels Invest");

// Копии объявления с одним именем — одна кампания
assert.equal(tgCampaignId("A", "Static 6 Spain"), tgCampaignId("A", " static 6  Spain"));
assert.notEqual(tgCampaignId("A", "Static 6 Spain"), tgCampaignId("A", "Static 3 Spain"));

console.log("tgads: страна и крео из имени объявления — верно");
