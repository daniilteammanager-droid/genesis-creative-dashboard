import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { warehouse } from "@/lib/warehouse/read";
import { budgetOf, setBudget } from "@/lib/ai/creo";

// Месячные лимиты AI-разборов баеров (Decision 101). Видят владелец и тимлид, меняет владелец.
// GET — { budgets: { [buyerId]: { limit, used } } }, POST { buyer, usd }.

export async function GET() {
  const me = await getProfile();
  if (!me || me.role === "buyer") return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  const { data } = await warehouse().from("profiles").select("id").eq("role", "buyer");
  const ids = (data ?? []).map((p) => p.id as string);
  const budgets = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await budgetOf(id)] as const)));
  return NextResponse.json({ budgets });
}

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { buyer?: unknown; usd?: unknown } | null;
  try {
    await setBudget(me, String(body?.buyer ?? ""), Number(body?.usd));
    return NextResponse.json({ ok: true, budget: await budgetOf(String(body?.buyer)) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка" }, { status: 400 });
  }
}
