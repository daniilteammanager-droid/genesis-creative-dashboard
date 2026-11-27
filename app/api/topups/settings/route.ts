import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { saveCategories } from "@/lib/topups/settings";
import type { Category } from "@/lib/topups/config";

// Настройки «Пополнений» (Decision 131): категории, «куда», закреплённые кошельки. Меняет только владелец —
// вкладку остальным не показываем, но защита здесь, а не в интерфейсе. Читаются настройки вместе с заявками (GET /api/topups).
export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  if (me.role !== "main") return NextResponse.json({ error: "Настройки пополнений меняет владелец" }, { status: 403 });
  try {
    const body = (await req.json()) as { categories?: Category[] };
    return NextResponse.json({ categories: await saveCategories(body.categories ?? [], me.name || me.email) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
