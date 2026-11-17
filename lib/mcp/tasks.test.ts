// Самопроверка задач через AI (Decision 118). Запуск: npx tsx lib/mcp/tasks.test.ts
import assert from "node:assert/strict";
import { addItems, applyChanges, boardOf, findPerson, mapFrames, mapSpot, outline, unclash, MAPGAP, type Who } from "./tasks";
import { diff, kids, rows, type Task } from "@/lib/tasks/tree";
import type { Board } from "@/lib/tasks/store";

const node = (id: string, parent: string | null, title: string, ext: Partial<Task> = {}): Task =>
  ({ id, parent, title, status: null, color: null, due: null, x: parent ? null : 0, y: parent ? null : 0, dx: null, dy: null, assignee: null, ...ext });
// Карта M: направление D1 (задачи T1 — сделана, T2 — у Пети со сроком), направление D2 пустое.
const base: Task[] = [
  node("M", null, "Запуск"), node("D1", "M", "Креативы"), node("D2", "M", "Кабинеты"),
  node("T1", "D1", "Снять v1", { status: "done" }), node("T2", "D1", "Смонтировать", { status: "todo", due: "2026-11-20", assignee: "petya" }),
];
const name = (id: string) => ({ petya: "Петя" })[id] ?? "?";

// Люди и холсты.
const people: Who[] = [
  { id: "1", name: "Матвей", code: "b2", email: "m@x", active: true },
  { id: "2", name: "Мария", code: null, email: "ma@x", active: true },
];
assert.equal(findPerson(people, "b2").id, "1");
assert.equal(findPerson(people, "мария").id, "2");
assert.throws(() => findPerson(people, "ма"), /несколько/);
assert.throws(() => findPerson(people, "Олег"), /Не нашёл/);
const bs: Board[] = [
  { id: "p", title: "Мой холст", shared: false, owner: "1", members: [], mine: true },
  { id: "s", title: "Запуск Мексики", shared: true, owner: "1", members: ["2"], mine: true },
];
assert.equal(boardOf(bs, "").id, "p", "пусто — личный");
assert.equal(boardOf(bs, "мексик").id, "s");
assert.throws(() => boardOf(bs, "нет такого"));

// Дерево: по умолчанию без сделанных, карты и направления видны, даже пустые.
const open = outline(base, { open: true, mine: null, dueBefore: null }, name);
assert.deepEqual(open.map((x) => x.id), ["M", "D1", "T2", "D2"]);
assert.equal(open[0].done, "1/2");
assert.equal(open[2].assignee, "Петя");
// «Мои» и «срок до» — только путь к найденному.
assert.deepEqual(outline(base, { open: true, mine: "petya", dueBefore: null }, name).map((x) => x.id), ["M", "D1", "T2"]);
assert.deepEqual(outline(base, { open: false, mine: null, dueBefore: "2026-11-19" }, name).map((x) => x.id), []);

