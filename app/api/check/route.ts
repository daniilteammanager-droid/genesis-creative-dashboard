import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { loadCheck, type CheckGroup } from "@/lib/warehouse/check";
import { mskDay } from "@/lib/day";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const GROUPS: CheckGroup[] = ["campaign", "creative", "country"];

export const maxDuration = 300;

export async function GET(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });

  const p = new URL(req.url).searchParams;
  const today = mskDay();
  const since = DAY_RE.test(p.get("since") ?? "") ? (p.get("since") as string) : today;
  const until = DAY_RE.test(p.get("until") ?? "") ? (p.get("until") as string) : today;
  if (since > until) return NextResponse.json({ error: "Начало периода позже конца" }, { status: 400 });

  const groupBy = (GROUPS as string[]).includes(p.get("group") ?? "") ? (p.get("group") as CheckGroup) : "campaign";

  try {
    return NextResponse.json(await loadCheck(me, since, until, groupBy, p.get("buyer") ?? undefined));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Ошибка";
    console.error("Check API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
