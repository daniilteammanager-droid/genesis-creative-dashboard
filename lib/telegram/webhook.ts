import { botUsername, sendMessage, tg, escapeHtml } from "./api";
import { consumeLinkCode, deleteLinksById, dropChat, linksInPlace, moveChat, type ChatPlace } from "./links";
import { handleAntiReject, type CallbackQuery } from "@/lib/antireject/bot";
import { handleUniq } from "@/lib/uniq/bot";

// Что бот понимает:
//   /start <код>  — привязать этот чат (личка, группа или тема) к профилю.
//                   В группу код приезжает сам по ссылке ?startgroup=<код>.
//   /link <код>   — то же самое руками, например в нужной теме форума.
//   /stop         — отвязать этот чат или тему.
//   кнопки ar:…   — антиотклон под алертом об отклонении (lib/antireject/bot.ts),
//   кнопки uv:…   — меню уникализации видео (lib/uniq/bot.ts).
// Остальное бот не слушает: он шлёт уведомления, а не болтает.

export function parseCommand(text: string, bot: string): { cmd: string; arg: string } | null {
  const m = /^\/([a-z]+)(?:@(\w+))?(?:\s+(\S+))?/i.exec(text.trim());
  if (!m) return null;
  // В группе «/start@ДругойБот» адресована не нам.
  if (m[2] && m[2].toLowerCase() !== bot.toLowerCase()) return null;
  return { cmd: m[1].toLowerCase(), arg: m[3] ?? "" };
}

interface TgUser { id: number }
interface TgChat { id: number; type: string; title?: string; first_name?: string; username?: string }
interface TgMessage {
  chat: TgChat;
  from?: TgUser;
  text?: string;
  message_thread_id?: number;
  is_topic_message?: boolean;
  migrate_to_chat_id?: number;
}
export interface TgUpdate {
  message?: TgMessage;
  callback_query?: CallbackQuery;
  my_chat_member?: { chat: TgChat; new_chat_member: { status: string } };
}

const HELP =
  "Это бот Genesis Dashboard. Он присылает уведомления, которые ты выбрал в дашборде.\n\n" +
  "Привязать чат: Настройки → Интеграции → Telegram. Там же выбираются уведомления.\n" +
  "/stop — отвязать этот чат";

function placeOf(msg: TgMessage): ChatPlace {
  const type = msg.chat.type === "private" ? "private" : msg.chat.type === "group" ? "group" : "supergroup";
  return {
    chatId: msg.chat.id,
    // Тема есть только у сообщений внутри темы форума; «Общая» тема id не несёт.
    threadId: msg.is_topic_message && msg.message_thread_id ? msg.message_thread_id : null,
    chatType: type,
    title: msg.chat.title ?? msg.chat.first_name ?? msg.chat.username ?? null,
    tgUserId: msg.from?.id ?? null,
  };
}

async function isChatAdmin(chatId: number, userId: number): Promise<boolean> {
  try {
    const m = await tg<{ status: string }>("getChatMember", { chat_id: chatId, user_id: userId });
    return m.status === "creator" || m.status === "administrator";
  } catch {
    return false;
  }
}

export async function handleUpdate(update: TgUpdate): Promise<void> {
  if (update.callback_query) {
    if (update.callback_query.data?.startsWith("ar:")) await handleAntiReject(update.callback_query);
    else if (update.callback_query.data?.startsWith("uv:")) await handleUniq(update.callback_query);
    return;
  }

  // Бота убрали из группы или заблокировали в личке.
  const member = update.my_chat_member;
  if (member && ["left", "kicked"].includes(member.new_chat_member.status)) {
    await dropChat(member.chat.id);
    return;
  }

  const msg = update.message;
  if (!msg) return;
  if (msg.migrate_to_chat_id) {
    await moveChat(msg.chat.id, msg.migrate_to_chat_id);
    return;
  }
  if (!msg.text) return;

  const command = parseCommand(msg.text, await botUsername());
  if (!command) return;
  const place = placeOf(msg);
  const reply = (text: string) => sendMessage(place.chatId, text, place.threadId);

  if ((command.cmd === "start" || command.cmd === "link") && command.arg) {
    const result = await consumeLinkCode(command.arg, place);
    if (typeof result === "string") return void (await reply(result));
    const where = place.chatType === "private" ? "Этот чат" : place.threadId ? "Эта тема" : "Эта группа";
    await reply(
      `✅ ${where} привязан${place.threadId ? "а" : place.chatType === "private" ? "" : "а"} к профилю ` +
      `<b>${escapeHtml(result.name)}</b>.\nКакие уведомления слать сюда — выбирается в дашборде: Настройки → Интеграции.`
    );
    return;
  }

  if (command.cmd === "stop") {
    const links = await linksInPlace(place.chatId, place.threadId);
    if (links.length === 0) return void (await reply("Этот чат ни к кому не привязан."));
    // В личке отвязывает владелец лички. В группе — тот, кто привязывал, только
    // своё; админ группы — всё в этом месте. Иначе любой участник выключил бы
    // уведомления всей группе.
    const admin = place.chatType === "private" || (place.tgUserId !== null && await isChatAdmin(place.chatId, place.tgUserId));
    const mine = admin ? links : links.filter((l) => l.tg_user_id === place.tgUserId);
    if (mine.length === 0) return void (await reply("Отвязать может тот, кто привязывал, или админ группы."));
    await deleteLinksById(mine.map((l) => l.id));
    await reply("Отвязано. Уведомления сюда больше не придут.");
    return;
  }

  if (command.cmd === "start" || command.cmd === "help") await reply(HELP);
}
