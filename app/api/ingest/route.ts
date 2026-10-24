import { NextResponse } from "next/server";
import { ingestForUser, usersToIngest, type IngestKind } from "@/lib/warehouse/ingest";
import { metaTokensOf } from "@/lib/connections/metaKeys";
import { getConnection } from "@/lib/connections/store";
import { checkCabinets } from "@/lib/alerts/cabinets";
import { checkRejectedAds } from "@/lib/alerts/rejected";
import { runAutocheck } from "@/lib/alerts/autocheck";

// Точка входа для крона. Дёргает её VPS, на которой уже крутится воркер: у
// бесплатного тарифа Vercel крон запускается раз в сутки, а нам нужен час и чаще.
//
// Сессии тут нет и быть не может, поэтому вход закрыт общим секретом. Роут
// добавлен в PUBLIC_PATHS middleware — иначе его развернуло бы на страницу входа,
// а VPS не умеет логиниться.

export const maxDuration = 300;

function authorized(req: Request): boolean {
  const expected = process.env.INGEST_SECRET;
  if (!expected || expected.length < 24) return false;   // не задан — значит закрыт
  const given = req.headers.get("x-ingest-secret") ?? "";
  // Длины разные — сравнивать нечего; равные сравниваем целиком, без раннего выхода
  // на первом различии.
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 401 });
  }

  const kind = (new URL(req.url).searchParams.get("kind") ?? "today") as IngestKind;
  if (kind !== "today" && kind !== "window") {
    return NextResponse.json({ error: `Неизвестный режим: ${kind}` }, { status: 400 });
  }

  // Догрузка истории — только пока есть запас: следом ещё алерты, антиотклон
  // и авточек, а крон ждёт ответа 280 секунд.
  const started = Date.now();
  const BACKFILL_BUDGET_MS = 150_000;

  try {
    const users = await usersToIngest();
    const results = [];
    // Последовательно, а не веером: у каждого баера свой ключ Meta, но лимит
    // приложения общий на всех (Decision 042). Параллельный запуск четырёх
    // полных обходов — верный способ выбить его целиком.
    for (const userId of users) {
      try {
        const backfill = kind === "today" && Date.now() - started < BACKFILL_BUDGET_MS;
        results.push(await ingestForUser(userId, kind, { backfill }));
      } catch (e) {
        // Один упавший баер не должен ронять прогон остальных.
        results.push({ userId, kind, error: e instanceof Error ? e.message : String(e) });
      }
    }
    // Состояние кабинетов — на частом прогоне, отдельный крон для этого не нужен.
    // Его сбой не должен портить ответ о складе: склад уже записан.
    // Антиотклон — следом, по живым кабинетам из той же проверки.
    let cabinets: unknown = null;
    let rejected: unknown = null;
    if (kind === "today") {
      try {
        const tokens = (await Promise.all(users.map((u) => metaTokensOf(u)))).flat().map((k) => k.token);
        const dolphin = (await Promise.all(users.map((u) => getConnection(u).catch(() => null))))
          .flatMap((c) => (c?.spendSource === "dolphin" && c.dolphinToken ? [c.dolphinToken] : []));
        // tokenFor и dolphinFor — ключи, в ответ роута им нельзя.
        const { tokenFor, dolphinFor, ...summary } = await checkCabinets(tokens, dolphin);
        cabinets = summary;
        try {
          rejected = await checkRejectedAds(tokenFor, dolphinFor);
        } catch (e) {
          rejected = { error: e instanceof Error ? e.message : String(e) };
        }
      } catch (e) {
        cabinets = { error: e instanceof Error ? e.message : String(e) };
      }
    }
    // Авточек по расписанию привязок — тоже раз в четверть часа, вместе с прогоном.
    let autocheck: unknown = null;
    if (kind === "today") {
      try {
        autocheck = await runAutocheck();
      } catch (e) {
        autocheck = { error: e instanceof Error ? e.message : String(e) };
      }
    }
    return NextResponse.json({ kind, users: users.length, results, cabinets, rejected, autocheck });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка" }, { status: 500 });
  }
}
