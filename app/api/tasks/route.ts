import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { boards, loadTasks, people, saveTasks } from "@/lib/tasks/store";

// Задачи. GET — мои холсты и люди команды; GET ?board=id — задачи холста.
// POST { board, insert, patch, remove } — новые задачи целиком, правки по полям и удалённые id. Доступ — в lib/tasks/store.ts.

const fail = (e: unknown, status: number) => NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка" }, { status });

export async function GET(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const board = new URL(req.url).searchParams.get("board");
  try {
    if (board) return NextResponse.json({ tasks: await loadTasks(me, board) });
    const [b, p] = await Promise.all([boards(me), people()]);
    return NextResponse.json({ boards: b, people: p });
  } catch (e) {
    return fail(e, board ? 404 : 500);
  }
}

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { board?: unknown; insert?: unknown; patch?: unknown; remove?: unknown } | null;
  try {
    await saveTasks(me, String(body?.board ?? ""), body?.insert, body?.patch, body?.remove);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e, 400);
  }
}
