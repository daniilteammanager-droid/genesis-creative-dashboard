import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { warehouse } from "@/lib/warehouse/read";
import { escapeHtml, notify } from "@/lib/telegram/links";

// «Отправить в чат» из Checks и история чеков (Decision 082). Текст — тот же, что
// на странице; уходит во все чаты человека с уведомлением «Чек по расписанию».
//   POST { text } · GET — последние 30 отправленных

export async function GET() {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const { data } = await warehouse().from("check_log").select("id, kind, text, sent, created_at").eq("user_id", me.id).order("created_at", { ascending: false }).limit(30);
  return NextResponse.json({ checks: data ?? [] });
}

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me || me.status !== "active") return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  if (!text?.trim()) return NextResponse.json({ error: "Пустой чек" }, { status: 400 });
  const html = escapeHtml(text.slice(0, 12000));
  const sent = await notify(me.id, "autocheck", html);
  if (!sent) return NextResponse.json({ error: "Некуда отправить: привяжи чат с уведомлением «Чек по расписанию» — Настройки → Интеграции → Telegram" }, { status: 400 });
  await warehouse().from("check_log").insert({ user_id: me.id, kind: "manual", text: html, sent });
  return NextResponse.json({ sent });
}
