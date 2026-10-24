import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { getConnection, getConnectionView, saveConnection, torroBuyerTakenBy, type ConnectionInput } from "@/lib/connections/store";
import { verifyTorro } from "@/lib/torro/mcp";
import { mskDay } from "@/lib/day";

// Свои подключения человек правит только сам: user_id берётся из сессии, а не из
// тела запроса. Иначе один баер подменил бы ключ другому.

export async function GET() {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });

  try {
    return NextResponse.json({
      ...(await getConnectionView(me.id)),
      serviceAccount: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });

  try {
    // Здесь только Torro (Decision 061): ключи Meta — в /api/meta-keys, выгрузок в таблицы больше нет.
    const raw = (await req.json()) as { torroToken?: string | null; torroBuyerId?: number | string | null };

    // ─── Torro: ключ и id проверяются парой ───────────────────────────────
    // Прислать можно одно из двух, второе берём сохранённое. Отключение ключа
    // снимает и id: без ключа он ни к чему, а занятым оставаться не должен.
    let torroBuyerId: number | null | undefined = raw.torroToken === null ? null : undefined;
    if (raw.torroToken !== null && raw.torroBuyerId !== undefined && raw.torroBuyerId !== null) {
      torroBuyerId = Number(String(raw.torroBuyerId).trim());
      if (!Number.isInteger(torroBuyerId) || torroBuyerId <= 0) {
        return NextResponse.json({ error: "id баера в Torro — целое число, например 5183" }, { status: 400 });
      }
    }
    const body: ConnectionInput = { torroToken: raw.torroToken, torroBuyerId };
    if (body.torroToken || typeof body.torroBuyerId === "number") {
      const saved = await getConnection(me.id);
      const token = body.torroToken || saved?.torroToken;
      const buyerId = typeof body.torroBuyerId === "number" ? body.torroBuyerId : saved?.torroBuyerId;
      if (!token || !buyerId) {
        return NextResponse.json({ error: "Для Torro нужны оба поля: ключ и id баера" }, { status: 400 });
      }
      if (await torroBuyerTakenBy(me.id, buyerId)) {
        return NextResponse.json({ error: `id ${buyerId} в Torro уже подключён другому. Нужен свой` }, { status: 400 });
      }
      const problem = await verifyTorro(token, buyerId, mskDay());
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    }

    await saveConnection(me.id, body);
    return NextResponse.json(await getConnectionView(me.id));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка" }, { status: 500 });
  }
}
