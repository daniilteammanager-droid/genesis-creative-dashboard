import { warehouse } from "@/lib/warehouse/read";
import { escapeHtml, sendMessage } from "@/lib/telegram/api";
import { writer } from "@/lib/antireject/bot";
import { applyChange, uploadVideo } from "@/lib/antireject/meta";
import { publicUrl } from "./source";
import { logEvent } from "@/lib/antireject/events";

// Готовое видео — в кабинет и в объявление (Decision 076). Ключ — Meta владельца
// кабинета с ads_management, как у остальных кнопок антиотклона. Креатив
// переписывается в самом объявлении; перед записью applyChange сверяет, что
// объявление то же и всё ещё отклонено.

const db = () => warehouse();

export async function replaceInMeta(id: string): Promise<void> {
  const { data: j } = await db().from("video_variant_jobs").update({ status: "replacing", stage: "Загружаю видео в кабинет", updated_at: new Date().toISOString() })
    .eq("id", id).eq("status", "ready").select("*").maybeSingle();
  if (!j) return;
  const place = { chatId: Number(j.chat_id), threadId: j.thread_id === null ? null : Number(j.thread_id) };
  const url = publicUrl(j.result_key as string);
  // Из библиотеки (Decision 083): объявления нет — видео просто готово, ссылка на странице.
  if (!j.ad_id) {
    await db().from("video_variant_jobs").update({ status: "done", stage: "Готово — скачай видео", updated_at: new Date().toISOString() }).eq("id", id);
    return;
  }
  const tell = (text: string, extra: Record<string, unknown> = {}) =>
    j.chat_id ? sendMessage(place.chatId, text, place.threadId, extra).catch(() => undefined) : Promise.resolve();
  try {
    const w = await writer({ place, adId: j.ad_id, accountId: j.account_id, ownerId: j.owner_id });
    if (typeof w === "string") throw new Error(w);
    const video = await uploadVideo(w.token, j.account_id, url, j.source_name.replace(/\.\w+$/, "") + " · unique");
    const res = await applyChange(w.token, {
      adId: j.ad_id, accountId: j.account_id, creativeId: w.detail.creative.id,
      adName: w.detail.ad.name, campaignName: w.detail.ad.campaign?.name ?? "",
      change: { type: "video", videoId: video.videoId, imageUrl: video.imageUrl }, describe: "Новое видео",
    });
    // Забываем отклонение: снова отклонят — придёт новый алерт.
    await db().from("wh_rejected_ads").delete().eq("ad_id", j.ad_id);
    await logEvent({ kind: "action", adId: j.ad_id, accountId: j.account_id, adName: w.detail.ad.name, campaignName: w.detail.ad.campaign?.name ?? "",
      ownerId: j.owner_id, actor: j.chat_id ? "Telegram" : "Дашборд", text: "Уникализация: новое видео", ok: true, status: res.status });
    await db().from("video_variant_jobs").update({
      status: "done", stage: "Креатив заменён", meta: { ...video, ...res }, updated_at: new Date().toISOString(),
    }).eq("id", id);
    await tell(
      `✅ <b>Уникализация готова</b> · ${escapeHtml(w.detail.ad.name)}\nВидео заменено в объявлении ${j.ad_id}. Статус Meta: ${res.status} — одобрение ещё не подтверждено, если снова отклонят, придёт алерт.\n` +
      `Длительность: ${Math.round(Number(j.duration ?? 0))} с · <a href="${url}">скачать видео</a>`);
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 600);
    await db().from("video_variant_jobs").update({ status: "failed", error, updated_at: new Date().toISOString() }).eq("id", id);
    await tell(`Уникализация: видео готово, но заменить креатив не вышло — ${escapeHtml(error)}\n<a href="${url}">Скачать видео</a>`,
      { reply_markup: { inline_keyboard: [[{ text: "Повторить замену", callback_data: `uv:r:${id}` }]] } });
  }
}

// Монтаж упал на воркере.
export async function renderFailed(id: string, error: string): Promise<void> {
  // Отменённое и готовое ошибкой не перетираем: воркер мог доложить о сбое уже после «Отменить».
  const { data: j } = await db().from("video_variant_jobs").update({ status: "failed", error: error.slice(0, 600), updated_at: new Date().toISOString() })
    .eq("id", id).in("status", ["choosing", "queued", "processing", "ready", "replacing"]).select("chat_id, thread_id, source_name").maybeSingle();
  if (!j?.chat_id) return;
  await sendMessage(Number(j.chat_id), `Уникализация ${escapeHtml(j.source_name)} остановлена: ${escapeHtml(error.slice(0, 600))}`, j.thread_id === null ? null : Number(j.thread_id),
    { reply_markup: { inline_keyboard: [[{ text: "Повторить", callback_data: `uv:r:${id}` }]] } }).catch(() => undefined);
}
