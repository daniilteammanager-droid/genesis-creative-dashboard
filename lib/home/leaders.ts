import { warehouse } from "@/lib/warehouse/read";
import { snapshot } from "@/lib/general-report-4/store";
import { forViewer, rankBuyers, type Board, type BuyerInput } from "./leaderboard";
import { mskDay, mskDaysAgo } from "@/lib/day";
import type { Profile } from "@/lib/auth/types";

// Рейтинг баеров — Главная и AI-доступ (get_leaderboard): таблицы General 4.0 всех баеров (снимки, Decision 084).
// Сервисным ключом: баеру политика profiles чужих не покажет, а рейтинг — по всей команде. Суммы баеру не уходят
// вовсе (forViewer). me — место человека (getSeat / seatOf): у джуна — его баер.
export async function loadLeaders(me: Profile): Promise<{ month: Board; quarter: Board; allTime: Board; failed: string[] }> {
  const { data: profiles, error } = await warehouse().from("profiles")
    .select("id, name, email, buyer_code, status, gr4_spreadsheet_id")
    .eq("role", "buyer").not("gr4_spreadsheet_id", "is", null);
  if (error) throw new Error(error.message);

  const failed: string[] = [];
  const buyers = (await Promise.all((profiles ?? []).map(async (p): Promise<BuyerInput | null> => {
    const label = (p.name as string) || (p.buyer_code as string) || (p.email as string);
    // Сломанная таблица одного баера не роняет рейтинг — он просто без него.
    const snap = await snapshot(p.gr4_spreadsheet_id as string, "buyer").catch(() => null);
    if (!snap) { failed.push(label); return null; }
    return { id: p.id as string, label, gone: p.status === "disabled", rows: snap.rows.map((r) => ({ date: r.date, budget: r.budget, revenue: r.revenue })) };
  }))).filter((b): b is BuyerInput => b !== null);

  const today = mskDay();
  const withMoney = me.role !== "buyer";
  return {
    month: forViewer(rankBuyers(buyers, mskDaysAgo(29), today, 1), me.id, withMoney),
    quarter: forViewer(rankBuyers(buyers, mskDaysAgo(89), today, 3), me.id, withMoney),
    allTime: forViewer(rankBuyers(buyers, null, today, null), me.id, withMoney),
    failed,
  };
}
