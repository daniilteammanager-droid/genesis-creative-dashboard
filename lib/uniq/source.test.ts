// Самопроверка выбора исходника v1. Запуск: npx tsx lib/uniq/source.test.ts
import assert from "node:assert/strict";
import { pickSource, v1Name } from "./source";

assert.equal(v1Name("vid-storytell-t26-v9-b1-es-es"), "vid-storytell-t26-v1-b1-es-es");
const keys = [
  "vid/vid-storytell-t26-v1-b1-es-es.mp4", "vid/vid-storytell-t26-v9-b1-es-es.mp4",
  "thumbnails/vid-storytell-t26-v1-b1-es-es.jpg", "variants/x.mp4", "vid/vid-balance-t30-v1-b3-es-mx.mp4",
];
assert.equal(pickSource("vid-storytell-t26-v9-b1-es-es", keys), "vid/vid-storytell-t26-v1-b1-es-es.mp4");
// Нет v1 в этом гео — v1 той же съёмки в другом.
assert.equal(pickSource("vid-balance-t30-v9-b3-es-es", keys), "vid/vid-balance-t30-v1-b3-es-mx.mp4");
assert.equal(pickSource("vid-other-t1-v2-b1-es-es", keys), null);
console.log("ok");
