// Самопроверка разбора имён TG Ads. Запуск: npx tsx lib/tgads/api.test.ts
import assert from "node:assert/strict";
import { creativeOfTitle, geoOfTitle } from "./api";

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

console.log("tgads: страна и крео из имени объявления — верно");
