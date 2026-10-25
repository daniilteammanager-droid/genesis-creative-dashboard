import { warehouse } from "@/lib/warehouse/read";
import { escapeHtml, sendMessage, tg } from "@/lib/telegram/api";
import { context, writer, type Ctx, type Place } from "@/lib/antireject/bot";
import { REJECTED } from "@/lib/antireject/meta";
import { findSource, v1Name } from "./source";

// Уникализация в боте (Decision 076): кнопка «🎬 Уникализация» под алертом об
// отклонении → выбор вставки → выбор крайних кадров → в очередь. Варианты и
// порядок — как у Артёма (VIDEO_VARIANTS_RU.md в его архиве).
//
//   uv:t:<job>:<вид>  — вставка после чёрного экрана
//   uv:f:<job>        — к выбору крайних кадров;  uv:b:<job> — назад
//   uv:F:<job>:<вид>  — крайние кадры
//   uv:go:<job>       — в очередь;  uv:r:<job> — повторить после ошибки

export const TYPES: Record<string, string> = {
  cats: "Котики", nature: "Природа", art: "Картины / абстракция",
  city: "Города / архитектура", objects: "Предметы / еда", disclaimer: "Дисклеймер",
};
const OPEN = ["choosing", "queued", "processing", "ready", "replacing"];

interface Job {
  id: string; ad_id: string; chat_id: number; thread_id: number | null; source_name: string;
  tail_type: string; frame_type: string; status: string; result_key: string | null;
}

const db = () => warehouse();
const say = (p: Place, text: string, extra: Record<string, unknown> = {}) => sendMessage(p.chatId, text, p.threadId, extra);
const kb = (rows: { text: string; data: string }[][]) => ({ inline_keyboard: rows.map((r) => r.map((b) => ({ text: b.text, callback_data: b.data }))) });

function tailMenu(j: Job) {
  return {
    text: `🎬 <b>Уникализация</b> · ${escapeHtml(j.source_name)}\nПосле обработки видео заменит креатив в объявлении ${j.ad_id}.\n\n` +
      "Что вставить после 30 секунд чёрного экрана? Вставка — 5–10 минут; дисклеймер — до конца ролика около десятой минуты.",
    reply_markup: kb([
      ...Object.entries(TYPES).map(([k, l]) => [{ text: `${j.tail_type === k ? "✓ " : ""}${l}`, data: `uv:t:${j.id}:${k}` }]),
      [{ text: "Выбрать первый / последний кадр →", data: `uv:f:${j.id}` }],
    ]),
  };
}

function frameMenu(j: Job) {
  return {
    text: `🎬 <b>Уникализация</b> · ${escapeHtml(j.source_name)}\nВставка: ${TYPES[j.tail_type]}\n\n` +
      "Что поставить перед крео и сразу после него? Каждая вставка — один кадр (1/30 секунды), само крео не пережимается.",
    reply_markup: kb([
      ...Object.entries(TYPES).map(([k, l]) => [{ text: `${j.frame_type === k ? "✓ " : ""}${l}`, data: `uv:F:${j.id}:${k}` }]),
      [{ text: "← Вставка", data: `uv:b:${j.id}` }, { text: "▶ Обработать", data: `uv:go:${j.id}` }],
    ]),
  };
}

// Нажали кнопку под алертом. Проверки — те же, что у остальных кнопок антиотклона.
export async function startUniq(ctx: Ctx): Promise<void> {
  const w = await writer(ctx);
  if (typeof w === "string") return void (await say(ctx.place, w));
  const { detail } = w;
  if (!REJECTED.includes(detail.ad.effective_status)) return void (await say(ctx.place, "Объявление уже не отклонено."));
  if (!detail.creative.object_story_spec?.video_data?.video_id) return void (await say(ctx.place, "Это не видеокреатив — уникализировать нечего."));

  const { data: open } = await db().from("video_variant_jobs").select("id, ad_id, chat_id, thread_id, source_name, tail_type, frame_type, status, result_key")
    .eq("ad_id", ctx.adId).in("status", OPEN).limit(1);
  if (open?.length) {
    const j = open[0] as Job;
    if (j.status !== "choosing") return void (await say(ctx.place, "Для этого объявления уже идёт уникализация — результат придёт сюда."));
    const m = tailMenu(j);
    return void (await say(ctx.place, m.text, { reply_markup: m.reply_markup }));
  }

  const key = await findSource(detail.ad.name);
  if (!key) return void (await say(ctx.place, `Исходник v1 не найден в библиотеке: <b>${escapeHtml(v1Name(detail.ad.name))}</b>. Загрузи v1 в дашборд и нажми ещё раз.`));
  const { data, error } = await db().from("video_variant_jobs").insert({
    ad_id: ctx.adId, account_id: ctx.accountId, owner_id: ctx.ownerId, chat_id: ctx.place.chatId, thread_id: ctx.place.threadId,
    source_key: key, source_name: key.split("/").pop()!,
  }).select("id, ad_id, chat_id, thread_id, source_name, tail_type, frame_type, status, result_key").single();
  if (error) throw new Error(error.message);
  const m = tailMenu(data as Job);
  await say(ctx.place, m.text, { reply_markup: m.reply_markup });
}

