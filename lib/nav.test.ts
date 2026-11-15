// Самопроверка доступа к «Легаси крео» (Decision 119). Запуск: npx tsx lib/nav.test.ts
import assert from "node:assert/strict";
import { canSeeLegacy } from "./auth/types";
import { areasFor, startPageOf } from "./nav";
import { stepsFor } from "./onboarding/steps";

const closed = { role: "buyer", legacy_access: false } as const;
const open = { role: "buyer", legacy_access: true } as const;
const has = (p: Parameters<typeof areasFor>[0]) => areasFor(p).some((a) => a.href === "/library");
const tours = (p: typeof closed | typeof open | { role: "main"; legacy_access: false }) => stepsFor(p).some((s) => s.route === "/library");

// Баер: решает флаг. Владелец и тимлид — всегда, флаг у них не читается.
assert.equal(canSeeLegacy(closed), false);
assert.equal(canSeeLegacy(open), true);
assert.equal(canSeeLegacy({ role: "main", legacy_access: false }), true);
assert.equal(canSeeLegacy({ role: "teamlead", legacy_access: false }), true);
// Профиль не прочитался — не запираем (как middleware со статусом).
assert.equal(canSeeLegacy(null), true);

// Панель и обучалка закрытому баеру раздел не показывают.
assert.equal(has(closed), false);
assert.equal(has(open), true);
assert.equal(tours(closed), false);
assert.equal(tours(open), true);
assert.equal(tours({ role: "main", legacy_access: false }), true);

// Стартовая «Легаси» у закрытого баера ведёт на Главную, а не в отказ.
assert.equal(startPageOf("/library", areasFor(closed)), "/home");
assert.equal(startPageOf("/library", areasFor(open)), "/library");

console.log("nav: ok");
