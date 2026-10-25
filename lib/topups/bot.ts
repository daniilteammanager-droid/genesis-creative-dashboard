import { warehouse } from "@/lib/warehouse/read";
import { escapeHtml } from "@/lib/telegram/api";
import { parseHash } from "./chain";
import { markPaid, pressPaid, reject, topupByMessage, topupChat, topupTg } from "./requests";

// Top-Up бот — отдельный от общего (Decision 072). Живёт в одном платёжном чате
// владельцев:
//   /start <код>  — сделать этот чат платёжным (код из дашборда, только владелец);
//   кнопки tp:…   — «Оплачено» / «Отклонить» под заявкой;
//   ответ хэшем на сообщение заявки — закрыть её этим хэшем.
// Всё, что пришло не из платёжного чата, бот не слушает: жать кнопки могут
// только те, кого владельцы позвали в чат.

interface From { id: number; first_name?: string; username?: string }
interface Msg {
  message_id: number; chat: { id: number; type: string; title?: string }; from?: From; text?: string;
  message_thread_id?: number; is_topic_message?: boolean; reply_to_message?: { message_id: number };
}
export interface TopupUpdate {
  message?: Msg;
  callback_query?: { id: string; data?: string; from: From; message?: Msg };
}

const who = (f?: From) => (f ? f.username ? `@${f.username}` : f.first_name ?? String(f.id) : null);
const say = (m: Msg, text: string) => topupTg("sendMessage", {
  chat_id: m.chat.id, text, parse_mode: "HTML", reply_parameters: { message_id: m.message_id },
  ...(m.is_topic_message && m.message_thread_id ? { message_thread_id: m.message_thread_id } : {}),
});

async function bind(m: Msg, code: string): Promise<void> {
  const db = warehouse();
  // Код тот же, что у привязки общего бота: одноразовый, удаляется при чтении.
  const { data } = await db.from("telegram_link_codes").delete().eq("code", code).gt("expires_at", new Date().toISOString()).select("user_id");
  const userId = data?.[0]?.user_id as string | undefined;
  if (!userId) return void (await say(m, "Ссылка устарела или уже использована. Возьми новую в дашборде: Пополнения."));
  const { data: p } = await db.from("profiles").select("role, status").eq("id", userId).maybeSingle();
  if (p?.role !== "main" || p.status !== "active") return void (await say(m, "Платёжный чат привязывает только владелец."));
  const { error } = await db.from("topup_chat").upsert({
    id: 1, chat_id: m.chat.id, thread_id: m.is_topic_message && m.message_thread_id ? m.message_thread_id : null,
    title: m.chat.title ?? null, bound_by: userId, bound_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  await say(m, "✅ Этот чат — платёжный. Сюда будут приходить заявки на пополнение из дашборда.");
}

export async function handleTopupUpdate(u: TopupUpdate): Promise<void> {
  const chat = await topupChat();

  const q = u.callback_query;
  if (q) {
    await topupTg("answerCallbackQuery", { callback_query_id: q.id }).catch(() => undefined);
    if (!q.message || q.message.chat.id !== chat?.chat_id) return;
    const [, kind, id] = (q.data ?? "").split(":");
    if (!id) return;
    try {
      const err = kind === "paid" ? await pressPaid(id, who(q.from)) : kind === "no" ? await reject(id, who(q.from)) : null;
      if (err) await say(q.message, escapeHtml(err));
    } catch (e) {
      await say(q.message, `Не получилось: ${escapeHtml((e instanceof Error ? e.message : String(e)).slice(0, 600))}`).catch(() => undefined);
    }
    return;
  }

  const m = u.message;
  if (!m?.text) return;
  const start = /^\/start(?:@\w+)?\s+(\S+)/.exec(m.text.trim());
  if (start) return bind(m, start[1]);
  if (m.chat.id !== chat?.chat_id || !m.reply_to_message) return;

  const r = await topupByMessage(m.chat.id, m.reply_to_message.message_id);
  if (!r) return;
  const hash = parseHash(m.text);
  if (!hash) return void (await say(m, "Не вижу хэша в ответе. Пришли хэш транзакции или ссылку на неё."));
  const res = await markPaid(r.id, { hash }, who(m.from));
  await say(m, typeof res === "string" ? escapeHtml(res) : `✅ Заявка #${r.number} закрыта этим хэшем, автору ушёл ответ.`);
}
