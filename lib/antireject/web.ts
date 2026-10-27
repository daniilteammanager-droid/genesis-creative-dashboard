import { randomBytes } from "node:crypto";
import { warehouse } from "@/lib/warehouse/read";
import { getConnection } from "@/lib/connections/store";
import { metaTokensOf } from "@/lib/connections/metaKeys";
import { listLandings } from "@/lib/torro/mcp";
import type { Profile } from "@/lib/auth/types";
import { writer, type Ctx } from "./bot";
import { accountPages, applyChange, currentLink, REJECTED, type Change, type Preview } from "./meta";
import { host, landingChoices, makeLink } from "./landings";
import { logEvent } from "./events";

// Кнопки антиотклона на странице (Decision 091) — те же три действия, что в боте
// (Decision 067): замена ссылки, ФП, Multi-advertiser. Тот же путь: варианты → изменение под
// одноразовым кодом → «подтвердить» → запись ключом Meta владельца с ads_management.
// Нажать может владелец кабинета и владелец дашборда — как в Live Manager.

const db = () => warehouse();
const PENDING_TTL_MS = 3600_000;
export type Kind = "link" | "page" | "multi";

async function ctxFor(me: Profile, adId: string): Promise<Ctx> {
  const { data: ad } = await db().from("wh_rejected_ads").select("account_id").eq("ad_id", adId).maybeSingle();
  if (!ad) throw new Error("Этого объявления уже нет среди отклонённых — возможно, его одобрили или уже поправили");
  if (adId.startsWith("tg:")) throw new Error("Это TG Ads — менять можно только в кабинете Telegram");
  const { data: own } = await db().from("wh_account_owners").select("owner_user_id").eq("account_id", ad.account_id).maybeSingle();
  const ownerId = own?.owner_user_id as string | undefined;
  if (!ownerId) throw new Error("Кабинет ни за кем не закреплён — менять объявление некому");
  if (ownerId !== me.id && me.role !== "main") throw new Error("Менять может владелец кабинета");
  return { place: { chatId: 0, threadId: null }, adId, accountId: ad.account_id as string, ownerId };
}

async function writerOf(ctx: Ctx) {
  const w = await writer(ctx);
  if (typeof w === "string") throw new Error(w);
  if (!REJECTED.includes(w.detail.ad.effective_status)) throw new Error("Объявление уже не отклонено");
  return w;
}

// Варианты для выбора.
export async function options(me: Profile, adId: string, kind: Kind) {
  const ctx = await ctxFor(me, adId);
  const w = await writerOf(ctx);
  const d = w.detail;
  if (kind === "link") {
    const conn = await getConnection(ctx.ownerId);
    if (!conn?.torroToken) throw new Error("Лендинги берутся из Torro, а он у владельца не подключён");
    const url = currentLink(d.creative);
    const c = landingChoices(url, await listLandings(conn.torroToken), d.ad.campaign?.name ?? "", 10);
    return {
      now: `${c.current?.name ?? "лендинг не из списка Torro"} · ${host(url)}`, reason: c.reason ?? null,
      choices: c.candidates.map((l) => ({ value: String(l.id), label: `${l.name} · ${host(l.url)}` })),
    };
  }
  if (kind === "page") {
    const now = d.creative.object_story_spec?.page_id ?? "";
    const pages = (await accountPages(w.token, ctx.accountId)).filter((p) => p.id !== now);
    return { now: `ID ${now || "—"}`, reason: pages.length ? null : "других страниц в этом кабинете не нашлось",
      choices: pages.slice(0, 30).map((p) => ({ value: p.id, label: `${p.name} · ${p.id}` })) };
  }
  const now = d.creative.contextual_multi_ads?.enroll_status;
  if (!now) throw new Error("Meta не отдала настройку Multi-advertiser для этого креатива");
  const next = now === "OPT_IN" ? "OPT_OUT" : "OPT_IN";
  return { now, reason: null, choices: [{ value: next, label: `Переключить на ${next}` }] };
}

