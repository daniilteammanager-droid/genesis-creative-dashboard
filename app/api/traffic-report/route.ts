import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { loadTrafficReport } from "@/lib/traffic-report/load";

// Отчёт по трафику (Decision 098). Баеру — свои подключения, владельцу и тимлиду —
// вся команда или один баер (?buyer=).
export const maxDuration = 120;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const since = q.get("since") ?? "", until = q.get("until") ?? "";
  if (!DAY.test(since) || !DAY.test(until) || since > until) return NextResponse.json({ error: "Неверный период" }, { status: 400 });
  try {
    return NextResponse.json(await loadTrafficReport(me, since, until, q.get("buyer") ?? undefined));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка" }, { status: 500 });
  }
}
