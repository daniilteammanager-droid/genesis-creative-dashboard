// Самопроверка порогов подсветки. Запуск: npx tsx lib/general-report-4/tone.test.ts
import assert from "node:assert/strict";
import { costTone, romiTone } from "./tone";
assert.equal(romiTone(1.3), "good");
assert.equal(romiTone(1.29), "warn");
assert.equal(romiTone(1.0), "bad");
assert.equal(romiTone(0.4), "bad");
assert.equal(romiTone(null), null);
assert.equal(costTone(9, 9), "good");
assert.equal(costTone(10.8, 9), "warn");
assert.equal(costTone(11, 9), "bad");
assert.equal(costTone(5, null), null);
console.log("gr4 tone: ok");
