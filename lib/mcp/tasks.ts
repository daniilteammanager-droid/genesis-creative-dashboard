import { randomUUID } from "node:crypto";
import { warehouse } from "@/lib/warehouse/read";
import type { Profile } from "@/lib/auth/types";
import { boards, createBoard, loadTasks, saveTasks, updateBoard, type Board } from "@/lib/tasks/store";
import { blank, byId, depth, diff, fromRows, isId, kids, layout, move, patch, progress, removeBranch, roots, rows, under, STATUS, type Status, type Task } from "@/lib/tasks/tree";
import { mskDay } from "@/lib/day";
import { ToolError, type ToolDef } from "./protocol";

// Задачи через AI (Decision 118): те же холсты, права и сохранение, что на странице «Задачи» (lib/tasks/store.ts):
// свой личный холст и общие, куда добавили; чужой личный — никому. Правка — как в браузере: загрузить холст,
// поменять дерево чистыми функциями tree.ts и отправить разницу (новые строки целиком, изменённые — полями).
// Поручили задачу другому — ему Telegram, это делает saveTasks.

interface Ctx { me: Profile; tokenId?: string }
type Tool = ToolDef<Ctx>;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KIND = ["map", "direction"] as const;
const kindOf = (d: number) => KIND[d] ?? "task";
const MAX_ADD = 100, MAX_EDIT = 50;

// ── Чистая часть (самопроверка — tasks.test.ts) ──────────────────────────────

export interface Who { id: string; name: string; code: string | null; email: string; active: boolean }

// Человек по имени, коду (b2) или почте; не нашлось точно — по началу имени.
export function findPerson(list: Who[], raw: string): Who {
  const v = raw.trim().toLowerCase();
  const exact = list.filter((p) => [p.id, p.name, p.code, p.email].some((x) => x?.toLowerCase() === v));
  const hits = exact.length ? exact : list.filter((p) => p.name.toLowerCase().startsWith(v));
  if (hits.length === 1) return hits[0];
  throw new ToolError(hits.length
    ? `«${raw}» — это несколько человек: ${hits.map((p) => p.name).join(", ")}`
    : `Не нашёл «${raw}». Можно: ${list.map((p) => p.name).join(", ") || "никого"}`);
}

// Холст по id или названию; пусто — личный.
export function boardOf(list: Board[], raw: string): Board {
  const v = raw.trim().toLowerCase();
  if (!v) return list.find((b) => !b.shared) ?? list[0];
  const exact = list.filter((b) => b.id === raw.trim() || b.title.toLowerCase() === v);
  const hits = exact.length ? exact : list.filter((b) => b.title.toLowerCase().includes(v));
  if (hits.length === 1) return hits[0];
  throw new ToolError(hits.length
    ? `Подходит несколько холстов: ${hits.map((b) => b.title).join(", ")} — назови точнее или дай id`
    : `Нет холста «${raw}». Твои: ${list.map((b) => b.title).join(", ")}`);
}

export interface Line { id: string; kind: string; depth: number; title: string; status?: Status | null; due?: string; assignee?: string; done?: string }

// Дерево холста строками в порядке карты: выше среди соседей = важнее. Карты и направления видны всегда
// (чтобы было куда добавить), задачи — по фильтру; с фильтром «мои» или «срок до» — только путь к найденному.
export function outline(l: Task[], f: { open: boolean; mine: string | null; dueBefore: string | null }, nameOf: (id: string) => string): Line[] {
  const strict = !!f.mine || !!f.dueBefore;
  const d = new Map(l.map((t) => [t.id, depth(l, t)]));
  const keep = new Set<string>();
  for (const t of l) {
    if (d.get(t.id)! < 2) { if (!strict) keep.add(t.id); continue; }
    if (f.open && t.status === "done") continue;
    if (f.mine && t.assignee !== f.mine) continue;
    if (f.dueBefore && !(t.due && t.due <= f.dueBefore)) continue;
    for (let p: Task | undefined = t; p; p = byId(l, p.parent)) keep.add(p.id);
  }
  const out: Line[] = [];
  const walk = (t: Task, dep: number) => {
    if (!keep.has(t.id)) return;
    out.push({
      id: t.id, kind: kindOf(dep), depth: dep, title: t.title || "Без названия",
      ...(dep >= 2 ? { status: t.status } : {}), ...(t.due ? { due: t.due } : {}),
      ...(t.assignee ? { assignee: nameOf(t.assignee) } : {}),
      ...(dep < 2 && progress(l, t.id) ? { done: progress(l, t.id) } : {}),
    });
    for (const k of kids(l, t.id)) walk(k, dep + 1);
  };
  for (const r of roots(l)) walk(r, 0);
  return out;
}

