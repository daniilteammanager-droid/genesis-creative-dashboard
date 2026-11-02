// Задачи: дерево карт на холсте. Чистые функции — без сети и React; самопроверка в tree.test.ts.
//
// Узел без родителя — карта (x, y — её место на холсте), под ней направления (color),
// под ними задачи и подзадачи (status). Порядок среди соседей — порядок в массиве:
// выше на карте и в колонке доски = важнее. dx, dy — свободный сдвиг узла от его места
// в раскладке; ветка едет вместе с ним.

export type Status = "todo" | "doing" | "done";
export type Where = "before" | "after" | "inside";

export interface Task {
  id: string;
  parent: string | null;
  title: string;
  status: Status | null;
  color: string | null;
  due: string | null;
  x: number | null; y: number | null;
  dx: number | null; dy: number | null;
  assignee: string | null; // ответственный на общем холсте
}

// Строка для базы: задача и её место среди соседей.
export type Row = Task & { sort: number };

export const COLORS = ["#8b5cf6", "#38bdf8", "#34d399", "#f472b6", "#f59e0b", "#f87171"];
export const STATUS: [Status, string][] = [["todo", "Надо"], ["doing", "В работе"], ["done", "Готово"]];
export const NEXT: Record<Status, Status> = { todo: "doing", doing: "done", done: "todo" };
// Размеры узла и раскладки на холсте, px. NH — высота в одну строку: длинный текст переносится,
// и узел выше (его высоту меряет холст и отдаёт в раскладку).
export const NW = 236, NH = 36, GAP = 10, COLW = 276;

const find = (l: Task[], id: string | null) => (id ? l.find((t) => t.id === id) : undefined);
export const byId = find;
export const kids = (l: Task[], id: string) => l.filter((t) => t.parent === id);
export const roots = (l: Task[]) => l.filter((t) => !t.parent);

export function depth(l: Task[], t: Task): number {
  let d = 0;
  for (let p = find(l, t.parent); p; p = find(l, p.parent)) d++;
  return d;
}
// Направление задачи (у карты и направления — они сами).
export function dirOf(l: Task[], t: Task): Task {
  for (let p = find(l, t.parent); p?.parent; p = find(l, p.parent)) t = p;
  return t;
}
export function mapOf(l: Task[], t: Task): Task {
  for (let p = find(l, t.parent); p; p = find(l, p.parent)) t = p;
  return t;
}
// id лежит в ветке anc (или это сам anc).
export function under(l: Task[], id: string, anc: string): boolean {
  for (let t = find(l, id); t; t = find(l, t.parent)) if (t.id === anc) return true;
  return false;
}

// Все задачи (со статусом) в ветке, без самого узла.
export const branchTasks = (l: Task[], id: string) => l.filter((t) => t.id !== id && t.status && under(l, t.id, id));
export function progress(l: Task[], id: string): string {
  const d = branchTasks(l, id);
  return d.length ? `${d.filter((t) => t.status === "done").length}/${d.length}` : "";
}

// Куда ляжет перетащенный узел, если отпустить его на target; ry — доля высоты target сверху (0..1).
// Направления двигаются только между направлениями (и между картами), задачи — рядом или внутрь.
export function zone(l: Task[], dragId: string, targetId: string, ry: number): Where | null {
  const drag = find(l, dragId), tg = find(l, targetId);
  if (!drag || !tg || under(l, targetId, dragId)) return null;
  const dd = depth(l, drag), td = depth(l, tg);
  if (dd === 0) return null;
  if (dd === 1) return td === 1 ? (ry < 0.5 ? "before" : "after") : null;
  if (td === 0) return null;
  if (td === 1) return "inside";
  return ry < 0.3 ? "before" : ry > 0.7 ? "after" : "inside";
}

