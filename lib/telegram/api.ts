// Тонкий клиент Telegram Bot API. Бот один на команду, токен в env.
//
// Ошибка Telegram не глотается, а несёт код: 403 («бот заблокирован», «выгнали
// из группы») означает, что привязка мертва, и её надо снять, а не слать туда
// каждый час заново.

export class TelegramError extends Error {
  constructor(message: string, readonly code: number, readonly migrateTo?: number) {
    super(message);
  }
}

function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("Не задан TELEGRAM_BOT_TOKEN — бот не подключён");
  return t;
}

export async function tg<T = unknown>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => null)) as
    | { ok: boolean; result?: T; description?: string; error_code?: number; parameters?: { migrate_to_chat_id?: number } }
    | null;
  if (!data?.ok) {
    throw new TelegramError(
      `Telegram ${method}: ${data?.description ?? `HTTP ${res.status}`}`,
      data?.error_code ?? res.status,
      data?.parameters?.migrate_to_chat_id
    );
  }
  return data.result as T;
}

// Имя бота нужно для ссылки привязки. Берём у самого Telegram, а не из env:
// одной переменной меньше, и она не разъедется с настоящим ботом.
let username: Promise<string> | null = null;
export function botUsername(): Promise<string> {
  username ??= tg<{ username: string }>("getMe").then((me) => me.username).catch((e) => {
    username = null;
    throw e;
  });
  return username;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function sendMessage(chatId: number, text: string, threadId?: number | null, extra: Record<string, unknown> = {}) {
  return tg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(threadId ? { message_thread_id: threadId } : {}),
    ...extra,
  });
}