export interface UvQuery { id: string; data?: string; message?: { message_id: number; chat: { id: number }; message_thread_id?: number; is_topic_message?: boolean } }

export async function handleUniq(q: UvQuery): Promise<void> {
  await tg("answerCallbackQuery", { callback_query_id: q.id }).catch(() => undefined);
  const msg = q.message;
  if (!msg) return;
  const place: Place = { chatId: msg.chat.id, threadId: msg.is_topic_message && msg.message_thread_id ? msg.message_thread_id : null };
  const [, cmd, id, value] = (q.data ?? "").split(":");
  try {
    const { data } = await db().from("video_variant_jobs").select("id, ad_id, chat_id, thread_id, source_name, tail_type, frame_type, status, result_key").eq("id", id).maybeSingle();
    const j = data as Job | null;
    // Только там, где задание заведено: это чат владельца кабинета.
    if (!j || Number(j.chat_id) !== msg.chat.id) return void (await say(place, "Настройки уникализации устарели — нажми кнопку под алертом ещё раз."));
    const edit = (m: { text: string; reply_markup: unknown }) =>
      tg("editMessageText", { chat_id: msg.chat.id, message_id: msg.message_id, text: m.text, parse_mode: "HTML", reply_markup: m.reply_markup }).catch(() => undefined);

    if (cmd === "r") return await retry(j, place);
    if (j.status !== "choosing") return void (await say(place, "Это задание уже запущено — результат придёт сюда."));
    if (cmd === "t" && TYPES[value]) {
      await db().from("video_variant_jobs").update({ tail_type: value, updated_at: new Date().toISOString() }).eq("id", id);
      return void (await edit(tailMenu({ ...j, tail_type: value })));
    }
    if (cmd === "F" && TYPES[value]) {
      await db().from("video_variant_jobs").update({ frame_type: value, updated_at: new Date().toISOString() }).eq("id", id);
      return void (await edit(frameMenu({ ...j, frame_type: value })));
    }
    if (cmd === "f") return void (await edit(frameMenu(j)));
    if (cmd === "b") return void (await edit(tailMenu(j)));
    if (cmd === "go") {
      // Объявление могли успеть поправить, пока выбирали.
      const ctx = await context(place, j.ad_id);
      if (typeof ctx === "string") return void (await say(place, ctx));
      const { data: ok } = await db().from("video_variant_jobs").update({ status: "queued", updated_at: new Date().toISOString() })
        .eq("id", id).eq("status", "choosing").select("id");
      if (!ok?.length) return;
      await edit({ text: `🎬 <b>Уникализация</b> · ${escapeHtml(j.source_name)}\nВставка: ${TYPES[j.tail_type]} · кадры: ${TYPES[j.frame_type]}\n\n⏳ В очереди. Смонтирую, загружу в кабинет и заменю креатив в объявлении — результат придёт сюда.`, reply_markup: { inline_keyboard: [] } });
    }
  } catch (e) {
    await say(place, `Не получилось: ${escapeHtml((e instanceof Error ? e.message : String(e)).slice(0, 600))}`).catch(() => undefined);
  }
}

// Повтор после ошибки: видео есть — только замена в Meta, нет — монтаж заново.
async function retry(j: Job, place: Place): Promise<void> {
  if (j.status !== "failed") return void (await say(place, "Задание не в ошибке — повторять нечего."));
  const next = j.result_key ? "ready" : "queued";
  await db().from("video_variant_jobs").update({ status: next, error: null, updated_at: new Date().toISOString() }).eq("id", j.id).eq("status", "failed");
  await say(place, j.result_key ? "Повторяю замену креатива в Meta." : "Ставлю монтаж в очередь заново.");
  if (next === "ready") await (await import("./replace")).replaceInMeta(j.id);
}