// Новая карта — под всеми остальными.
export function mapSpot(l: Task[]): { x: number; y: number } {
  const rs = roots(l);
  if (!rs.length) return { x: 0, y: 0 };
  const { pos } = layout(l, { collapsed: new Set(), hideDone: false });
  const bottom = Math.max(...Object.values(pos).map((p) => p.cy + p.h / 2));
  return { x: Math.min(...rs.map((r) => r.x ?? 0)), y: Math.round(bottom + 80) };
}

export interface Item { title: string; status?: Status; due?: string | null; assignee?: string | null; items?: Item[] }

// Добавить ветку: под parent (null — новые карты). top — выше прежних соседей (важнее), по порядку.
export function addItems(l: Task[], parent: string | null, items: Item[], top: boolean, newId: () => string): { list: Task[]; created: Task[] } {
  const created: Task[] = [];
  const add = (l: Task[], parent: string | null, items: Item[], top: boolean): Task[] => {
    const p = byId(l, parent), d = p ? depth(l, p) + 1 : 0;
    const first = top && p ? kids(l, p.id)[0]?.id : undefined;
    for (const it of items) {
      if (d < 2 && (it.status || it.due || it.assignee)) throw new ToolError(`«${it.title}» — ${d ? "направление" : "карта"}: статус, срок и ответственный бывают только у задач`);
      const t: Task = { ...blank(l, newId(), p ? p.id : null, p ? undefined : mapSpot(l)), title: it.title };
      if (d >= 2) Object.assign(t, { status: it.status ?? "todo", due: it.due ?? null, assignee: it.assignee ?? null });
      const i = first ? l.findIndex((x) => x.id === first) : -1;
      l = i < 0 ? [...l, t] : [...l.slice(0, i), t, ...l.slice(i)];
      created.push(t);
      if (it.items?.length) l = add(l, t.id, it.items, false);
    }
    return l;
  };
  return { list: add(l, parent, items, top), created };
}

export interface Change { id: string; title?: string; status?: Status; due?: string | null; assignee?: string | null; moveTo?: string; top?: boolean }

export function applyChanges(l: Task[], cs: Change[]): Task[] {
  for (const c of cs) {
    const t = byId(l, c.id);
    if (!t) throw new ToolError(`Нет задачи ${c.id}`);
    const d = depth(l, t), name = `«${t.title || "Без названия"}»`;
    if (d < 2 && (c.status !== undefined || c.due !== undefined || c.assignee !== undefined))
      throw new ToolError(`${name} — ${d ? "направление" : "карта"}: статус, срок и ответственный бывают только у задач`);
    const ch: Partial<Task> = {};
    if (c.title !== undefined) ch.title = c.title;
    if (c.status !== undefined) ch.status = c.status;
    if (c.due !== undefined) ch.due = c.due;
    if (c.assignee !== undefined) ch.assignee = c.assignee;
    l = patch(l, c.id, ch);
    if (c.moveTo) {
      const tg = byId(l, c.moveTo);
      if (!tg) throw new ToolError(`${name}: переносить можно только внутри того же холста`);
      const td = depth(l, tg);
      if (d === 0) throw new ToolError(`${name} — карта, она и так верхний уровень`);
      if (d === 1 && td !== 0) throw new ToolError(`${name} — направление: переносится только в другую карту`);
      if (d >= 2 && td < 1) throw new ToolError(`${name} — задача: переносится в направление или в другую задачу`);
      if (under(l, c.moveTo, c.id)) throw new ToolError(`${name} нельзя перенести внутрь её же подзадачи`);
      l = move(l, c.id, c.moveTo, "inside");
    }
    if (c.top) {
      const node = byId(l, c.id)!;
      if (!node.parent) throw new ToolError(`${name} — карта: у карт нет порядка`);
      const first = kids(l, node.parent)[0];
      if (first.id !== node.id) {
        const rest = l.filter((x) => x.id !== node.id), i = rest.indexOf(first);
        l = [...rest.slice(0, i), node, ...rest.slice(i)];
      }
    }
  }
  return l;
}

// ── База ─────────────────────────────────────────────────────────────────────

async function team(): Promise<Who[]> {
  const { data, error } = await warehouse().from("profiles").select("id, name, buyer_code, email, status");
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({
    id: p.id as string, name: (p.name as string | null)?.trim() || (p.buyer_code as string | null) || (p.email as string).split("@")[0],
    code: p.buyer_code as string | null, email: p.email as string, active: p.status === "active",
  }));
}
const namer = (t: Who[]) => (id: string) => t.find((p) => p.id === id)?.name ?? "—";

