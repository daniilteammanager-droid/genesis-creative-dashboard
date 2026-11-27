import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { deleteTemplate, saveTemplate } from "@/lib/topups/settings";
import type { Template } from "@/lib/topups/config";

// Личные шаблоны частых заявок (Decision 131): { op: "save", template } или { op: "delete", id } → { templates }.
// user_id — из сессии: чужой шаблон не увидеть и не удалить. Читаются вместе с заявками (GET /api/topups).
export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  try {
    const body = (await req.json()) as { op?: string; id?: string; template?: Partial<Template> };
    if (body.op === "save") return NextResponse.json({ templates: await saveTemplate(me.id, body.template ?? {}) });
    if (body.op === "delete") return NextResponse.json({ templates: await deleteTemplate(me.id, String(body.id ?? "")) });
    return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
