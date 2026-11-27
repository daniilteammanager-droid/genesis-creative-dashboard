// Самопроверка selectAll: пачки параллельных страниц собирают все строки по порядку, без лишних и без дублей.
// Запуск: npx tsx lib/warehouse/read.test.ts
import assert from "node:assert/strict";
import { selectAll } from "./read";

(async () => {
for (const total of [0, 1, 999, 1000, 1001, 8999, 9000, 9001, 17367, 25000]) {
  let calls = 0;
  const rows = await selectAll<number>(async (from, to) => {
    calls++;
    return { data: Array.from({ length: Math.max(0, Math.min(to + 1, total) - from) }, (_, i) => from + i), error: null };
  });
  assert.deepEqual(rows, Array.from({ length: total }, (_, i) => i), `всего ${total}`);
  assert.ok(calls <= Math.floor(total / 1000) + 1 + 7, `всего ${total}: ${calls} запросов`);
}

await assert.rejects(
  selectAll(async (from) => (from === 3000 ? { data: null, error: { message: "сбой" } } : { data: new Array(1000).fill(0), error: null })),
  /сбой/
);

console.log("read.test: ok");
})().catch((e) => { console.error(e); process.exit(1); });
