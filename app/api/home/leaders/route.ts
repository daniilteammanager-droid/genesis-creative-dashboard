import { NextResponse } from "next/server";
import { getSeat } from "@/lib/auth/server";
import { loadLeaders } from "@/lib/home/leaders";

// Главная, рейтинг баеров: таблицы General 4.0 всех баеров (снимки, Decision 084). Сборка — loadLeaders,
// общая с AI-доступом (get_leaderboard). Суммы баеру не уходят вовсе (forViewer).
export const maxDuration = 120;

export async function GET() {
  const me = await getSeat();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  try {
    return NextResponse.json(await loadLeaders(me));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка" }, { status: 500 });
  }
}