// Добавление: веткой, статус по умолчанию todo, top — выше прежних соседей и по порядку.
let n = 0;
const id = () => `n${++n}`;
const { list: l1, created } = addItems(base, "D1", [{ title: "A", items: [{ title: "A.1" }] }, { title: "B" }], true, id);
assert.deepEqual(kids(l1, "D1").map((t) => t.title), ["A", "B", "Снять v1", "Смонтировать"]);
assert.deepEqual(created.map((t) => t.title), ["A", "A.1", "B"]);
assert.equal(created[1].parent, "n1");
assert.equal(created[0].status, "todo");
const d = diff(new Map(rows(base).map((r) => [r.id, JSON.stringify(r)])), l1);
assert.deepEqual(d.insert.map((r) => `${r.title}:${r.sort}`).sort(), ["A.1:0", "A:0", "B:1"]);
assert.deepEqual(d.patch.map((p) => [p.id, p.sort]), [["T1", 2], ["T2", 3]], "соседи сдвинуты только полем sort");
assert.deepEqual(d.remove, []);
// Новая карта — рядом с прежними и ни на какую не наезжает: мелкая — под, высокая — в ряд справа.
const at = (l: Task[], cid: string) => l.find((t) => t.id === cid)!;
const apart = (l: Task[]) => {
  const fs = [...mapFrames(l).values()];
  return fs.every((a, i) => fs.slice(i + 1).every((b) => a.x1 + MAPGAP <= b.x0 || b.x1 + MAPGAP <= a.x0 || a.y1 + MAPGAP <= b.y0 || b.y1 + MAPGAP <= a.y0));
};
const { list: l2, created: c2 } = addItems(base, null, [{ title: "Новая", items: [{ title: "Направление" }] }], false, id);
assert.ok(c2[0].parent === null && c2[1].status === null && c2[1].color);
assert.ok(at(l2, c2[0].id).x === 0 && at(l2, c2[0].id).y! > 0, "мелкая — под прежней");
const tall = (title: string) => ({ title, items: [{ title: "Направление", items: Array.from({ length: 30 }, (_, i) => ({ title: `Задача ${i} с длинным названием в две строки` })) }] });
const { list: l4, created: c4 } = addItems(base, null, [tall("Высокая"), tall("Ещё высокая"), { title: "Мелкая" }], false, id);
assert.deepEqual([at(l4, c4[0].id).x, at(l4, c4[0].id).y], [mapFrames(base).get("M")!.x1 + MAPGAP, 0], "высокая — справа, верхом вровень");
assert.ok(apart(l4) && apart(l2), "карты не наезжают друг на друга");
assert.deepEqual(mapSpot([{ ...base[0], x: 5, y: 7 }], "M"), { x: 5, y: 7 }, "одна карта — на своём месте");
// Карта выросла и наехала на ту, что под ней: нижняя переезжает, выросшая остаётся, без наложений — никто не двигается.
const grown = addItems(l2, "D2", Array.from({ length: 20 }, (_, i) => ({ title: `Ещё ${i}` })), false, id).list;
assert.ok(!apart(grown));
const fixed = unclash(grown);
assert.ok(apart(fixed) && at(fixed, "M").y === 0, "выросшая на месте, карты не наезжают");
assert.ok(at(fixed, c2[0].id).x === 0 && at(fixed, c2[0].id).y! > at(l2, c2[0].id).y!, "нижняя ушла вниз, а не куда попало");
assert.equal(unclash(l4), l4);
// Выросла вширь (подзадачи) и задела соседа справа — тот отходит, куда ближе (тут вниз на 248, а не вправо на 552).
const wide = addItems(l4, "T2", [{ title: "Подзадача", items: [{ title: "Под-подзадача" }] }], false, id).list;
const w2 = unclash(wide);
assert.ok(!apart(wide) && apart(w2));
assert.deepEqual([at(w2, c4[0].id).x, at(w2, c4[0].id).y], [at(l4, c4[0].id).x, 248]);
assert.throws(() => addItems(base, "M", [{ title: "Н", due: "2026-11-20" }], false, id), /только у задач/);

// Правки: статус, срок, перенос, приоритет.
const l3 = applyChanges(base, [{ id: "T2", status: "doing", due: null }, { id: "T1", moveTo: "D2" }]);
assert.equal(l3.find((t) => t.id === "T2")!.status, "doing");
assert.equal(l3.find((t) => t.id === "T2")!.due, null);
assert.equal(l3.find((t) => t.id === "T1")!.parent, "D2");
assert.deepEqual(kids(applyChanges(base, [{ id: "T2", top: true }]), "D1").map((t) => t.id), ["T2", "T1"]);
assert.throws(() => applyChanges(base, [{ id: "D1", status: "done" }]), /только у задач/);
assert.throws(() => applyChanges(base, [{ id: "D1", moveTo: "D2" }]), /только в другую карту/);
assert.throws(() => applyChanges(base, [{ id: "T2", moveTo: "M" }]), /в направление или в другую задачу/);
assert.throws(() => applyChanges(base, [{ id: "D1", moveTo: "M" }, { id: "M", moveTo: "D1" }]), /карта/);
assert.throws(() => applyChanges(base, [{ id: "T2", moveTo: "нет" }]), /того же холста/);

console.log("mcp: задачи ok");
