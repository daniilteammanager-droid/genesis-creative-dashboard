import { warehouse } from "@/lib/warehouse/read";
import { escapeHtml } from "@/lib/telegram/api";
import { parseHash } from "./chain";
import { manualPaid, pressPaid, reject, release, take, topupByMessage, topupChat, topupTg } from "./requests";

// Top-Up бот — отдельный от общего (Decision 072). Живёт в одном платёжном чате
// владельцев:
//   /start <код>  — сделать этот чат платёжным (код из дашборда, только владелец);
//   кнопки tp:…   — «Беру в работу» / «Снять с себя» / «Оплачено» / «Отклонить» под заявкой;
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

// Одно имя на человека (Decision 126): кто привязал свой Telegram в дашборде (Настройки → Интеграции), пишется в
// заявку именем профиля, как со страницы, — и «Снять с себя» работает с любой стороны. Остальные — @ником, как раньше.
async function who(f?: From): Promise<string | null> {
  if (!f) return null;
  const db = warehouse();
  const { data: link } = await db.from("telegram_links").select("user_id").eq("tg_user_id", f.id).limit(1).maybeSingle();
  if (link) {
    const { data: p } = await db.from("profiles").select("name, email, status").eq("id", link.user_id).maybeSingle();
    if (p?.status === "active") return (p.name as string) || (p.email as string);
  }
  return f.username ? `@${f.username}` : f.first_name ?? String(f.id);
}
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
    const [, kind, id] = (q.data ?? "").split(":");
    const ours = q.message && q.message.chat.id === chat?.chat_id && id;
    // «Беру» и «Снять» — быстрые, отказ («уже взял @…») всплывает у нажавшего, а не пишется в чат.
    if (ours && (kind === "take" || kind === "free")) {
      const err = await who(q.from).then((by) => (kind === "take" ? take : release)(id, by))
        .catch((e) => `Не получилось: ${(e instanceof Error ? e.message : String(e)).slice(0, 150)}`);
      await topupTg("answerCallbackQuery", { callback_query_id: q.id, ...(err ? { text: err.slice(0, 200), show_alert: true } : {}) }).catch(() => undefined);
      return;
    }
    await topupTg("answerCallbackQuery", { callback_query_id: q.id }).catch(() => undefined);
    if (!ours || !q.message) return;
    try {
      const by = await who(q.from);
      const err = kind === "paid" ? await pressPaid(id, by) : kind === "no" ? await reject(id, by) : null;
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
  if (/^\/start(?:@\w+)?$/.test(m.text.trim()) && m.chat.id !== chat?.chat_id) {
    return void (await say(m, "Чтобы сделать этот чат платёжным, владелец жмёт «Привязать чат» в дашборде: Пополнения — и выбирает этот чат."));
  }
  if (m.chat.id !== chat?.chat_id || !m.reply_to_message) return;

  const r = await topupByMessage(m.chat.id, m.reply_to_message.message_id);
  if (!r) return;
  const hash = parseHash(m.text);
  if (!hash) return void (await say(m, "Не вижу хэша в ответе. Пришли хэш транзакции или ссылку на неё."));
  const { result, seen } = await manualPaid(r, hash, await who(m.from));
  await say(m, typeof result === "string" ? escapeHtml(result) : seen
    ? `✅ Заявка #${r.number} закрыта: перевод ${result.paid_amount} ${r.asset} на адрес заявки найден.`
    : `✅ Заявка #${r.number} закрыта этим хэшем. Перевода на адрес заявки в блокчейне не вижу — проверь хэш.`);
}
