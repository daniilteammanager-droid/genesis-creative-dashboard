import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { listAccounts, listMyAccounts } from "@/lib/warehouse/accounts";
import { mskDay, mskDaysAgo } from "@/lib/day";

// Кабинеты и чьи они — только чтение. Закрепляет загрузка сама: кабинет
// принадлежит тому, чей ключ его видит (Decision 061).

export const maxDuration = 120;

const fail = (e: unknown, status = 400) =>
  NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка" }, { status });

export async function GET(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });

  try {
    if (me.role === "buyer") return NextResponse.json({ accounts: await listMyAccounts(me.id) });

    const p = new URL(req.url).searchParams;
    const days = Math.min(Math.max(parseInt(p.get("days") ?? "30", 10) || 30, 1), 90);
    return NextResponse.json({ ...(await listAccounts(me, mskDaysAgo(days - 1), mskDay())), days });
  } catch (e) {
    console.error("Accounts API error:", e);
    return fail(e, 500);
  }
}
