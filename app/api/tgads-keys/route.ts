import { NextResponse } from "next/server";
import { getSeat } from "@/lib/auth/server";
import { juniorDid } from "@/lib/telegram/links";
import { addTgadsKey, deleteTgadsKey, listTgadsKeys } from "@/lib/connections/tgadsKeys";
import { ingestSoon } from "@/lib/warehouse/kick";

// Свои ключи Telegram Ads (Decision 068). user_id из сессии: чужой ключ не
// увидеть и не удалить. Параллельно источнику Facebook (Decision 069).

// Загрузка после подключения идёт следом за ответом (ingestSoon) — ей нужно время.
export const maxDuration = 300;

const fail = (e: unknown, status = 400) =>
  NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

export async function GET() {
  const me = await getSeat();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  try {
    return NextResponse.json({ keys: await listTgadsKeys(me.id) });
  } catch (e) {
    return fail(e, 500);
  }
}

export async function POST(req: Request) {
  const me = await getSeat();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  try {
    const { name, token } = (await req.json()) as { name?: string; token?: string };
    await addTgadsKey(me.id, name ?? "", token ?? "");
    ingestSoon(me.id);
    await juniorDid(me, `добавил кабинет Telegram Ads «${(name ?? "").trim() || "без названия"}»`);
    return NextResponse.json({ keys: await listTgadsKeys(me.id) });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request) {
  const me = await getSeat();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("Нет id ключа");
  try {
    await deleteTgadsKey(me.id, id);
    await juniorDid(me, "удалил кабинет Telegram Ads");
    return NextResponse.json({ keys: await listTgadsKeys(me.id) });
  } catch (e) {
    return fail(e, 500);
  }
}
