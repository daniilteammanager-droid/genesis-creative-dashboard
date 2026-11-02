import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { createBoard, deleteBoard, leaveBoard, updateBoard } from "@/lib/tasks/store";

// Общие холсты. POST { action: "create", title, members } → { id };
// "update" { id, title, members } и "delete" { id } — только создатель; "leave" { id } — участник.

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { action?: unknown; id?: unknown; title?: unknown; members?: unknown } | null;
  const id = String(b?.id ?? "");
  try {
    switch (b?.action) {
      case "create": return NextResponse.json({ id: await createBoard(me, b.title, b.members) });
      case "update": await updateBoard(me, id, b.title, b.members); break;
      case "delete": await deleteBoard(me, id); break;
      case "leave": await leaveBoard(me, id); break;
      default: throw new Error("Неизвестное действие");
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка" }, { status: 400 });
  }
}