// Сохранить как страница: разница между тем, что прочитали, и новым деревом.
async function save(me: Profile, board: string, before: Task[], after: Task[]) {
  const d = diff(new Map(rows(before).map((r) => [r.id, JSON.stringify(r)])), after);
  await saveTasks(me, board, d.insert, d.patch, d.remove);
}

// Задачи по id → их холсты (только видимые мне). Чужие и несуществующие — «не нашёл».
async function byBoard(me: Profile, ids: string[]): Promise<Map<string, string[]>> {
  if (ids.some((id) => !isId(id))) throw new ToolError("id задач бери из get_tasks");
  const [{ data, error }, mine] = await Promise.all([
    warehouse().from("tasks").select("id, board_id").in("id", ids),
    boards(me).then((l) => new Set(l.map((b) => b.id))),
  ]);
  if (error) throw new Error(error.message);
  const out = new Map<string, string[]>();
  for (const r of data ?? []) if (mine.has(r.board_id as string)) out.set(r.board_id as string, [...(out.get(r.board_id as string) ?? []), r.id as string]);
  const found = new Set([...out.values()].flat()), missing = ids.filter((id) => !found.has(id));
  if (missing.length) throw new ToolError(`Не нашёл на твоих холстах: ${missing.join(", ")}. id бери из get_tasks`);
  return out;
}

const due = (v: unknown): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (!DAY.test(String(v))) throw new ToolError("Срок — YYYY-MM-DD");
  return String(v);
};
const status = (v: unknown): Status | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  if (!STATUS.some(([s]) => s === v)) throw new ToolError("status — todo, doing или done");
  return v as Status;
};

// Ответственный — хозяин или участник общего холста; на личном его нет.
function assigneeOn(b: Board, people: Who[]) {
  return (v: unknown): string | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null || v === "") return null;
    if (!b.shared) throw new ToolError("На личном холсте ответственного нет — он только на общих");
    return findPerson(people.filter((p) => p.id === b.owner || b.members.includes(p.id)), String(v)).id;
  };
}

const STRUCTURE = "Холст → карты → направления → задачи и подзадачи. Порядок среди соседей — приоритет: выше = важнее. Статус задачи: todo — «Надо», doing — «В работе», done — «Готово».";

// ── Инструменты ──────────────────────────────────────────────────────────────

const getTasks: Tool = {
  name: "get_tasks",
  title: "Задачи",
  description: `Холсты задач пользователя и задачи на них — как раздел «Задачи» дашборда: личный холст (видит только он) и общие, куда его добавили. ${STRUCTURE} У каждого узла id — по нему add_tasks, update_tasks и delete_tasks. По умолчанию — все холсты, без сделанных задач.`,
  inputSchema: {
    type: "object",
    properties: {
      board: { type: "string", description: "id или название холста. Пусто — все холсты." },
      only_mine: { type: "boolean", description: "Только задачи, где пользователь ответственный (на общих холстах; на личном — все)." },
      due_before: { type: "string", description: "Только задачи со сроком не позже этого дня, YYYY-MM-DD (просроченные тоже)." },
      include_done: { type: "boolean", description: "Показать и сделанные задачи." },
      limit: { type: "integer", description: "Сколько узлов вернуть, 1–1000. По умолчанию 300." },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false, title: "Задачи" },
  async run({ me }, a) {
    const [list, people] = await Promise.all([boards(me), team()]);
    const name = namer(people);
    const pick = str(a.board) ? [boardOf(list, str(a.board))] : list;
    const dueBefore = due(a.due_before) ?? null;
    let left = Math.min(1000, Math.max(1, Math.floor(Number(a.limit)) || 300)), more = 0;
    const out = [];
    for (const b of pick) {
      const l = fromRows(await loadTasks(me, b.id));
      const lines = outline(l, { open: a.include_done !== true, dueBefore, mine: a.only_mine === true && b.shared ? me.id : null }, name);
      const shown = lines.slice(0, left);
      left -= shown.length; more += lines.length - shown.length;
      out.push({
        id: b.id, title: b.title, kind: b.shared ? "общий" : "личный", owner: name(b.owner),
        members: b.shared ? b.members.map(name) : undefined, can_edit_board: b.shared && b.mine, nodes: shown,
      });
    }
    return { today: mskDay(), boards: out, more_nodes: more || undefined };
  },
};

const ITEM_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    title: { type: "string", description: "Текст узла." },
    status: { type: "string", enum: ["todo", "doing", "done"], description: "Только у задач. По умолчанию todo." },
    due: { type: "string", description: "Срок задачи, YYYY-MM-DD." },
    assignee: { type: "string", description: "Ответственный на общем холсте: имя, код баера (b2) или почта. Ему придёт Telegram." },
    items: { type: "array", description: "Вложенные узлы (направления в карте, задачи в направлении, подзадачи).", items: { type: "object" } },
  },
  required: ["title"],
};

