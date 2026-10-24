import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { addTgadsKey, deleteTgadsKey, listTgadsKeys } from "@/lib/connections/tgadsKeys";
import { getConnection } from "@/lib/connections/store";
import { ingestSoon } from "@/lib/warehouse/kick";

// Свои ключи Telegram Ads (Decision 068). user_id из сессии: чужой ключ не
// увидеть и не удалить. Источник расхода один (Decision 061): пока подключён
// другой — ключ TG Ads не добавить.

// Загрузка после подключения идёт следом за ответом (ingestSoon) — ей нужно время.
export const maxDuration = 300;

const fail = (e: unknown, status = 400) =>
  NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

export async function GET() {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  try {
    return NextResponse.json({ keys: await listTgadsKeys(me.id) });
  } catch (e) {
    return fail(e, 500);
  }
}

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  try {
    const { name, token } = (await req.json()) as { name?: string; token?: string };
    const source = (await getConnection(me.id))?.spendSource;
    if (source && source !== "tgads") return fail("Подключён другой источник расхода. Чтобы перейти на Telegram Ads, сначала удали его");
    await addTgadsKey(me.id, name ?? "", token ?? "");
    ingestSoon(me.id);
    return NextResponse.json({ keys: await listTgadsKeys(me.id) });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("Нет id ключа");
  try {
    await deleteTgadsKey(me.id, id);
    return NextResponse.json({ keys: await listTgadsKeys(me.id) });
  } catch (e) {
    return fail(e, 500);
  }
}
