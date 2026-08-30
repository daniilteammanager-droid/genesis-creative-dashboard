import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { getConnectionView, saveConnection, sourceTakenBy } from "@/lib/connections/store";
import { verifyMetaToken, verifySheet } from "@/lib/connections/verify";

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
    const body = (await req.json()) as {
      metaToken?: string | null;
      crmCampaignsSheetId?: string | null;
      crmAdsSheetId?: string | null;
      crmAdsByIdSheetId?: string | null;
    };

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
