import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { loadReportTree } from "@/lib/warehouse/reportTree";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_DAYS = 14;

export async function GET(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });

  const p = new URL(req.url).searchParams;
  const today = new Date();
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - (DEFAULT_DAYS - 1));

  const since = DAY_RE.test(p.get("since") ?? "") ? (p.get("since") as string) : from.toISOString().slice(0, 10);
  const until = DAY_RE.test(p.get("until") ?? "") ? (p.get("until") as string) : today.toISOString().slice(0, 10);
  if (since > until) return NextResponse.json({ error: "Начало диапазона позже конца" }, { status: 400 });

  try {
    return NextResponse.json(await loadReportTree(me, since, until, p.get("buyer") ?? undefined));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Ошибка";
    console.error("Report tree error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
