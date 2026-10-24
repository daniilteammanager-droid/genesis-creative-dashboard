import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { addMetaKey, deleteMetaKey, listMetaKeys } from "@/lib/connections/metaKeys";
import { warehouse } from "@/lib/warehouse/read";
import { ingestSoon } from "@/lib/warehouse/kick";

// Загрузка после подключения идёт следом за ответом (ingestSoon) — ей нужно время.
export const maxDuration = 300;

// Свои ключи Meta. user_id из сессии: чужой ключ не увидеть и не удалить.
// Источник расхода у человека один (Decision 061): пока подключён FB Tool или
// Dolphin, ключ Meta не добавить — сначала удалить ту интеграцию.

const fail = (e: unknown, status = 400) =>
  NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

async function view(userId: string) {
  const { data } = await warehouse().from("buyer_connections")
    .select("spend_source, spend_backfilled_from, spend_backfill_done, dolphin_token_hint, fbtool_key_hint").eq("user_id", userId).maybeSingle();
  return {
    keys: await listMetaKeys(userId),
    source: data?.spend_source ?? null,
    backfilledFrom: data?.spend_backfilled_from ?? null,
    backfillDone: data?.spend_backfill_done ?? false,
    // Ключ Dolphin не отдаётся — только хвост, чтобы человек узнал свой.
    dolphinHint: data?.spend_source === "dolphin" ? data.dolphin_token_hint ?? "" : null,
    fbtoolHint: data?.spend_source === "fbtool" ? data.fbtool_key_hint ?? "" : null,
  };
}

export async function GET() {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  try {
    return NextResponse.json(await view(me.id));
  } catch (e) {
    return fail(e, 500);
  }
}

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  try {
    const { name, token } = (await req.json()) as { name?: string; token?: string };
    const current = await view(me.id);
    if (current.source && current.source !== "meta") {
      return fail("Подключён другой источник расхода. Чтобы перейти на Meta, сначала удали его");
    }
    await addMetaKey(me.id, name ?? "", token ?? "");
    ingestSoon(me.id);
    return NextResponse.json(await view(me.id));
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
    await deleteMetaKey(me.id, id);
    return NextResponse.json(await view(me.id));
  } catch (e) {
    return fail(e, 500);
  }
}
