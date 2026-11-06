// Самопроверка разбора имён TG Ads. Запуск: npx tsx lib/tgads/api.test.ts
import assert from "node:assert/strict";
import { creativeOfTitle, geoOfTitle, NO_GEO, tgCampaignId, torroSpelling } from "./api";

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

// Каналы — «Без гео», даже со страной в имени; v2-код — страна последней позицией
assert.equal(geoOfTitle("Static 4 channels"), NO_GEO);
assert.equal(geoOfTitle("Static 6 Spain Channels Crypto"), NO_GEO);
assert.equal(geoOfTitle("stat-balance-t7-v1-b9-es Channels"), NO_GEO);
assert.equal(geoOfTitle("stat-balance-t4-v1-b9-es-ar"), "AR");
assert.equal(geoOfTitle("stat-balance-t4-v1-b9-es-es"), "ES");
assert.equal(creativeOfTitle("Static 6 Channels Invest"), "Static 6");
assert.equal(creativeOfTitle("Static 6 channels PARSING FOREX"), "Static 6 FOREX");

// Имя Torro главнее регистра TG
assert.equal(torroSpelling("Static 4 channels", ["Static 4 Channels", "Static 2 Mexico"]), "Static 4 Channels");
assert.equal(torroSpelling("Static 6 Channels Invest", ["Static 6 Spain Channels Invest"]), "Static 6 Channels Invest");

// Копии объявления с одним именем — одна кампания
assert.equal(tgCampaignId("A", "Static 6 Spain"), tgCampaignId("A", " static 6  Spain"));
assert.notEqual(tgCampaignId("A", "Static 6 Spain"), tgCampaignId("A", "Static 3 Spain"));

console.log("tgads: страна и крео из имени объявления — верно");
