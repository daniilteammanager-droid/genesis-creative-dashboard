import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { mskDaysAgo } from "@/lib/day";
import { aiReady } from "@/lib/ai/claude";
import { latestSummary, weeklySummary } from "@/lib/ai/summary";

// Недельная AI-сводка по баерам (Decision 101) — владельцу и тимлиду.
// GET — последняя; POST — собрать сейчас за последние 7 дней (до вчера).
export const maxDuration = 300;

export async function GET() {
  const me = await getProfile();
  if (!me || me.role === "buyer") return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  return NextResponse.json({ ready: aiReady(), summary: await latestSummary() });
}

export async function POST() {
  const me = await getProfile();
  if (!me || me.role === "buyer") return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  try {
    await weeklySummary(me, { since: mskDaysAgo(7), until: mskDaysAgo(1) });
    return NextResponse.json({ summary: await latestSummary() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка" }, { status: 400 });
  }
}