// Переложить узел. Свободный сдвиг сбрасывается: на новом месте он ни к чему не привязан.
export function move(l: Task[], id: string, target: string, where: Where): Task[] {
  const src = find(l, id), tg = find(l, target);
  if (!src || !tg || id === target || under(l, target, id)) return l;
  const t: Task = { ...src, dx: null, dy: null, parent: where === "inside" ? target : tg.parent };
  const rest = l.filter((x) => x.id !== id);
  if (where === "inside") return [...rest, t];
  const i = rest.indexOf(tg) + (where === "after" ? 1 : 0);
  return [...rest.slice(0, i), t, ...rest.slice(i)];
}

// Пустой узел под parent (null — новая карта в точке at).
export function blank(l: Task[], id: string, parent: string | null, at?: { x: number; y: number }): Task {
  const p = find(l, parent), d = p ? depth(l, p) + 1 : 0;
  return {
    id, parent: p ? p.id : null, title: "",
    status: d >= 2 ? "todo" : null,
    color: d === 1 ? COLORS[kids(l, p!.id).length % COLORS.length] : null,
    due: null, x: d === 0 ? at?.x ?? 0 : null, y: d === 0 ? at?.y ?? 0 : null, dx: null, dy: null, assignee: null,
  };
}
// Вставить сразу после after (или в конец).
export function insert(l: Task[], t: Task, after?: string | null): Task[] {
  const i = after ? l.findIndex((x) => x.id === after) : -1;
  return i < 0 ? [...l, t] : [...l.slice(0, i + 1), t, ...l.slice(i + 1)];
}
export const patch = (l: Task[], id: string, ch: Partial<Task>) => l.map((t) => (t.id === id ? { ...t, ...ch } : t));
export const removeBranch = (l: Task[], id: string) => l.filter((t) => !under(l, t.id, id));

export interface Pos { x: number; cy: number; d: number; h: number }
export interface LayoutOpts { collapsed: Set<string>; hideDone: boolean; heights?: Record<string, number> }

// Раскладка: карта слева, уровни — колонками вправо, родитель по центру своих детей.
// Потом к каждому узлу добавляется свободный сдвиг его и всех предков.
export function layout(l: Task[], { collapsed, hideDone, heights }: LayoutOpts) {
  const pos: Record<string, Pos> = {}, edges: [string, string][] = [];
  const shown = (t: Task) => !(hideDone && t.status === "done");
  const children = new Map<string, Task[]>();
  for (const t of l) if (t.parent) children.set(t.parent, [...(children.get(t.parent) ?? []), t]);
  for (const r of roots(l)) {
    let y = r.y ?? 0;
    const lay = (t: Task, d: number): number => {
      const k = (children.get(t.id) ?? []).filter(shown);
      const h = heights?.[t.id] ?? NH, top = y;
      let cy: number;
      if (!k.length || collapsed.has(t.id)) { cy = y + h / 2; y += h + GAP; }
      else {
        const c = k.map((x) => lay(x, d + 1));
        // Узел выше своих детей — не залезает на соседа сверху и раздвигает соседа снизу.
        cy = Math.max((c[0] + c[c.length - 1]) / 2, top + h / 2);
        y = Math.max(y, top + h + GAP);
        for (const x of k) edges.push([t.id, x.id]);
      }
      pos[t.id] = { x: (r.x ?? 0) + d * COLW, cy, d, h };
      return cy;
    };
    lay(r, 0);
    const shift = (t: Task, ax: number, ay: number) => {
      const p = pos[t.id]; if (!p) return;
      const nx = ax + (t.parent ? t.dx ?? 0 : 0), ny = ay + (t.parent ? t.dy ?? 0 : 0);
      p.x += nx; p.cy += ny;
      for (const k of children.get(t.id) ?? []) shift(k, nx, ny);
    };
    shift(r, 0, 0);
  }
  return { pos, edges };
}

