import { warehouse } from "@/lib/warehouse/read";
import type { Profile } from "@/lib/auth/types";
import { escapeHtml, notify } from "@/lib/telegram/links";
import { dashboardUrl } from "@/lib/alerts/autocheck";
import { mskDay, mskTime } from "@/lib/day";
import { dayLabel } from "@/lib/calendar";
import { cleanPatch, cleanRow, isId, type Patch, type Row } from "./tree";

// Холсты задач в Supabase (050_tasks.sql). Личный холст — один у каждого, видит только хозяин,
// даже владелец дашборда чужой не видит. Общий — хозяин и добавленные им люди.
// Кто что видит, решается здесь: таблицы закрыты от браузера, роуты ходят сервисным ключом.

export interface Board { id: string; title: string; shared: boolean; owner: string; members: string[]; mine: boolean }
export interface Person { id: string; name: string }

const MAX_TASKS = 3000;

const nameOf = (p: { name: string | null; buyer_code: string | null; email: string }) =>
  p.name?.trim() || p.buyer_code || p.email.split("@")[0];

// Активные люди команды — кого можно добавить в общий холст. Без почты: имя или код баера.
export async function people(): Promise<Person[]> {
  const { data, error } = await warehouse().from("profiles").select("id, name, buyer_code, email").eq("status", "active");
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({ id: p.id as string, name: nameOf(p) })).sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

// Мои холсты: личный (заводится при первом входе) и общие, где я хозяин или участник.
export async function boards(me: Profile): Promise<Board[]> {
  const db = warehouse();
  // Личный холст один: его держит частичный уникальный индекс, поэтому две вкладки разом не заведут второй.
  const { count } = await db.from("task_boards").select("id", { count: "exact", head: true }).eq("owner_id", me.id).eq("shared", false);
  if (!count) {
    const { error } = await db.from("task_boards").insert({ owner_id: me.id, title: "Мой холст", shared: false });
    if (error && !/duplicate/i.test(error.message)) throw new Error(error.message);
  }
  const { data: mem, error: e2 } = await db.from("task_board_members").select("board_id").eq("user_id", me.id);
  if (e2) throw new Error(e2.message);
  const ids = (mem ?? []).map((m) => m.board_id as string);
  const { data, error } = await db.from("task_boards").select("id, title, shared, owner_id, created_at")
    .or(ids.length ? `owner_id.eq.${me.id},id.in.(${ids.join(",")})` : `owner_id.eq.${me.id}`)
    .order("created_at");
  if (error) throw new Error(error.message);
  const list = data ?? [];
  const shared = list.filter((b) => b.shared).map((b) => b.id as string);
  const { data: all, error: e3 } = shared.length
    ? await db.from("task_board_members").select("board_id, user_id").in("board_id", shared)
    : { data: [], error: null };
  if (e3) throw new Error(e3.message);
  return list
    .map((b) => ({
      id: b.id as string, title: b.title as string, shared: b.shared as boolean, owner: b.owner_id as string,
      members: (all ?? []).filter((m) => m.board_id === b.id).map((m) => m.user_id as string),
      mine: b.owner_id === me.id,
    }))
    .sort((a, b) => Number(a.shared) - Number(b.shared)); // личный — первым
}

// Холст, если он мне виден; иначе ошибка. Чужой личный не виден никому.
async function access(me: Profile, id: string) {
  if (!isId(id)) throw new Error("Неверный холст");
  const db = warehouse();
  const { data: b, error } = await db.from("task_boards").select("id, owner_id, shared, title").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (b && b.owner_id === me.id) return b;
  if (b?.shared) {
    const { count } = await db.from("task_board_members").select("user_id", { count: "exact", head: true }).eq("board_id", id).eq("user_id", me.id);
    if (count) return b;
  }
  throw new Error("Холст не найден");
}

export async function loadTasks(me: Profile, board: string): Promise<Row[]> {
  await access(me, board);
  const { data, error } = await warehouse().from("tasks")
    .select("id, parent_id, title, sort, status, color, due, x, y, dx, dy, assignee").eq("board_id", board)
    .order("sort").order("id").limit(MAX_TASKS);
  if (error) throw new Error(error.message);
  return (data ?? []).map(({ parent_id, ...r }) => ({ ...r, parent: parent_id }) as Row);
}

