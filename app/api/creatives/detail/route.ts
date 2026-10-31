import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { loadCreativeDetail } from "@/lib/warehouse/creativeDetail";
import { mskDay } from "@/lib/day";

// Модалка крео: все цифры крео за период и по неделям. ?code=имя объявления
// &since=ГГГГ-ММ-ДД (нет — всё время) &until=ГГГГ-ММ-ДД (нет — сегодня по Москве).
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });

  const p = new URL(req.url).searchParams;
  const code = (p.get("code") ?? "").trim();
  if (!code) return NextResponse.json({ error: "Нет кода крео" }, { status: 400 });
  const since = DAY_RE.test(p.get("since") ?? "") ? (p.get("since") as string) : null;
  const until = DAY_RE.test(p.get("until") ?? "") ? (p.get("until") as string) : mskDay();
  if (since && since > until) return NextResponse.json({ error: "Начало диапазона позже конца" }, { status: 400 });

  try {
    return NextResponse.json(await loadCreativeDetail(me, code, since, until));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Ошибка";
    console.error("Creative detail API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
