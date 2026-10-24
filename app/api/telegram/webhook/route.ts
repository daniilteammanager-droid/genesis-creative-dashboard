import { NextResponse } from "next/server";
import { handleUpdate, type TgUpdate } from "@/lib/telegram/webhook";

// Вебхук бота. Зовёт Telegram, сессии нет — роут в PUBLIC_PATHS middleware.
// Вход закрыт секретом, который Telegram присылает заголовком
// X-Telegram-Bot-Api-Secret-Token (задаётся в setWebhook). Без него любой мог бы
// прислать «апдейт» с чужим кодом привязки.

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
    await handleUpdate((await req.json()) as TgUpdate);
  } catch (e) {
    // Ответ всё равно 200: на ошибку Telegram повторяет апдейт снова и снова,
    // и одна сломанная команда забила бы очередь бота целиком.
    console.error("telegram webhook:", e instanceof Error ? e.message : e);
  }
  return NextResponse.json({ ok: true });
}
