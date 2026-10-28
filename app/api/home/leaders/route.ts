import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getProfile } from "@/lib/auth/server";
import { snapshot } from "@/lib/general-report-4/store";
import { forViewer, rankBuyers, type BuyerInput } from "@/lib/home/leaderboard";
import { mskDay, mskDaysAgo } from "@/lib/day";

// Главная, рейтинг баеров: таблицы General 4.0 всех баеров (снимки, Decision 084).
// Сервисным ключом: баеру политика profiles чужих не покажет, а рейтинг — по всей
// команде. Суммы баеру не уходят вовсе (forViewer).
export const maxDuration = 120;

export async function GET() {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const { data: profiles, error } = await db.from("profiles")
      .select("id, name, email, buyer_code, gr4_spreadsheet_id")
      .eq("role", "buyer").not("gr4_spreadsheet_id", "is", null);
    if (error) throw new Error(error.message);

    const failed: string[] = [];
    const buyers = (await Promise.all((profiles ?? []).map(async (p): Promise<BuyerInput | null> => {
      const label = (p.name as string) || (p.buyer_code as string) || (p.email as string);
      // Сломанная таблица одного баера не роняет рейтинг — он просто без него.
      const snap = await snapshot(p.gr4_spreadsheet_id as string, "buyer").catch(() => null);
      if (!snap) { failed.push(label); return null; }
      return { id: p.id as string, label, rows: snap.rows.map((r) => ({ date: r.date, budget: r.budget, revenue: r.revenue })) };
    }))).filter((b): b is BuyerInput => b !== null);

    const today = mskDay();
    const withMoney = me.role !== "buyer";
    return NextResponse.json({
      quarter: forViewer(rankBuyers(buyers, mskDaysAgo(89), today, 3), me.id, withMoney),
      allTime: forViewer(rankBuyers(buyers, null, today, null), me.id, withMoney),
      failed,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка" }, { status: 500 });
  }
}
