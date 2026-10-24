import { randomBytes } from "node:crypto";
import { warehouse } from "@/lib/warehouse/read";
import { metaTokensOf } from "@/lib/connections/metaKeys";
import { getConnection } from "@/lib/connections/store";
import { listLandings } from "@/lib/torro/mcp";
import { escapeHtml, linksInPlace } from "@/lib/telegram/links";
import { sendMessage, tg } from "@/lib/telegram/api";
import { accountPages, adDetail, applyChange, currentLink, REJECTED, type AdDetail, type Change, type Preview } from "./meta";
import { host, landingChoices, makeLink } from "./landings";

// Кнопки антиотклона под алертом об отклонении (Decision 067).
//
//   ar:l|p|m:<ad>         — открыть выбор: ссылка, страница, Multi-advertiser
//   ar:L|P|M:<ad>:<что>   — выбрано: собрать изменение и спросить подтверждение
//   ar:ok|no:<код>        — подтвердить и записать в Meta / отменить
//
// Нажать может любой в чате, но только в чате, привязанном к владельцу кабинета:
// баер сам выбрал, куда слать свои алерты. Пишем ключом Meta владельца с
// ads_management — ничьим другим и никогда токеном аккаунта.

const PENDING_TTL_MS = 3600_000;

interface Place { chatId: number; threadId: number | null }
interface Ctx { place: Place; adId: string; accountId: string; ownerId: string }

const say = (p: Place, text: string, extra: Record<string, unknown> = {}) => sendMessage(p.chatId, text, p.threadId, extra);
const keyboard = (rows: { text: string; data: string }[][]) =>
  ({ reply_markup: { inline_keyboard: rows.map((r) => r.map((b) => ({ text: b.text.slice(0, 60), callback_data: b.data }))) } });

// Кнопки под алертом. Только для кабинетов на Meta: у Dolphin и FB Tool писать нечем.
export function actionButtons(adId: string) {
  return [
    [{ text: "🔗 Заменить ссылку", callback_data: `ar:l:${adId}` }],
    [{ text: "📄 Поменять ФП", callback_data: `ar:p:${adId}` }, { text: "🔁 Multi-advertiser", callback_data: `ar:m:${adId}` }],
  ];
}

// Чьё объявление и можно ли тут жать. Ответ — контекст или текст отказа.
async function context(place: Place, adId: string): Promise<Ctx | string> {
  const db = warehouse();
  const { data: ad } = await db.from("wh_rejected_ads").select("account_id").eq("ad_id", adId).maybeSingle();
  if (!ad) return "Этого объявления уже нет среди отклонённых — возможно, его одобрили или уже поправили.";
  const { data: own } = await db.from("wh_account_owners").select("owner_user_id").eq("account_id", ad.account_id).maybeSingle();
  const ownerId = own?.owner_user_id as string | undefined;
  if (!ownerId) return "Кабинет ни за кем не закреплён — менять объявление некому.";
  const links = await linksInPlace(place.chatId, place.threadId);
  if (!links.some((l) => l.user_id === ownerId)) return "Кнопки работают только в чате, привязанном к владельцу кабинета.";
  return { place, adId, accountId: ad.account_id as string, ownerId };
}

