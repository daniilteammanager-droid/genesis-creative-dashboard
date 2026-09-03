import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { listAccounts, assignAccount } from "@/lib/warehouse/accounts";
import { mskDay, mskDaysAgo } from "@/lib/day";

// Раздача рекламных кабинетов баерам. Живёт у владельца: только его аккаунт
// видит все кабинеты команды, значит только с него раздача и возможна.

export const maxDuration = 120;

export async function GET(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  if (me.role === "buyer") return NextResponse.json({ error: "Кабинеты раздаёт владелец" }, { status: 403 });

  const p = new URL(req.url).searchParams;
  const days = Math.min(Math.max(parseInt(p.get("days") ?? "30", 10) || 30, 1), 90);

  try {
    return NextResponse.json({ ...(await listAccounts(me, mskDaysAgo(days - 1), mskDay())), days });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Ошибка";
    console.error("Accounts API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  if (me.role !== "main") return NextResponse.json({ error: "Кабинеты раздаёт только владелец" }, { status: 403 });

  try {
    const { accountId, ownerUserId } = (await req.json()) as { accountId?: string; ownerUserId?: string | null };
    if (!accountId?.trim()) return NextResponse.json({ error: "Не указан кабинет" }, { status: 400 });

    await assignAccount(me, accountId.trim(), ownerUserId?.trim() || null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Ошибка";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
