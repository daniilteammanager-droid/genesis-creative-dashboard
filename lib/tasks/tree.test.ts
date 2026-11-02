// Самопроверка задач. Запуск: npx tsx lib/tasks/tree.test.ts
import assert from "node:assert/strict";
import { blank, cleanPatch, cleanRow, diff, fromRows, insert, kids, layout, move, placeFree, progress, removeBranch, rows, zone, NH, type Task } from "./tree";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const t = (n: number, parent: number | null, extra: Partial<Task> = {}): Task => ({
  id: id(n), parent: parent == null ? null : id(parent), title: `t${n}`,
  status: null, color: null, due: null, x: null, y: null, dx: null, dy: null, assignee: null, ...extra,
});
// Карта 1 → направления 2, 3 → задачи 4, 5 под 2, задача 6 под 3, подзадача 7 под 4.
const L: Task[] = [
  t(1, null, { x: 0, y: 0 }), t(2, 1, { color: "#8b5cf6" }), t(3, 1, { color: "#38bdf8" }),
  t(4, 2, { status: "todo" }), t(5, 2, { status: "done" }), t(6, 3, { status: "doing" }), t(7, 4, { status: "todo" }),
];
const names = (l: Task[], p: number) => kids(l, id(p)).map((x) => x.title);

// Куда можно бросить: карту — никуда, направление — только к направлениям, задачу — куда угодно, кроме карты и своей ветки.
assert.equal(zone(L, id(1), id(2), 0.5), null);
assert.equal(zone(L, id(2), id(3), 0.2), "before");
assert.equal(zone(L, id(2), id(4), 0.5), null);
assert.equal(zone(L, id(4), id(1), 0.5), null);
assert.equal(zone(L, id(4), id(3), 0.1), "inside");
assert.equal(zone(L, id(4), id(6), 0.1), "before");
assert.equal(zone(L, id(4), id(6), 0.5), "inside");
assert.equal(zone(L, id(4), id(7), 0.5), null); // в свою же подзадачу нельзя

// Перенос: выше среди соседей, внутрь другой ветки, в свою ветку — ничего не меняется.
assert.deepEqual(names(move(L, id(5), id(4), "before"), 2), ["t5", "t4"]);
const m = move(L, id(4), id(3), "inside");
assert.deepEqual(names(m, 3), ["t6", "t4"]);
assert.deepEqual(names(m, 4), ["t7"]); // подзадача едет с задачей
assert.equal(move(L, id(4), id(7), "inside"), L);
assert.equal(move(patch4(L), id(4), id(6), "before").find((x) => x.id === id(4))!.dx, null);
function patch4(l: Task[]) { return l.map((x) => (x.id === id(4) ? { ...x, dx: 30, dy: 40 } : x)); }

// Новый узел: под картой — направление с цветом, ниже — задача «Надо», без родителя — карта в точке.
assert.equal(blank(L, id(9), id(1)).color, "#34d399");
assert.equal(blank(L, id(9), id(2)).status, "todo");
assert.deepEqual([blank(L, id(9), null, { x: 5, y: 6 }).x, blank(L, id(9), null, { x: 5, y: 6 }).y], [5, 6]);
assert.deepEqual(names(insert(L, blank(L, id(9), id(2)), id(4)), 2), ["t4", "", "t5"]);

assert.equal(removeBranch(L, id(2)).length, 3); // карта, направление 3 и его задача
assert.equal(progress(L, id(2)), "1/3");

// Раскладка: родитель по центру детей, свободный сдвиг везёт ветку.
const { pos } = layout(L, { collapsed: new Set(), hideDone: false });
assert.equal(pos[id(2)].cy, (pos[id(4)].cy + pos[id(5)].cy) / 2);
const shifted = layout(patch4(L), { collapsed: new Set(), hideDone: false }).pos;
assert.equal(shifted[id(7)].x - pos[id(7)].x, 30);
assert.equal(shifted[id(7)].cy - pos[id(7)].cy, 40);
assert.equal(layout(L, { collapsed: new Set(), hideDone: true }).pos[id(5)], undefined);

// Бросили задачу на пустом месте ниже соседа — встала после него и осталась там, где бросили.
const opts = { collapsed: new Set<string>(), hideDone: false };
const dropped = L.map((x) => (x.id === id(4) ? { ...x, dy: 200 } : x));
const where = layout(dropped, opts).pos[id(4)];
const free = placeFree(dropped, id(4), opts);
assert.deepEqual(names(free, 2), ["t5", "t4"]);
assert.equal(layout(free, opts).pos[id(4)].cy, where.cy);
assert.ok(where.cy > NH);

// Сохранение: sort — место среди соседей, в базу уходит только изменённое.
assert.deepEqual(rows(L).map((r) => r.sort), [0, 0, 1, 0, 1, 0, 0]);
const saved = new Map(rows(L).map((r) => [r.id, JSON.stringify(r)]));
assert.deepEqual(diff(saved, L), { insert: [], patch: [], changed: [], remove: [] });
const d = diff(saved, move(L, id(5), id(4), "before").filter((x) => x.id !== id(6)));
assert.deepEqual(d.patch, [{ id: id(5), sort: 0 }, { id: id(4), sort: 1 }]);
assert.deepEqual(d.remove, [id(6)]);
// Новая строка — целиком, правка — только изменённые поля.
const d2 = diff(saved, [...L.map((x) => (x.id === id(4) ? { ...x, title: "новое" } : x)), t(9, 2, { status: "todo" })]);
assert.deepEqual(d2.patch, [{ id: id(4), title: "новое" }]);
assert.equal(d2.insert.length, 1);
assert.equal(d2.insert[0].id, id(9));
assert.deepEqual(fromRows(rows(L).reverse()).map((x) => x.id).filter((x) => [id(4), id(5)].includes(x)), [id(4), id(5)]);

// Из браузера: мусор — ошибка.
assert.equal(cleanRow({ id: id(1), title: "x".repeat(400), sort: 2.4 }).title.length, 300);
assert.equal(cleanRow({ id: id(1), sort: 2.4 }).sort, 2);
assert.throws(() => cleanRow({ id: "1" }));
assert.throws(() => cleanRow({ id: id(1), status: "wip" }));
assert.throws(() => cleanRow({ id: id(1), color: "red" }));
assert.throws(() => cleanRow({ id: id(1), due: "завтра" }));
assert.throws(() => cleanRow({ id: id(1), assignee: "кто-то" }));
assert.deepEqual(cleanPatch({ id: id(1), title: "x", hack: 1 }), { id: id(1), title: "x" });
assert.deepEqual(cleanPatch({ id: id(1), due: null }), { id: id(1), due: null });
assert.equal(cleanRow({ id: id(1) }).assignee, null);

console.log("tasks/tree: ok");