// Выбор → изменение под одноразовым кодом, его и надо подтвердить.
export async function preview(me: Profile, adId: string, kind: Kind, value: string): Promise<{ nonce: string; describe: string; adName: string; campaignName: string }> {
  const ctx = await ctxFor(me, adId);
  const w = await writerOf(ctx);
  const d = w.detail;
  let change: Change, describe: string;
  if (kind === "link") {
    const conn = await getConnection(ctx.ownerId);
    const url = currentLink(d.creative);
    const landing = landingChoices(url, await listLandings(conn?.torroToken ?? ""), d.ad.campaign?.name ?? "", 10).candidates.find((l) => String(l.id) === value);
    if (!landing) throw new Error("Этого лендинга уже нет среди вариантов — открой выбор заново");
    change = { type: "link", newUrl: makeLink(url, landing) };
    describe = `Новая ссылка: ${change.newUrl}`;
  } else if (kind === "page") {
    if (!/^\d+$/.test(value)) throw new Error("Неверный ID страницы");
    change = { type: "page", pageId: value };
    describe = `Новая ФП: ID ${value}`;
  } else {
    if (value !== "OPT_IN" && value !== "OPT_OUT") throw new Error("Неверное значение");
    change = { type: "multi", enrollStatus: value };
    describe = `Multi-advertiser: ${value}`;
  }
  const p: Preview = { adId, accountId: ctx.accountId, creativeId: d.creative.id, adName: d.ad.name, campaignName: d.ad.campaign?.name ?? "", change, describe };
  const nonce = randomBytes(6).toString("hex");
  const { error } = await db().from("anti_reject_pending").insert({ nonce, user_id: me.id, ad_id: adId, preview: p });
  if (error) throw new Error(error.message);
  return { nonce, describe, adName: p.adName, campaignName: p.campaignName };
}

export async function confirm(me: Profile, nonce: string): Promise<{ status: string; describe: string }> {
  // Код удаляется до записи: двойной клик не запишет дважды.
  const { data } = await db().from("anti_reject_pending").delete().eq("nonce", nonce).eq("user_id", me.id).select("ad_id, preview, created_at").maybeSingle();
  if (!data) throw new Error("Это изменение уже подтверждено или отменено");
  if (Date.now() - Date.parse(data.created_at as string) > PENDING_TTL_MS) throw new Error("Подтверждение устарело — выбери заново");
  const p = data.preview as Preview;
  const ctx = await ctxFor(me, p.adId);
  const w = await writerOf(ctx);
  try {
    const r = await applyChange(w.token, p);
    // Забываем отклонение: если повторная проверка снова отклонит, придёт новый алерт.
    await db().from("wh_rejected_ads").delete().eq("ad_id", p.adId);
    await logEvent({ kind: "action", adId: p.adId, accountId: p.accountId, adName: p.adName, campaignName: p.campaignName, ownerId: ctx.ownerId, actor: me.name || me.email, text: p.describe, ok: true, status: r.status });
    return { status: r.status, describe: p.describe };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logEvent({ kind: "action", adId: p.adId, accountId: p.accountId, adName: p.adName, campaignName: p.campaignName, ownerId: ctx.ownerId, actor: me.name || me.email, text: `${p.describe} — ${msg}`, ok: false });
    throw e;
  }
}

// «Проверить сейчас»: какие ключи читать — свои кабинеты (владельцу и тимлиду — команды).
// Только Meta: у Dolphin и FB Tool отклонённые приходят с прогоном склада.
export async function scanTokens(me: Profile): Promise<Map<string, string>> {
  let q = db().from("wh_account_owners").select("account_id, owner_user_id");
  if (me.role === "buyer") q = q.eq("owner_user_id", me.id);
  const { data: own } = await q;
  const { data: st } = await db().from("wh_cabinet_states").select("account_id, status").in("account_id", (own ?? []).map((o) => o.account_id as string));
  const live = new Set((st ?? []).filter((s) => s.status === "ACTIVE").map((s) => s.account_id as string));
  const tokens = new Map<string, string>();
  const keyOf = new Map<string, string | null>();
  for (const o of own ?? []) {
    const acc = o.account_id as string, owner = o.owner_user_id as string;
    if (!live.has(acc)) continue;
    if (!keyOf.has(owner)) keyOf.set(owner, (await metaTokensOf(owner))[0]?.token ?? null);
    const t = keyOf.get(owner);
    if (t) tokens.set(acc, t);
  }
  return tokens;
}
