// Самопроверка доступа к файлам R2. Запуск: npx tsx lib/creatives/access.test.ts
import assert from "node:assert/strict";
import { mayManageKey, maySeeKey } from "./access";
import { libraryOf } from "./media";

const b3 = { role: "buyer" as const, buyer_code: "b3" };
const main = { role: "main" as const, buyer_code: null };

assert.equal(maySeeKey(b3, "b3/vid-x-b3-es.mp4"), true);
assert.equal(maySeeKey(b3, "b1/vid-x-b1-es.mp4"), false);
assert.equal(maySeeKey(b3, "b31/vid-x.mp4"), false);          // b3 — не префикс b31
assert.equal(maySeeKey(b3, "videom/videom17clst-es.mp4"), true); // легаси
assert.equal(mayManageKey(b3, "videom/videom17clst-es.mp4"), false);
assert.equal(mayManageKey(b3, "b3/vid-x.mp4"), true);
assert.equal(mayManageKey(b3, "b1/vid-x.mp4"), false);
assert.equal(mayManageKey({ role: "buyer", buyer_code: null }, "b3/x.mp4"), false);
assert.equal(mayManageKey(main, "b1/vid-x.mp4"), true);
assert.equal(maySeeKey(main, "b1/vid-x.mp4"), true);
console.log("access: ok");

// Медиатека баера: своё — всегда, легаси — только то, что есть в его статистике.

const files = [
  { key: "b3/stat-new-t99-v1-b3-es-es.jpeg", url: "", own: true },            // свежая своя, ещё не крутилась
  { key: "balance/vid-balance-t11-v1-b1-es-ar.mp4", url: "", own: false },    // легаси, крутится у него
  { key: "storytell/vid-storytell-t2-v1-b2-es-es.mp4", url: "", own: false }, // легаси, не его
];
const lib = libraryOf(files, ["vid-balance-t11-v1-b1-es-ar"], new Set()).map((f) => f.key);
assert.deepEqual(lib, ["b3/stat-new-t99-v1-b3-es-es.jpeg", "balance/vid-balance-t11-v1-b1-es-ar.mp4"]);
console.log("library: ok");
