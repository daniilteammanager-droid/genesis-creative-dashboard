// Самопроверка склейки версий. Запуск: npx tsx lib/creatives/merge.test.ts
import assert from "node:assert/strict";
import { mergeVersions, toCsv, versionKey } from "./merge";
import type { CreativeRow } from "@/lib/warehouse/creatives";

assert.equal(versionKey("vid-storytell-t30-v14-b1-es-mx"), "vid-storytell-t30-v*-b1-es-mx");
const row = (code: string, spend: number, dep: number | null, faces: string[]): CreativeRow => ({
  code, scheme: "v2", approach: "storytell", countries: ["MX"], geoFromCode: "MX", geoMismatch: false, owners: ["u"],
  spend, clicks: 1, impressions: 10, adCount: 1, campaigns: 1, crmClicks: null, subscribers: 1, dialogs: null,
  registrations: null, depCount: dep === null ? null : 1, depSum: dep, redepCount: null, redepSum: null, quals: null, faces,
});
const m = mergeVersions([row("vid-a-t1-v1-b1-es-mx", 10, 100, ["ROMAN"]), row("vid-a-t1-v2-b1-es-mx", 5, null, ["RICKY"]), row("vid-b-t1-v1-b1-es-mx", 1, null, [])]);
assert.equal(m.length, 2);
assert.equal(m[0].versions, 2);
assert.equal(m[0].spend, 15);
assert.equal(m[0].depSum, 100);
assert.deepEqual(m[0].faces, ["RICKY", "ROMAN"]);
assert.equal(toCsv([["a;b", 'x"y']]), '﻿"a;b";"x""y"');
console.log("creatives merge: ok");
