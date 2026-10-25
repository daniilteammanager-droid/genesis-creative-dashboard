import { NextResponse } from "next/server";
import { handleTopupUpdate, type TopupUpdate } from "@/lib/topups/bot";

// Вебхук Top-Up бота (Decision 072). Как у общего бота: роут в PUBLIC_PATHS,
// вход закрыт тем же секретом TELEGRAM_WEBHOOK_SECRET из setWebhook.

function authorized(req: Request): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || expected.length < 24) return false;
  const given = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Нет доступа" }, { status: 401 });
  try {
    await handleTopupUpdate((await req.json()) as TopupUpdate);
  } catch (e) {
    // 200 всё равно: иначе Telegram повторяет апдейт без конца.
    console.error("topup webhook:", e instanceof Error ? e.message : e);
  }
  return NextResponse.json({ ok: true });
}
