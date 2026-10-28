import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { loadHomeMetrics } from "@/lib/home/summary";
import { PERIODS, type PeriodId } from "@/lib/home/periods";

// Главная, блок метрик. Баеру — свои подключения, владельцу и тимлиду — вся команда
// (то же правило, что у Live Manager: resolveScope).
export const maxDuration = 120;

export async function GET(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const raw = new URL(req.url).searchParams.get("period");
  const period = (PERIODS.find((p) => p.id === raw)?.id ?? "7d") as PeriodId;
  try {
    return NextResponse.json(await loadHomeMetrics(me, period));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка" }, { status: 500 });
  }
}
