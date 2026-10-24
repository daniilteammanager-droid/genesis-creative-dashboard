import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { getConnection, setDolphinToken } from "@/lib/connections/store";
import { listMetaKeys } from "@/lib/connections/metaKeys";
import { verifyDolphin } from "@/lib/dolphin/api";
import { ingestSoon } from "@/lib/warehouse/kick";

// Загрузка после подключения идёт следом за ответом (ingestSoon) — ей нужно время.
export const maxDuration = 300;

// Dolphin Cloud источником расхода (Decision 063). user_id из сессии.
// Источник у человека один (Decision 061): пока есть ключи Meta — отказ.

const fail = (e: unknown, status = 400) =>
  NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  try {
    const { token } = (await req.json()) as { token?: string };
    if (!token?.trim()) return fail("Вставь ключ API Dolphin");
    if ((await listMetaKeys(me.id)).length > 0) {
      return fail("Подключён источник Meta. Чтобы перейти на Dolphin, сначала удали ключи Meta");
    }
    if ((await getConnection(me.id))?.spendSource === "fbtool") return fail("Подключён FB Tool. Чтобы перейти на Dolphin, сначала отключи его");
    const checked = await verifyDolphin(token.trim());
    if (typeof checked === "string") return fail(checked);
    await setDolphinToken(me.id, token);
    ingestSoon(me.id);
    return NextResponse.json({ ok: true, account: checked.name });
  } catch (e) {
    return fail(e, 500);
  }
}

// Отключить. История в складе остаётся: отключение забирает доступ, а не данные.
export async function DELETE() {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  try {
    await setDolphinToken(me.id, null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e, 500);
  }
}
