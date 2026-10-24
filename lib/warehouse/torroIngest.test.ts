// Самопроверка сопоставления имён Torro с id Meta. Запуск: npx tsx lib/warehouse/torroIngest.test.ts
import assert from "node:assert/strict";
import { uniqueIds, mergeByKey } from "./torroIngest";

// Однозначное имя получает id, повторяющееся у двух id — не получает никакого:
// делить депозиты между двумя объявлениями с одним именем нечем.
const ids = uniqueIds([
  { id: "1", name: "vid-a" }, { id: "1", name: "vid-a" },   // одно объявление, разные дни
  { id: "2", name: "vid-b" }, { id: "3", name: "vid-b" },   // два объявления, одно имя
  { id: "4", name: "  " },
]);
assert.equal(ids.get("vid-a"), "1");
assert.equal(ids.has("vid-b"), false);
assert.equal(ids.size, 1);

// Старое и новое имя одного объявления — одна строка с суммой.
const merged = mergeByKey([
  { ad_id: "1", subscribers: 2, dep_sum: 100, period_start: "2026-10-22" },
  { ad_id: "1", subscribers: 3, dep_sum: 50, period_start: "2026-10-22" },
  { ad_id: "2", subscribers: 1, dep_sum: 0, period_start: "2026-10-22" },
], "ad_id");
assert.equal(merged.length, 2);
assert.equal(merged[0].subscribers, 5);
assert.equal(merged[0].dep_sum, 150);
assert.equal(merged[0].period_start, "2026-10-22", "строки не числа не трогаются");

console.log("torroIngest: имена сопоставляются только однозначно, дубли складываются");