// Новые строки целиком, правки по полям и удалённые id одного холста. Чужую задачу (с другого
// холста) не перепишет: id, занятый на другом холсте, — ошибка. Родитель — только с этого же холста,
// ответственный — только хозяин или участник общего холста (на личном его нет).
export async function saveTasks(me: Profile, board: string, rawInsert: unknown, rawPatch: unknown, rawRemove: unknown) {
  const b = await access(me, board);
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  const insert = list(rawInsert).map(cleanRow);
  const patch = list(rawPatch).map(cleanPatch);
  const remove = list(rawRemove).filter(isId);
  if (insert.length + patch.length + remove.length > MAX_TASKS) throw new Error("Слишком много изменений за раз");
  const db = warehouse();
  const { data: have, error } = await db.from("tasks").select("id, assignee").eq("board_id", board).limit(MAX_TASKS + 1);
  if (error) throw new Error(error.message);
  const was = new Map((have ?? []).map((r) => [r.id as string, r.assignee as string | null]));
  const ids = new Set(was.keys());
  const fresh = insert.filter((r) => !ids.has(r.id));
  if (fresh.length) {
    const { data: taken, error: e } = await db.from("tasks").select("id").in("id", fresh.map((r) => r.id));
    if (e) throw new Error(e.message);
    if (taken?.length) throw new Error("Задача с другого холста");
  }
  if (ids.size + fresh.length - remove.length > MAX_TASKS) throw new Error(`На холсте не больше ${MAX_TASKS} задач`);
  for (const r of insert) ids.add(r.id);
  for (const id of remove) ids.delete(id);
  const all: Patch[] = [...insert, ...patch];
  if (all.some((r) => r.parent && !ids.has(r.parent))) throw new Error("Родитель задачи не на этом холсте");
  const assigned = all.filter((r) => r.assignee);
  if (assigned.length) {
    const can = new Set([b.owner_id as string]);
    if (b.shared) {
      const { data: m } = await db.from("task_board_members").select("user_id").eq("board_id", board);
      for (const x of m ?? []) can.add(x.user_id as string);
    }
    if (assigned.some((r) => !b.shared || !can.has(r.assignee!))) throw new Error("Ответственный — только участник общего холста");
  }
  const now = new Date().toISOString();
  if (insert.length) {
    const { error: e } = await db.from("tasks").upsert(insert.map(({ parent, ...r }) => ({ ...r, parent_id: parent, board_id: board, updated_at: now })));
    if (e) throw new Error(e.message);
  }
  if (patch.length) {
    const { error: e } = await db.rpc("apply_task_patches", { p_board: board, p_rows: patch });
    if (e) throw new Error(e.message);
  }
  if (remove.length) {
    const { error: e } = await db.from("tasks").delete().eq("board_id", board).in("id", remove);
    if (e) throw new Error(e.message);
  }
  // Поручили задачу другому — ему в Telegram. Сбой Telegram правку не отменяет.
  const handed = assigned.filter((r) => r.assignee !== me.id && was.get(r.id) !== r.assignee && !remove.includes(r.id));
  if (handed.length) await tellAssigned(me, board, b.title as string, handed).catch(() => {});
}

async function tellAssigned(me: Profile, board: string, boardTitle: string, rows: Patch[]) {
  const { data } = await warehouse().from("tasks").select("id, title, due").in("id", rows.map((r) => r.id));
  const by = new Map((data ?? []).map((t) => [t.id as string, t]));
  const button = openTasksButton(board);
  for (const r of rows) {
    const t = by.get(r.id);
    const due = t?.due ? `\nСрок: ${dayLabel(t.due as string)}` : "";
    await notify(r.assignee!, "tasks",
      `📌 Тебе новая задача от <b>${escapeHtml(me.name || me.email)}</b>\n«${escapeHtml((t?.title as string) || "Без названия")}»${due}\nХолст: ${escapeHtml(boardTitle)}`,
      button);
  }
}

function openTasksButton(board?: string): Record<string, unknown> {
  const base = dashboardUrl();
  return base ? { reply_markup: { inline_keyboard: [[{ text: "Открыть задачи", url: `${base}/tasks${board ? `?board=${board}` : ""}` }]] } } : {};
}

