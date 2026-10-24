import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { getConnection, setFbtoolKey } from "@/lib/connections/store";
import { listMetaKeys } from "@/lib/connections/metaKeys";
import { fbtoolAccounts } from "@/lib/fbtool/api";
import { ingestSoon } from "@/lib/warehouse/kick";

// FB Tool источником расхода Facebook (Decision 071). user_id из сессии.
// Источник Facebook у человека один (Decision 061): пока есть Meta или Dolphin — отказ.

// Загрузка после подключения идёт следом за ответом (ingestSoon) — ей нужно время.
export const maxDuration = 300;

const fail = (e: unknown, status = 400) =>
  NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

// Аккаунты FB Tool и их состояние — чтобы баер видел, какой разлогинен.
export async function GET() {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  try {
    const c = await getConnection(me.id);
    if (c?.spendSource !== "fbtool" || !c.fbtoolKey) return NextResponse.json({ accounts: null });
    return NextResponse.json({ accounts: await fbtoolAccounts(c.fbtoolKey) });
  } catch (e) {
    return fail(e, 500);
  }
}

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  try {
    const { key } = (await req.json()) as { key?: string };
    if (!key?.trim()) return fail("Вставь ключ API FB Tool");
    if ((await listMetaKeys(me.id)).length > 0) return fail("Подключён источник Meta. Чтобы перейти на FB Tool, сначала удали ключи Meta");
    const source = (await getConnection(me.id))?.spendSource;
    if (source && source !== "fbtool") return fail("Подключён другой источник расхода Facebook. Чтобы перейти на FB Tool, сначала отключи его");
    const accounts = await fbtoolAccounts(key.trim());
    await setFbtoolKey(me.id, key);
    ingestSoon(me.id);
    return NextResponse.json({ ok: true, accounts });
  } catch (e) {
    return fail(e);
  }
}

// Отключить. История в складе остаётся: отключение забирает доступ, а не данные.
export async function DELETE() {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  try {
    await setFbtoolKey(me.id, null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e, 500);
  }
}
