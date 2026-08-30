import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { verifySheet } from "@/lib/connections/verify";

// Проверка таблицы перед сохранением. Владелец подключает баерам таблицы General 3.0
// и должен узнать о непошаренной таблице сразу, а не через неделю пустого отчёта.
export async function POST(req: Request) {
  const me = await getProfile();
  if (!me || me.role !== "main") {
    return NextResponse.json({ error: "Только владелец" }, { status: 403 });
  }

  const { spreadsheetId } = (await req.json()) as { spreadsheetId?: string };
  if (!spreadsheetId?.trim()) return NextResponse.json({ error: "Пустой ключ таблицы" }, { status: 400 });

  const problem = await verifySheet(spreadsheetId.trim());
  return problem
    ? NextResponse.json({ error: problem }, { status: 400 })
    : NextResponse.json({ ok: true });
}