// Напоминание о сроках: раз в день, с 10:00 МСК (крон kind=ai, раз в час). Каждому — его задачи
// со сроком сегодня и просроченные: личный холст — хозяину, общий — ответственному, а без него — хозяину.
export async function runTaskReminders(now = new Date()) {
  const today = mskDay(now);
  if (mskTime(now) < "10:00") return { sent: 0, skipped: "раньше 10:00" };
  const db = warehouse();
  const { data, error } = await db.from("tasks")
    .select("title, due, assignee, task_boards!inner(owner_id, title)")
    .lte("due", today).in("status", ["todo", "doing"]).order("due").limit(5000);
  if (error) throw new Error(error.message);
  const byUser = new Map<string, { title: string; due: string; board: string }[]>();
  for (const t of data ?? []) {
    const b = t.task_boards as unknown as { owner_id: string; title: string };
    const who = (t.assignee as string | null) ?? b.owner_id;
    byUser.set(who, [...(byUser.get(who) ?? []), { title: t.title as string, due: t.due as string, board: b.title }]);
  }
  if (!byUser.size) return { sent: 0 };
  const { data: done } = await db.from("task_reminders").select("user_id").eq("day", today).in("user_id", [...byUser.keys()]);
  const skip = new Set((done ?? []).map((d) => d.user_id as string));
  let sent = 0;
  for (const [user, items] of byUser) {
    if (skip.has(user)) continue;
    // Сначала отметка: упади Telegram на середине — второй раз за день не придёт.
    const { error: e } = await db.from("task_reminders").insert({ user_id: user, day: today });
    if (e) continue; // уже отметил параллельный прогон
    sent += await notify(user, "tasks", reminderText(items, today), openTasksButton()).catch(() => 0);
  }
  return { sent, users: byUser.size };
}

export function reminderText(items: { title: string; due: string; board: string }[], today: string): string {
  const line = (t: { title: string; due: string; board: string }, late: boolean) =>
    `• ${escapeHtml(t.title || "Без названия")}${late ? ` — до ${dayLabel(t.due)}` : ""} <i>(${escapeHtml(t.board)})</i>`;
  const now = items.filter((t) => t.due === today), late = items.filter((t) => t.due < today);
  return [
    now.length ? `🗓 <b>Срок сегодня</b>\n${now.map((t) => line(t, false)).join("\n")}` : "",
    late.length ? `⏰ <b>Просрочено</b>\n${late.map((t) => line(t, true)).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

// Участники — только активные люди команды и не сам хозяин (он видит холст и так).
async function cleanMembers(me: Profile, raw: unknown): Promise<string[]> {
  const want = new Set((Array.isArray(raw) ? raw : []).filter(isId));
  want.delete(me.id);
  if (!want.size) return [];
  const ok = new Set((await people()).map((p) => p.id));
  return [...want].filter((id) => ok.has(id));
}
const cleanTitle = (raw: unknown) => {
  const t = String(raw ?? "").trim().slice(0, 80);
  if (!t) throw new Error("Назови холст");
  return t;
};

export async function createBoard(me: Profile, title: unknown, members: unknown): Promise<string> {
  const db = warehouse();
  const { data, error } = await db.from("task_boards").insert({ owner_id: me.id, title: cleanTitle(title), shared: true }).select("id").single();
  if (error) throw new Error(error.message);
  const list = await cleanMembers(me, members);
  if (list.length) {
    const { error: e } = await db.from("task_board_members").insert(list.map((user_id) => ({ board_id: data.id, user_id })));
    if (e) throw new Error(e.message);
  }
  return data.id as string;
}

// Название и участников меняет только хозяин общего холста.
async function ownShared(me: Profile, id: string) {
  const b = await access(me, id);
  if (!b.shared || b.owner_id !== me.id) throw new Error("Менять холст может только тот, кто его создал");
}

export async function updateBoard(me: Profile, id: string, title: unknown, members: unknown) {
  await ownShared(me, id);
  const db = warehouse();
  const { error } = await db.from("task_boards").update({ title: cleanTitle(title) }).eq("id", id);
  if (error) throw new Error(error.message);
  const list = await cleanMembers(me, members);
  const { error: e1 } = await db.from("task_board_members").delete().eq("board_id", id);
  if (e1) throw new Error(e1.message);
  if (list.length) {
    const { error: e2 } = await db.from("task_board_members").insert(list.map((user_id) => ({ board_id: id, user_id })));
    if (e2) throw new Error(e2.message);
  }
}

export async function deleteBoard(me: Profile, id: string) {
  await ownShared(me, id);
  const { error } = await warehouse().from("task_boards").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function leaveBoard(me: Profile, id: string) {
  const b = await access(me, id);
  if (b.owner_id === me.id) throw new Error("Свой холст можно удалить, а не покинуть");
  const { error } = await warehouse().from("task_board_members").delete().eq("board_id", id).eq("user_id", me.id);
  if (error) throw new Error(error.message);
}