const addTasks: Tool = {
  name: "add_tasks",
  title: "Добавить задачи",
  description: `Добавить на холст карты, направления, задачи и подзадачи — сразу веткой через вложенные items. ${STRUCTURE} Без parent каждый узел верхнего уровня — новая карта; с parent — внутрь этого узла (карты — направления, направления и задачи — задачи). Добавляй то, о чём просит пользователь.`,
  inputSchema: {
    type: "object",
    properties: {
      board: { type: "string", description: "id или название холста. Пусто — личный." },
      parent: { type: "string", description: "id карты, направления или задачи из get_tasks. Пусто — новые карты." },
      items: { type: "array", items: ITEM_SCHEMA, description: `Что добавить, до ${MAX_ADD} узлов вместе с вложенными.` },
      top: { type: "boolean", description: "Поставить выше прежних соседей (важнее). По умолчанию — в конец." },
    },
    required: ["items"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, title: "Добавить задачи" },
  async run({ me }, a) {
    const [list, people] = await Promise.all([boards(me), team()]);
    let b = boardOf(list, str(a.board));
    const parent = str(a.parent) || null;
    if (parent) {   // родитель сам говорит, на каком он холсте
      const [id] = (await byBoard(me, [parent])).keys();
      b = list.find((x) => x.id === id)!;
    }
    const who = assigneeOn(b, people);
    let n = 0;
    const norm = (v: unknown, lvl: number): Item[] => {
      if (!Array.isArray(v) || !v.length) return [];
      if (lvl > 6) throw new ToolError("Слишком глубокая вложенность");
      return v.map((raw) => {
        const r = (raw ?? {}) as Record<string, unknown>, title = str(r.title);
        if (!title) throw new ToolError("У каждого узла нужен title");
        if (++n > MAX_ADD) throw new ToolError(`За раз — не больше ${MAX_ADD} узлов`);
        return { title, status: status(r.status), due: due(r.due), assignee: who(r.assignee), items: norm(r.items, lvl + 1) };
      });
    };
    const items = norm(a.items, 0);
    if (!items.length) throw new ToolError("Нечего добавить: items пустой");
    const before = fromRows(await loadTasks(me, b.id));
    const { list: after, created } = addItems(before, parent, items, a.top === true, randomUUID);
    await save(me, b.id, before, after);
    return {
      board: { id: b.id, title: b.title },
      created: created.map((t) => ({ id: t.id, kind: kindOf(depth(after, t)), title: t.title, parent: t.parent })),
    };
  },
};

const updateTasks: Tool = {
  name: "update_tasks",
  title: "Изменить задачи",
  description: `Поменять у узлов холста название, статус, срок, ответственного, место (перенести внутрь другого узла того же холста) или поднять выше среди соседей. ${STRUCTURE} Меняй то, о чём просит пользователь.`,
  inputSchema: {
    type: "object",
    properties: {
      changes: {
        type: "array",
        description: `До ${MAX_EDIT} правок. Поля, которых нет, не меняются.`,
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "id узла из get_tasks." },
            title: { type: "string" },
            status: { type: "string", enum: ["todo", "doing", "done"], description: "Только у задач." },
            due: { type: ["string", "null"], description: "Срок YYYY-MM-DD; null — убрать срок. Только у задач." },
            assignee: { type: ["string", "null"], description: "Имя, код баера или почта; null — убрать. Только на общем холсте." },
            move_to: { type: "string", description: "id нового родителя: направление — в карту, задача — в направление или задачу." },
            top: { type: "boolean", description: "Поставить первым среди соседей (самым важным)." },
          },
          required: ["id"],
        },
      },
    },
    required: ["changes"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: "Изменить задачи" },
  async run({ me }, a) {
    const raw = (Array.isArray(a.changes) ? a.changes : []) as Record<string, unknown>[];
    if (!raw.length) throw new ToolError("Нужен список changes");
    if (raw.length > MAX_EDIT) throw new ToolError(`За раз — не больше ${MAX_EDIT} правок`);
    const groups = await byBoard(me, [...new Set(raw.map((c) => str(c.id)))]);
    const [list, people] = await Promise.all([boards(me), team()]);
    let changed = 0;
    for (const [boardId, ids] of groups) {
      const b = list.find((x) => x.id === boardId)!, who = assigneeOn(b, people);
      const cs: Change[] = raw.filter((c) => ids.includes(str(c.id))).map((c) => {
        if ("title" in c && !str(c.title)) throw new ToolError("Пустое название — нельзя");
        return {
          id: str(c.id), title: "title" in c ? str(c.title) : undefined, status: status(c.status), due: due(c.due),
          assignee: who(c.assignee), moveTo: str(c.move_to) || undefined, top: c.top === true,
        };
      });
      const before = fromRows(await loadTasks(me, b.id));
      await save(me, b.id, before, applyChanges(before, cs));
      changed += cs.length;
    }
    return { changed };
  },
};

