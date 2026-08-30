import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { getConnectionView, saveConnection } from "@/lib/connections/store";
import { verifyMetaToken, verifySheet, verifyXlsxUrl } from "@/lib/connections/verify";

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
      crmCampaignsUrl?: string | null;
      crmAdsSheetId?: string | null;
    };

    // Проверяем до записи: сохранённое нерабочее подключение хуже несохранённого,
    // потому что выглядит рабочим.
    const problems = (
      await Promise.all([
        body.metaToken ? verifyMetaToken(body.metaToken) : null,
        body.crmCampaignsUrl ? verifyXlsxUrl(body.crmCampaignsUrl) : null,
        body.crmAdsSheetId ? verifySheet(body.crmAdsSheetId) : null,
      ])
    ).filter((p): p is string => p !== null);

    if (problems.length > 0) {
      return NextResponse.json({ error: problems.join(". ") }, { status: 400 });
    }

    await saveConnection(me.id, body);
    return NextResponse.json(await getConnectionView(me.id));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка" }, { status: 500 });
  }
}
