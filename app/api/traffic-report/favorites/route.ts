import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { listFavorites, setFavorite } from "@/lib/traffic-report/favorites";

// Избранные крео «Отчётов» — личный список. GET — мои, POST { buyer, creo, on } — отметить или снять.

export async function GET() {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  try {
    return NextResponse.json({ favorites: await listFavorites(me) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { buyer?: unknown; creo?: unknown; on?: unknown } | null;
  try {
    await setFavorite(me, String(body?.buyer ?? ""), String(body?.creo ?? ""), body?.on === true);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка" }, { status: 400 });
  }
}
