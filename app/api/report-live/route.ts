import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { applyLive, liveReach, liveStates, type Action, type Item } from "@/lib/reports-live/manage";

// Live Manager (Decision 079). POST {items} — статусы и бюджеты строк;
// POST {items, action} — запуск, пауза или бюджет. POST {items, reach: {since, until}} —
// охват и частота за период живьём из Meta (Decision 089). Кто что может — решает
// lib/reports-live/manage.ts по владельцу кабинета, а не интерфейс.

export const maxDuration = 120;
const LEVELS = new Set(["campaign", "adset", "ad"]);

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me || me.status !== "active") return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { items?: Item[]; action?: Action; reach?: { since?: string; until?: string } };
  const items = (b.items ?? []).filter((i) => LEVELS.has(i?.level) && /^\d+$/.test(i?.id ?? "") && /^\d+$/.test(i?.accountId ?? "")).slice(0, 2000);
  try {
    if (b.reach) {
      const day = /^\d{4}-\d{2}-\d{2}$/;
      if (!day.test(b.reach.since ?? "") || !day.test(b.reach.until ?? "")) return NextResponse.json({ error: "Период — ГГГГ-ММ-ДД" }, { status: 400 });
      return NextResponse.json({ reach: await liveReach(me, items, b.reach.since!, b.reach.until!) });
    }
    if (!b.action) return NextResponse.json(await liveStates(me, items));
    if (items.length > 100) return NextResponse.json({ error: "За раз — не больше 100 объектов" }, { status: 400 });
    return NextResponse.json({ results: await applyLive(me, items, b.action) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
