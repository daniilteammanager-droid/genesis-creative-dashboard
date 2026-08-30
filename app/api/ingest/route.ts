import { NextResponse } from "next/server";
import { ingestForUser, usersToIngest, type IngestKind } from "@/lib/warehouse/ingest";

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

  try {
    const users = await usersToIngest();
    const results = [];
    // Последовательно, а не веером: у каждого баера свой ключ Meta, но лимит
    // приложения общий на всех (Decision 042). Параллельный запуск четырёх
    // полных обходов — верный способ выбить его целиком.
    for (const userId of users) {
      try {
        results.push(await ingestForUser(userId, kind));
      } catch (e) {
        // Один упавший баер не должен ронять прогон остальных.
        results.push({ userId, kind, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return NextResponse.json({ kind, users: users.length, results });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка" }, { status: 500 });
  }
}