// Отпустили узел на пустом месте холста: он остаётся там, где его бросили, а среди
// соседей встаёт по высоте — выше = важнее, как и при перетаскивании на соседа.
export function placeFree(l: Task[], id: string, opts: LayoutOpts): Task[] {
  const { pos } = layout(l, opts), me = pos[id], t = find(l, id);
  if (!me || !t?.parent) return l;
  const sibs = kids(l, t.parent).filter((s) => s.id !== id && pos[s.id]);
  const next = sibs.find((s) => pos[s.id].cy > me.cy), last = sibs[sibs.length - 1];
  const bare = { ...t, dx: null, dy: null };
  const rest = l.filter((x) => x.id !== id);
  const i = next ? rest.indexOf(next) : last ? rest.indexOf(last) + 1 : rest.length;
  const out = [...rest.slice(0, i), bare, ...rest.slice(i)];
  const a = layout(out, opts).pos[id];
  return patch(out, id, { dx: Math.round(me.x - a.x), dy: Math.round(me.cy - a.cy) });
}

// Что отправить в базу. saved — последнее сохранённое, id → JSON строки. sort — место среди
// соседей, поэтому вставка двигает только соседей. Новые строки уходят целиком, изменённые —
// только изменившимися полями: двое на общем холсте не затирают друг другу разные поля.
export function rows(l: Task[]): Row[] {
  const n = new Map<string | null, number>();
  return l.map((t) => {
    const sort = n.get(t.parent) ?? 0;
    n.set(t.parent, sort + 1);
    return { ...t, sort };
  });
}
export type Patch = Partial<Row> & { id: string };
export function diff(saved: Map<string, string>, l: Task[]) {
  const rs = rows(l), ids = new Set(rs.map((r) => r.id));
  const insert: Row[] = [], patch: Patch[] = [], changed: Row[] = [];
  for (const r of rs) {
    const was = saved.get(r.id);
    if (was === JSON.stringify(r)) continue;
    changed.push(r);
    if (!was) { insert.push(r); continue; }
    const old = JSON.parse(was) as Row, p: Patch = { id: r.id };
    for (const k of Object.keys(r) as (keyof Row)[]) if (r[k] !== old[k]) (p as Record<string, unknown>)[k] = r[k];
    patch.push(p);
  }
  return { insert, patch, changed, remove: [...saved.keys()].filter((id) => !ids.has(id)) };
}
// Обратно из базы: строки в порядке массива (родители и соседи — по sort).
export function fromRows(rs: Row[]): Task[] {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return [...rs].sort((a, b) => a.sort - b.sort).map(({ sort, ...t }) => t);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? clamp(Math.round(v), -1e6, 1e6) : null);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

// Строка (или правка по полям) из браузера → то, что можно положить в базу. Мусор — ошибка,
// а не тихая правка. В правке остаются только присланные поля.
const FIELDS = ["parent", "title", "sort", "status", "color", "due", "x", "y", "dx", "dy", "assignee"] as const;
export function cleanPatch(raw: unknown): Patch {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (!isId(r.id)) throw new Error("Неверный id задачи");
  const out: Record<string, unknown> = { id: r.id };
  for (const k of FIELDS) if (k in r) out[k] = clean(k, r[k]);
  return out as Patch;
}
export function cleanRow(raw: unknown): Row {
  const r = (raw ?? {}) as Record<string, unknown>;
  return { ...Object.fromEntries(FIELDS.map((k) => [k, null])), ...cleanPatch(raw), sort: int(r.sort) ?? 0, title: String(r.title ?? "").slice(0, 300) } as Row;
}
function clean(k: (typeof FIELDS)[number], v: unknown): unknown {
  switch (k) {
    case "parent": case "assignee":
      if (v != null && !isId(v)) throw new Error(k === "parent" ? "Неверный родитель задачи" : "Неверный ответственный");
      return v ?? null;
    case "title": return String(v ?? "").slice(0, 300);
    case "status":
      if (v != null && !STATUS.some(([s]) => s === v)) throw new Error("Неверный статус");
      return v ?? null;
    case "color":
      if (v != null && !COLORS.includes(String(v))) throw new Error("Неверный цвет");
      return v ?? null;
    case "due":
      if (v == null || v === "") return null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new Error("Неверный срок");
      return String(v);
    case "sort": return int(v) ?? 0;
    default: return int(v);
  }
}
