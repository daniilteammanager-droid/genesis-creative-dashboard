import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { listAccounts, listMyAccounts, claimAccount, releaseAccount } from "@/lib/warehouse/accounts";
import { mskDay, mskDaysAgo } from "@/lib/day";

// Закрепление рекламных кабинетов. Баер закрепляет за собой по id — чужой
// занятый кабинет не возьмёт. Владелец видит всё и переназначает.

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

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });

  try {
    const { accountId, ownerUserId } = (await req.json()) as { accountId?: string; ownerUserId?: string | null };
    if (!accountId?.trim()) return NextResponse.json({ error: "Не указан кабинет" }, { status: 400 });

    // Пустой владелец — это «снять закрепление».
    if (ownerUserId === null || ownerUserId === "") {
      await releaseAccount(me, accountId);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json(await claimAccount(me, accountId, ownerUserId ?? me.id));
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const accountId = new URL(req.url).searchParams.get("accountId");
  if (!accountId) return NextResponse.json({ error: "Не указан кабинет" }, { status: 400 });
  try {
    await releaseAccount(me, accountId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
