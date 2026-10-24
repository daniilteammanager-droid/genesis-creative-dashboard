import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { getConnection, getConnectionView, saveConnection, sourceTakenBy, torroBuyerTakenBy, type ConnectionInput } from "@/lib/connections/store";
import { verifyMetaToken, verifySheet } from "@/lib/connections/verify";
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
    const raw = (await req.json()) as Omit<ConnectionInput, "torroBuyerId"> & { torroBuyerId?: number | string | null };

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
    const body: ConnectionInput = { ...raw, torroBuyerId };
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

    // Проверяем до записи: сохранённое нерабочее подключение хуже несохранённого,
    // потому что выглядит рабочим.
    // Все три выгрузки — Google-таблицы, проверяются одинаково: читает ли их
    // сервисный аккаунт. Ссылок на XLSX среди подключений больше нет.
    const problems = (
      await Promise.all([
        body.metaToken ? verifyMetaToken(body.metaToken) : null,
        body.crmCampaignsSheetId ? verifySheet(body.crmCampaignsSheetId) : null,
        body.crmAdsSheetId ? verifySheet(body.crmAdsSheetId) : null,
        body.crmAdsByIdSheetId ? verifySheet(body.crmAdsByIdSheetId) : null,
      ])
    ).filter((p): p is string => p !== null);

    if (problems.length > 0) {
      return NextResponse.json({ error: problems.join(". ") }, { status: 400 });
    }

    // Проверка доступа выше говорит только «сервисный аккаунт это читает» — а он
    // читает и командные таблицы, и чужие. Без этой проверки достаточно знать
    // адрес командной выгрузки, чтобы увидеть цифры всей команды под видом своих.
    const taken = await sourceTakenBy(me.id, body);
    if (taken) {
      return NextResponse.json(
        { error: `Эта ${taken} уже подключена другому. Нужна своя — та, что настроена на твой аккаунт Torro` },
        { status: 400 }
      );
    }

    await saveConnection(me.id, body);
    return NextResponse.json(await getConnectionView(me.id));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка" }, { status: 500 });
  }
}
