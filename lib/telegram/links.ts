import { randomBytes } from "node:crypto";
import { warehouse } from "@/lib/warehouse/read";
import { DEFAULT_EVENTS } from "./events";
import { escapeHtml, sendMessage, TelegramError } from "./api";

// Привязки чатов к профилям. Таблицы закрыты от браузера (017_telegram.sql),
// поэтому всё здесь идёт сервисным ключом.

const CODE_TTL_MS = 15 * 60_000;

export interface TelegramLink {
  id: string;
  chatType: "private" | "group" | "supergroup";
  title: string | null;
  threadId: number | null;
  events: string[];
  createdAt: string;
}

const db = () => warehouse();

export async function createLinkCode(userId: string): Promise<string> {
  // base64url — ровно тот алфавит, который Telegram пропускает в ?start=.
  const code = randomBytes(12).toString("base64url");
  const { error } = await db().from("telegram_link_codes").insert({
    code, user_id: userId, expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });
  if (error) throw new Error(error.message);
  return code;
}

export async function listLinks(userId: string): Promise<TelegramLink[]> {
  const { data, error } = await db().from("telegram_links")
    .select("id, chat_type, title, thread_id, events, created_at")
    .eq("user_id", userId).order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id, chatType: r.chat_type, title: r.title, threadId: r.thread_id, events: r.events, createdAt: r.created_at,
  }));
}

// Отвязка и правка — только своих: user_id в условии, а не только id привязки.
export async function deleteLink(userId: string, id: string): Promise<void> {
  const { error } = await db().from("telegram_links").delete().eq("id", id).eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function setLinkEvents(userId: string, id: string, events: string[]): Promise<void> {
  const { error } = await db().from("telegram_links").update({ events }).eq("id", id).eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export interface ChatPlace {
  chatId: number;
  threadId: number | null;
  chatType: TelegramLink["chatType"];
  title: string | null;
  tgUserId: number | null;
}

// Код → привязка. Код одноразовый: удаляется тем же запросом, которым читается,
// поэтому дважды по одной ссылке не привязаться, даже если нажать одновременно.
export async function consumeLinkCode(code: string, place: ChatPlace): Promise<{ name: string } | string> {
  const { data: rows, error } = await db().from("telegram_link_codes")
    .delete().eq("code", code).gt("expires_at", new Date().toISOString()).select("user_id");
  if (error) throw new Error(error.message);
  const userId = rows?.[0]?.user_id as string | undefined;
  if (!userId) return "Ссылка устарела или уже использована. Возьми новую в дашборде: Настройки → Интеграции";

  const { data: profile } = await db().from("profiles").select("name, email, status").eq("id", userId).maybeSingle();
  if (!profile || profile.status !== "active") return "Профиль в дашборде отключён — привязать чат нельзя";

  // Повторная активация той же темы обновляет привязку, а не дублирует её.
  const { data: existing } = await db().from("telegram_links").select("id")
    .eq("user_id", userId).eq("chat_id", place.chatId)
    .filter("thread_id", place.threadId === null ? "is" : "eq", place.threadId === null ? null : place.threadId)
    .maybeSingle();
  const row = {
    user_id: userId, chat_id: place.chatId, thread_id: place.threadId, chat_type: place.chatType,
    title: place.title, tg_user_id: place.tgUserId,
  };
  const { error: e } = existing
    ? await db().from("telegram_links").update(row).eq("id", existing.id)
    : await db().from("telegram_links").insert({ ...row, events: DEFAULT_EVENTS });
  if (e) throw new Error(e.message);
  return { name: (profile.name as string) || (profile.email as string) };
}

export async function linksInPlace(chatId: number, threadId: number | null) {
  const { data, error } = await db().from("telegram_links").select("id, user_id, tg_user_id")
    .eq("chat_id", chatId)
    .filter("thread_id", threadId === null ? "is" : "eq", threadId === null ? null : threadId);
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; user_id: string; tg_user_id: number | null }[];
}

export async function deleteLinksById(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await db().from("telegram_links").delete().in("id", ids);
  if (error) throw new Error(error.message);
}

// Бота выгнали из группы или заблокировали в личке — слать туда больше некуда.
export async function dropChat(chatId: number): Promise<void> {
  const { error } = await db().from("telegram_links").delete().eq("chat_id", chatId);
  if (error) throw new Error(error.message);
}

// Группа стала супергруппой — у неё новый id, привязки едут за ней.
export async function moveChat(from: number, to: number): Promise<void> {
  const { error } = await db().from("telegram_links").update({ chat_id: to, chat_type: "supergroup" }).eq("chat_id", from);
  if (error) throw new Error(error.message);
}

// Разослать событие во все привязки человека, где оно включено. Отключённому
// профилю не шлётся ничего: отключение забирает и уведомления.
//
// text — HTML; всё, что пришло извне (имена кабинетов, объявлений), вызывающий
// экранирует сам через escapeHtml.
export async function notify(userId: string, event: string, text: string, extra: Record<string, unknown> = {}): Promise<number> {
  const { data: profile } = await db().from("profiles").select("status").eq("id", userId).maybeSingle();
  if (profile?.status !== "active") return 0;

  const { data, error } = await db().from("telegram_links").select("id, chat_id, thread_id")
    .eq("user_id", userId).contains("events", [event]);
  if (error) throw new Error(error.message);
  return sendToLinks((data ?? []) as { id: string; chat_id: number; thread_id: number | null }[], text, extra);
}

export async function sendTest(userId: string, id: string): Promise<void> {
  const { data } = await db().from("telegram_links").select("id, chat_id, thread_id")
    .eq("id", id).eq("user_id", userId).maybeSingle();
  if (!data) throw new Error("Привязка не найдена");
  const sent = await sendToLinks([data], "✅ Проверка связи из Genesis Dashboard. Уведомления будут приходить сюда.");
  if (sent === 0) throw new Error("Telegram не доставил сообщение: бота убрали из чата, привязка снята");
}

async function sendToLinks(links: { id: string; chat_id: number; thread_id: number | null }[], text: string, extra: Record<string, unknown> = {}) {
  let sent = 0;
  for (const l of links) {
    try {
      await sendMessage(l.chat_id, text, l.thread_id, extra);
      sent++;
    } catch (e) {
      if (!(e instanceof TelegramError)) throw e;
      if (e.migrateTo) {
        await moveChat(l.chat_id, e.migrateTo);
        await sendMessage(e.migrateTo, text, l.thread_id, extra);
        sent++;
      } else if (e.code === 403 || /chat not found|thread not found/i.test(e.message)) {
        // Мёртвая привязка: бота выгнали, заблокировали или тему удалили.
        await deleteLinksById([l.id]);
      } else {
        throw e;
      }
    }
  }
  return sent;
}

export { escapeHtml };