// Ключ владельца, которым это объявление видно и можно менять.
async function writer(ctx: Ctx): Promise<{ token: string; detail: AdDetail } | string> {
  const keys = (await metaTokensOf(ctx.ownerId)).filter((k) => k.canWrite);
  if (keys.length === 0) {
    const c = await getConnection(ctx.ownerId).catch(() => null);
    return c?.spendSource === "dolphin"
      ? "Кабинет подключён через Dolphin — менять объявления можно только через ключ Meta."
      : "У ключей Meta владельца нет права ads_management. Выпусти ключ с этим правом в Настройках → Интеграции.";
  }
  let last = "";
  for (const k of keys) {
    try {
      const detail = await adDetail(k.token, ctx.adId);
      if (detail.ad.account_id.replace(/^act_/, "") === ctx.accountId) return { token: k.token, detail };
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
  }
  return `Ни один ключ Meta владельца не видит это объявление${last ? `: ${last}` : ""}.`;
}

async function openMenu(kind: string, ctx: Ctx): Promise<void> {
  const w = await writer(ctx);
  if (typeof w === "string") return void (await say(ctx.place, w));
  const { detail } = w;
  if (!REJECTED.includes(detail.ad.effective_status)) return void (await say(ctx.place, "Объявление уже не отклонено."));
  const name = escapeHtml(detail.ad.name);

  if (kind === "l") {
    const conn = await getConnection(ctx.ownerId);
    if (!conn?.torroToken) return void (await say(ctx.place, "Лендинги берутся из Torro, а он у владельца не подключён."));
    const url = currentLink(detail.creative);
    const c = landingChoices(url, await listLandings(conn.torroToken), detail.ad.campaign?.name ?? "");
    if (!c.candidates.length) return void (await say(ctx.place, `Заменить ссылку для <b>${name}</b> не на что: ${escapeHtml(c.reason ?? "")}.`));
    await say(ctx.place, `Новый лендинг для <b>${name}</b>\nСейчас: ${escapeHtml(c.current?.name ?? "лендинг не из списка Torro")} · ${escapeHtml(host(url))}`,
      keyboard(c.candidates.map((l) => [{ text: `${l.name} · ${host(l.url)}`, data: `ar:L:${ctx.adId}:${l.id}` }])));
  } else if (kind === "p") {
    const now = detail.creative.object_story_spec?.page_id ?? "";
    const pages = (await accountPages(w.token, ctx.accountId)).filter((p) => p.id !== now);
    if (!pages.length) return void (await say(ctx.place, "Других страниц в этом кабинете не нашлось."));
    await say(ctx.place, `Новая ФП для <b>${name}</b>\nСейчас: ID ${escapeHtml(now || "—")}`,
      keyboard(pages.slice(0, 20).map((p) => [{ text: `${p.name} · ${p.id}`, data: `ar:P:${ctx.adId}:${p.id}` }])));
  } else {
    const now = detail.creative.contextual_multi_ads?.enroll_status;
    if (!now) return void (await say(ctx.place, "Meta не отдала настройку Multi-advertiser для этого креатива."));
    const next = now === "OPT_IN" ? "OPT_OUT" : "OPT_IN";
    await say(ctx.place, `Multi-advertiser у <b>${name}</b> сейчас ${now}.`,
      keyboard([[{ text: `Переключить на ${next}`, data: `ar:M:${ctx.adId}:${next === "OPT_IN" ? 1 : 0}` }]]));
  }
}

// Выбрано — собираем изменение, кладём под одноразовый код, спрашиваем «точно?».
async function pick(kind: string, arg: string, ctx: Ctx): Promise<void> {
  const w = await writer(ctx);
  if (typeof w === "string") return void (await say(ctx.place, w));
  const { detail } = w;
  let change: Change, describe: string;
  if (kind === "L") {
    const conn = await getConnection(ctx.ownerId);
    const url = currentLink(detail.creative);
    const landing = landingChoices(url, await listLandings(conn?.torroToken ?? ""), detail.ad.campaign?.name ?? "").candidates.find((l) => String(l.id) === arg);
    if (!landing) return void (await say(ctx.place, "Этого лендинга уже нет среди вариантов — открой выбор заново."));
    change = { type: "link", newUrl: makeLink(url, landing) };
    describe = `Новая ссылка: ${change.newUrl}`;
  } else if (kind === "P") {
    change = { type: "page", pageId: arg };
    describe = `Новая ФП: ID ${arg}`;
  } else {
    change = { type: "multi", enrollStatus: arg === "1" ? "OPT_IN" : "OPT_OUT" };
    describe = `Multi-advertiser: ${change.enrollStatus}`;
  }
  const preview: Preview = {
    adId: ctx.adId, accountId: ctx.accountId, creativeId: detail.creative.id,
    adName: detail.ad.name, campaignName: detail.ad.campaign?.name ?? "", change, describe,
  };
  const nonce = randomBytes(6).toString("hex");
  const { error } = await warehouse().from("anti_reject_pending").insert({ nonce, user_id: ctx.ownerId, ad_id: ctx.adId, preview });
  if (error) throw new Error(error.message);
  await say(ctx.place,
    `<b>Подтверди изменение</b>\nОбъявление: ${escapeHtml(preview.adName)}\nКампания: ${escapeHtml(preview.campaignName)}\n${escapeHtml(describe)}\n\n` +
    "Объявление уйдёт на повторную проверку Meta.",
    keyboard([[{ text: "✅ Подтвердить и отправить в Meta", data: `ar:ok:${nonce}` }], [{ text: "Отмена", data: `ar:no:${nonce}` }]]));
}

async function confirm(nonce: string, place: Place, ok: boolean): Promise<void> {
  const db = warehouse();
  // Код удаляется до записи: второй клик по той же кнопке не запишет дважды.
  const { data } = await db.from("anti_reject_pending").delete().eq("nonce", nonce).select("ad_id, preview, created_at").maybeSingle();
  if (!ok) return void (await say(place, data ? "Отменено." : "Это действие уже закрыто."));
  if (!data || Date.now() - Date.parse(data.created_at as string) > PENDING_TTL_MS) {
    return void (await say(place, "Подтверждение устарело — открой действие заново."));
  }
  const ctx = await context(place, data.ad_id as string);
  if (typeof ctx === "string") return void (await say(place, ctx));
  const w = await writer(ctx);
  if (typeof w === "string") return void (await say(place, w));
  const preview = data.preview as Preview;
  const result = await applyChange(w.token, preview);
  // Забываем отклонение: если повторная проверка снова отклонит, придёт новый алерт.
  await db.from("wh_rejected_ads").delete().eq("ad_id", preview.adId);
  await say(place, `✅ Meta приняла изменение <b>${escapeHtml(preview.adName)}</b>.\n${escapeHtml(preview.describe)}\nСтатус сейчас: ${result.status}. Одобрение ещё не подтверждено — если снова отклонят, придёт алерт.`);
}

export interface CallbackQuery {
  id: string;
  data?: string;
  message?: { chat: { id: number }; message_thread_id?: number; is_topic_message?: boolean };
}

export async function handleAntiReject(q: CallbackQuery): Promise<void> {
  // Часики на кнопке гасим сразу: всё остальное может занять несколько секунд.
  await tg("answerCallbackQuery", { callback_query_id: q.id }).catch(() => undefined);
  const msg = q.message;
  if (!msg) return;
  const place: Place = { chatId: msg.chat.id, threadId: msg.is_topic_message && msg.message_thread_id ? msg.message_thread_id : null };
  const [, kind, a, b] = (q.data ?? "").split(":");
  try {
    if (kind === "ok" || kind === "no") return await confirm(a, place, kind === "ok");
    if (!/^\d+$/.test(a ?? "")) return;
    const ctx = await context(place, a);
    if (typeof ctx === "string") return void (await say(place, ctx));
    if (["l", "p", "m"].includes(kind)) return await openMenu(kind, ctx);
    if (["L", "P", "M"].includes(kind) && b) return await pick(kind, b, ctx);
  } catch (e) {
    await say(place, `Не получилось: ${escapeHtml((e instanceof Error ? e.message : String(e)).slice(0, 600))}`).catch(() => undefined);
  }
}
