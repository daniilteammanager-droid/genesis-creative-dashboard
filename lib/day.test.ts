import { mskDay, mskStamp, mskDaysAgo } from "./day";
import assert from "node:assert";

// 30 августа 23:30 UTC — это уже 31-е в Москве. Ровно тот случай, ради которого
// файл и появился: наивный toISOString() вернул бы здесь 2026-08-30.
const lateNight = new Date("2026-08-30T23:30:00Z");
assert.equal(mskDay(lateNight), "2026-08-31");
assert.equal(mskStamp(lateNight), "31.08 - 02:30");

// Днём разницы в дате нет, но время всё равно московское.
const midday = new Date("2026-08-30T10:53:00Z");
assert.equal(mskDay(midday), "2026-08-30");
assert.equal(mskStamp(midday), "30.08 - 13:53");

// Отсчёт назад ведётся от московского дня, а не от UTC.
assert.equal(mskDaysAgo(0, lateNight), "2026-08-31");
assert.equal(mskDaysAgo(7, lateNight), "2026-08-24");

console.log("day: московский день считается от полуночи по МСК ✓");
