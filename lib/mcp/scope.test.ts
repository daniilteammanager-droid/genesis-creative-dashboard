// Самопроверка отбора кабинета и BM по запросу (get_cabinets, get_rejects). Запуск: npx tsx lib/mcp/scope.test.ts
import assert from "node:assert/strict";
import { accountMatches, bmMatches } from "./scope";

const id = "998564979344892";
assert.ok(accountMatches(id, ""), "пусто — любой");
assert.ok(accountMatches(id, id));
assert.ok(accountMatches(id, `act_${id}`));
assert.ok(accountMatches(id, " CAB4892 "), "CAB и 4 последние цифры, регистр и пробелы не важны");
assert.ok(!accountMatches(id, "CAB4893"));
assert.ok(!accountMatches(id, "4892"), "голые 4 цифры — не кабинет");
assert.ok(!accountMatches(id, "99856497934489"), "часть id — не кабинет");

const bm = { id: "1234567890", name: "Genesis Spain BM 3" };
assert.ok(bmMatches(bm, ""));
assert.ok(bmMatches(bm, "1234567890"));
assert.ok(bmMatches(bm, "spain bm"), "часть имени без учёта регистра");
assert.ok(!bmMatches(bm, "latam"));
assert.ok(!bmMatches({ id: null, name: null }, "spain"), "BM не знаем — под фильтр не подходит");
assert.ok(bmMatches({ id: null, name: null }, ""));
console.log("mcp scope: ok");
