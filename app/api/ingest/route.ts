import { NextResponse } from "next/server";
import { ingestForUser, usersToIngest, type IngestKind } from "@/lib/warehouse/ingest";
import { metaTokensOf } from "@/lib/connections/metaKeys";
import { getConnection } from "@/lib/connections/store";
import { checkCabinets } from "@/lib/alerts/cabinets";
import { checkRejectedAds } from "@/lib/alerts/rejected";
import { allTgadsKeys } from "@/lib/connections/tgadsKeys";
import { runAutocheck } from "@/lib/alerts/autocheck";
import { runDailySummary } from "@/lib/alerts/summary";
import { runTestLimitAlerts } from "@/lib/alerts/testLimit";
import { runPairs } from "@/lib/warehouse/torroPairs";
import { tickTopups } from "@/lib/topups/requests";
import { runOpenJobs } from "@/lib/autoupload/jobs";
import { syncAll as syncGr4 } from "@/lib/general-report-4/store";
import { runQueue as runAiQueue } from "@/lib/ai/creo";
import { runWeekly as runAiWeekly } from "@/lib/ai/summary";

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

  const raw = new URL(req.url).searchParams.get("kind") ?? "today";
  // Связки «кампания × объявление» из Torro — своим кроном: ~1 с на объявление,
  // в прогон раз в 15 минут они не влезают (Decision 070).
  if (raw === "pairs") {
    try {
      const runs = await runPairs(240_000);
      return NextResponse.json({ kind: "pairs", runs });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка" }, { status: 500 });
    }
  }
  // General 4.0 — таблицы в свою базу раз в 15 минут (Decision 084).
  if (raw === "gr4") {
    try {
      return NextResponse.json({ kind: "gr4", ...(await syncGr4()) });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка" }, { status: 500 });
    }
  }
  // Автозалив — раз в минуту: продолжить незаконченные задания (Decision 081).
  if (raw === "autoupload") {
    try {
      return NextResponse.json({ kind: "autoupload", jobs: await runOpenJobs(240_000) });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка" }, { status: 500 });
    }
  }
  // AI-разборы — раз в час, в :20 (после часовой проверки границы теста): очередь автоматических
  // разборов и недельная сводка (Decision 101).
  if (raw === "ai") {
    try {
      const queue = await runAiQueue(200_000);
      const weekly = await runAiWeekly().catch((e) => `error: ${e instanceof Error ? e.message : e}`);
      return NextResponse.json({ kind: "ai", queue, weekly });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка" }, { status: 500 });
    }
  }
  // Заявки на пополнение — раз в минуту: срок оплаты и поиск перевода (Decision 072).
  if (raw === "topups") {
    try {
      return NextResponse.json({ kind: "topups", ...(await tickTopups()) });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка" }, { status: 500 });
    }
  }
  const kind = raw as IngestKind;
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
        const conns = await Promise.all(users.map((u) => getConnection(u).catch(() => null)));
        const dolphin = conns.flatMap((c) => (c?.spendSource === "dolphin" && c.dolphinToken ? [c.dolphinToken] : []));
        const fbtool = conns.flatMap((c, i) => (c?.spendSource === "fbtool" && c.fbtoolKey ? [{ key: c.fbtoolKey, userId: users[i] }] : []));
        // tokenFor, dolphinFor, fbtoolFor — ключи, в ответ роута им нельзя.
        const { tokenFor, dolphinFor, fbtoolFor, ...summary } = await checkCabinets(tokens, dolphin, fbtool);
        cabinets = summary;
        try {
          rejected = await checkRejectedAds(tokenFor, dolphinFor, fbtoolFor, await allTgadsKeys());
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
    // Утренняя сводка владельцу и тимлиду — тоже с прогоном, в свой слот (Decision 066).
    let summary: unknown = null;
    if (kind === "today") {
      try {
        summary = await runDailySummary();
      } catch (e) {
        summary = { error: e instanceof Error ? e.message : String(e) };
      }
    }
    // Крео за границей теста без депов — раз в час, на первом прогоне часа (Decision 100).
    let testLimit: unknown = null;
    if (kind === "today" && new Date().getUTCMinutes() < 15) {
      try {
        testLimit = await runTestLimitAlerts();
      } catch (e) {
        testLimit = { error: e instanceof Error ? e.message : String(e) };
      }
    }
    return NextResponse.json({ kind, users: users.length, results, cabinets, rejected, autocheck, summary, testLimit });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка" }, { status: 500 });
  }
}