const deleteTasks: Tool = {
  name: "delete_tasks",
  title: "Удалить задачи",
  description: "Удалить узлы холста вместе со всем, что внутри (карту — со всеми направлениями и задачами). Вернуть нельзя. Перед вызовом назови пользователю, что удалится, и дождись согласия.",
  inputSchema: {
    type: "object",
    properties: { ids: { type: "array", items: { type: "string" }, description: `id из get_tasks, до ${MAX_EDIT}.` } },
    required: ["ids"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false, title: "Удалить задачи" },
  async run({ me }, a) {
    const ids = [...new Set(arr(a.ids))];
    if (!ids.length) throw new ToolError("Нужны ids");
    if (ids.length > MAX_EDIT) throw new ToolError(`За раз — не больше ${MAX_EDIT}`);
    let deleted = 0;
    for (const [boardId, mine] of await byBoard(me, ids)) {
      const before = fromRows(await loadTasks(me, boardId));
      const after = mine.reduce((l, id) => removeBranch(l, id), before);
      await save(me, boardId, before, after);
      deleted += before.length - after.length;
    }
    return { deleted };
  },
};

const createBoardTool: Tool = {
  name: "create_board",
  title: "Новый холст",
  description: "Создать общий холст задач. Видят его создатель и добавленные люди; без людей — только создатель. Карты и задачи на нём — следом через add_tasks с board = id.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Название, до 80 знаков." },
      members: { type: "array", items: { type: "string" }, description: "Кого добавить: имя, код баера (b2) или почта." },
    },
    required: ["title"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, title: "Новый холст" },
  async run({ me }, a) {
    const title = str(a.title);
    if (!title) throw new ToolError("Назови холст");
    const people = await team(), active = people.filter((p) => p.active);
    const members = arr(a.members).map((v) => findPerson(active, v).id).filter((id) => id !== me.id);
    const id = await createBoard(me, title, members);
    return { id, title: title.slice(0, 80), members: members.map(namer(people)) };
  },
};

const updateBoardTool: Tool = {
  name: "update_board",
  title: "Изменить холст",
  description: "Переименовать общий холст, добавить или убрать людей. Может только тот, кто холст создал. Личный холст не меняется.",
  inputSchema: {
    type: "object",
    properties: {
      board: { type: "string", description: "id или название холста." },
      title: { type: "string", description: "Новое название." },
      add_members: { type: "array", items: { type: "string" }, description: "Кого добавить: имя, код баера или почта." },
      remove_members: { type: "array", items: { type: "string" }, description: "Кого убрать." },
    },
    required: ["board"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: "Изменить холст" },
  async run({ me }, a) {
    const [list, people] = await Promise.all([boards(me), team()]);
    const b = boardOf(list, str(a.board));
    if (!b.shared) throw new ToolError("Личный холст не переименовывается и людей в нём нет — для общего дела создай холст: create_board");
    if (!b.mine) throw new ToolError("Менять холст может только тот, кто его создал");
    const active = people.filter((p) => p.active), inBoard = people.filter((p) => b.members.includes(p.id));
    const drop = new Set(arr(a.remove_members).map((v) => findPerson(inBoard, v).id));
    const members = [...new Set([...b.members, ...arr(a.add_members).map((v) => findPerson(active, v).id)])].filter((id) => !drop.has(id) && id !== me.id);
    await updateBoard(me, b.id, str(a.title) || b.title, members);
    return { id: b.id, title: (str(a.title) || b.title).slice(0, 80), members: members.map(namer(people)) };
  },
};

export const TASK_TOOLS: Tool[] = [getTasks, addTasks, updateTasks, deleteTasks, createBoardTool, updateBoardTool];
