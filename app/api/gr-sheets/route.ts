import { NextResponse } from "next/server";
import { getProfile, createClient } from "@/lib/auth/server";
import { verifySheet } from "@/lib/connections/verify";

// Общие таблицы General Report 3.0. Заводит только владелец: таблицы его и
// доступ к ним он же выдаёт сервисному аккаунту.

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me || me.role !== "main") return NextResponse.json({ error: "Только владелец" }, { status: 403 });

  const body = (await req.json()) as { name?: string; spreadsheetId?: string; kind?: string };
  const name = body.name?.trim();
  const spreadsheetId = body.spreadsheetId?.trim();
  const kind = body.kind === "wa" ? "wa" : "country";

  if (!name) return NextResponse.json({ error: "Нужно имя таблицы" }, { status: 400 });
  if (!spreadsheetId) return NextResponse.json({ error: "Нужен ключ таблицы" }, { status: 400 });

  // Проверяем до записи: непошаренная таблица сохранится молча и обернётся
  // пустым источником, который выглядит как «данных нет».
  const problem = await verifySheet(spreadsheetId);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase.from("gr_spreadsheets").insert({ name, spreadsheet_id: spreadsheetId, kind });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const me = await getProfile();
  if (!me || me.role !== "main") return NextResponse.json({ error: "Только владелец" }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Не указана таблица" }, { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase.from("gr_spreadsheets").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
