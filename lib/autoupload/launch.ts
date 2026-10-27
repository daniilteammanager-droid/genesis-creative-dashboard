import { warehouse } from "@/lib/warehouse/read";
import { uploadCred } from "./key";
import { proofFor } from "@/lib/meta/proof";
import { usdRate } from "@/lib/fx";
import { mskDay } from "@/lib/day";
import { originalKey, publicUrl } from "@/lib/uniq/source";
import { zonedToUtc, type Plan, type PlanCampaign } from "./plan";

// Автозалив (Decision 081, 087): собранный план → кампании, адсеты и объявления в Meta.
// Шаги — как у Артёма (meta-launch.cjs): CBO-кампания OUTCOME_LEADS, адсет на
// конверсию SUBSCRIBE пикселя, мобильные плейсменты FB/IG, креатив видео или
// картинки с CTA на ссылку MVP, Multi-advertiser выключен.
//
// Функция Vercel живёт 5 минут, а Meta обрабатывает видео минутами. Поэтому
// задание идёт проходами: каждый создаёт, что успеет, и записывает созданное —
// следующий (сразу или кроном раз в минуту) продолжает с того же места. Видео
// загружаются по ссылке R2 все сразу в первом проходе, дальше только ждём готовности.

const GRAPH = "https://graph.facebook.com/v26.0";
const INT_TERMS = ["forex", "trading", "investment"];

type Media = { type: "video" | "image"; id: string; imageUrl?: string; ready: boolean };
// tried — запрос на создание уже уходил: ответа могло не дойти, а объект создаться.
// Перед повтором ищем его по имени у родителя (как createChildWithRetry у Артёма).
interface AdState { id?: string; creativeId?: string; tried?: boolean }
interface AdsetState { id?: string; ads: AdState[]; tried?: boolean }
interface CampaignState { id?: string; adsets: AdsetState[]; tried?: boolean }
export interface JobState {
  created: CampaignState[];
  media: Record<string, Media>;     // «кабинет|ключ R2»
  accounts: Record<string, { currency: string; timezone: string }>;
  instagram?: Record<string, string | null>; // страница → её Instagram
  retries?: number;                 // подряд временных сбоев Meta
}
export interface Job {
  id: string; user_id: string; plan: Plan; status: string; state: JobState | null;
  stage: string | null; error: string | null;
}

// Временный сбой Meta (is_transient, коды 1, 2) — задание не падает, продолжит следующий проход.
export class MetaError extends Error { constructor(msg: string, public transient = false) { super(msg); } }
async function graph<T>(token: string, path: string, params: Record<string, unknown> = {}, method: "GET" | "POST" = "GET"): Promise<T> {
  const flat = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  const body = new URLSearchParams({ ...flat, access_token: token, ...proofFor(token) });
  const res = method === "GET"
    ? await fetch(`${GRAPH}/${path}?${body}`, { signal: AbortSignal.timeout(60_000) })
    : await fetch(`${GRAPH}/${path}`, { method: "POST", body, signal: AbortSignal.timeout(120_000) });
  const j = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; error_user_msg?: string; code?: number; is_transient?: boolean } };
  if (!res.ok || j.error) {
    const transient = Boolean(j.error?.is_transient) || [1, 2].includes(Number(j.error?.code)) || res.status >= 500;
    throw new MetaError(`Meta: ${j.error?.error_user_msg || j.error?.message || `HTTP ${res.status}`}`, transient);
  }
  return j;
}

const db = () => warehouse();
const save = (id: string, patch: Record<string, unknown>) =>
  db().from("autoupload_jobs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);

// Своё приложение автозалива (Decision 093), а без него — ключ статистики с ads_management.
async function writerToken(userId: string): Promise<string> {
  const c = await uploadCred(userId);
  if (!c) throw new Error("Нужен ключ Meta с правом ads_management — подключи приложение для автозалива на его странице");
  return c.token;
}

async function targeting(token: string, a: PlanCampaign["adsets"][number]) {
  const t: Record<string, unknown> = {
    age_min: 18, device_platforms: ["mobile"], geo_locations: { countries: [a.country] },
    publisher_platforms: ["facebook", "instagram"],
    facebook_positions: ["feed", "profile_feed", "story", "facebook_reels"],
    instagram_positions: ["stream", "profile_feed", "story", "reels"],
  };
  if (a.target === "INT") {
    const interests: { id: string; name: string }[] = [];
    for (const q of INT_TERMS) {
      const r = await graph<{ data?: { id: string; name: string }[] }>(token, "search", { type: "adinterest", q, limit: "3" });
      for (const i of r.data ?? []) if (!interests.some((x) => x.id === i.id)) interests.push({ id: String(i.id), name: i.name });
    }
    if (!interests.length) throw new Error(`Meta не вернула интересы для адсета ${a.name}`);
    t.flexible_spec = [{ interests }];
  } else if (a.target === "RETARGET") {
    t.custom_audiences = [{ id: a.customAudienceId }];
  }
  return t;
}

// Загрузить файл в кабинет по ссылке R2 (оригинал, если он сохранён) или проверить готовность.
async function ensureMedia(token: string, accountId: string, key: string, kind: "video" | "image", name: string, state: JobState): Promise<Media | null> {
  const k = `${accountId}|${key}`;
  let m = state.media[k];
  if (!m) {
    const url = publicUrl(await originalKey(key));
    if (kind === "video") {
      const r = await graph<{ id: string }>(token, `act_${accountId}/advideos`, { file_url: url, title: name }, "POST");
      m = { type: "video", id: r.id, ready: false };
    } else {
      const bytes = Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(60_000) })).arrayBuffer()).toString("base64");
      const r = await graph<{ images?: Record<string, { hash: string }> }>(token, `act_${accountId}/adimages`, { bytes, name }, "POST");
      const hash = Object.values(r.images ?? {})[0]?.hash;
      if (!hash) throw new Error(`Meta не вернула hash картинки ${name}`);
      m = { type: "image", id: hash, ready: true };
    }
    state.media[k] = m;
  }
  if (m.type === "video" && !m.ready) {
    const v = await graph<{ status?: { video_status?: string } }>(token, m.id, { fields: "status" });
    const st = String(v.status?.video_status ?? "").toLowerCase();
    if (/error|fail/.test(st)) throw new Error(`Meta не обработала видео ${name}`);
    if (!/ready|complete|published/.test(st)) return null;
    const t = await graph<{ data?: { uri?: string; is_preferred?: boolean }[] }>(token, `${m.id}/thumbnails`, { fields: "uri,is_preferred" });
    const uri = (t.data ?? []).find((x) => x.is_preferred)?.uri ?? t.data?.[0]?.uri;
    if (!uri) return null;
    m.imageUrl = uri;
    m.ready = true;
  }
  return m;
}

// Сумма в долларах → минимальные единицы валюты кабинета (центы, а у иены — иены).
function minor(usd: number, rate: number, currency: string): number {
  let digits = 2;
  try { digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2; } catch { /* центы */ }
  return Math.round((usd / rate) * 10 ** digits);
}

// Уже созданный объект с этим именем у родителя — после оборванного запроса.
async function adopt(token: string, edge: string, name: string): Promise<string | undefined> {
  const r = await graph<{ data?: { id: string; name: string }[] }>(token, edge, { fields: "id,name", limit: "500" });
  const same = (r.data ?? []).filter((x) => x.name === name);
  if (same.length > 1) throw new Error(`В Meta уже несколько объектов «${name}» — проверь вручную, повторять не буду`);
  return same[0]?.id;
}

function storySpec(c: PlanCampaign, text: Plan["text"], m: Media, instagram: string | null) {
  const cta = { type: text.cta, value: { link: c.landingUrl } };
  const spec: Record<string, unknown> = { page_id: c.pageId, ...(instagram ? { instagram_actor_id: instagram } : {}) };
  if (m.type === "video") {
    spec.video_data = { video_id: m.id, image_url: m.imageUrl, call_to_action: cta,
      ...(text.primaryText ? { message: text.primaryText } : {}), ...(text.headline ? { title: text.headline } : {}),
      ...(text.description ? { link_description: text.description } : {}) };
  } else {
    spec.link_data = { link: c.landingUrl, image_hash: m.id, call_to_action: cta,
      ...(text.primaryText ? { message: text.primaryText } : {}), ...(text.headline ? { name: text.headline } : {}),
      ...(text.description ? { description: text.description } : {}) };
  }
  return spec;
}

// Один проход. Возвращает true, когда всё создано.
export async function advance(job: Job, deadline: number): Promise<boolean> {
  const token = await writerToken(job.user_id);
  const plan = job.plan;
  const state: JobState = (job.state ??= { created: [], media: {}, accounts: {} });
  state.instagram ??= {};
  const status = plan.paused ? "PAUSED" : "ACTIVE";
  const stage = (s: string) => save(job.id, { stage: s, state });

  // Кабинеты: живы, валюта и часовой пояс (для бюджета и времени запуска).
  for (const accountId of [...new Set(plan.campaigns.map((c) => c.accountId))]) {
    if (state.accounts[accountId]) continue;
    const a = await graph<{ account_status?: number; disable_reason?: number; currency?: string; timezone_name?: string }>(
      token, `act_${accountId}`, { fields: "account_status,disable_reason,currency,timezone_name" });
    if (a.account_status !== 1 || (a.disable_reason ?? 0) !== 0) throw new Error(`CAB${accountId.slice(-4)} недоступен для автозалива: статус ${a.account_status}${a.disable_reason ? `, ограничение ${a.disable_reason}` : ""}`);
    const px = await graph<{ data?: { id: string }[] }>(token, `act_${accountId}/adspixels`, { fields: "id", limit: "200" });
    const pixel = plan.campaigns.find((c) => c.accountId === accountId)!.pixelId;
    if (!(px.data ?? []).some((x) => x.id === pixel)) throw new Error(`Пиксель ${pixel} не подключён к CAB${accountId.slice(-4)}`);
    state.accounts[accountId] = { currency: a.currency ?? "USD", timezone: a.timezone_name ?? "Europe/Moscow" };
  }
  // Instagram страницы — в объявление, как у Артёма. Нет — только Facebook.
  for (const pageId of [...new Set(plan.campaigns.map((c) => c.pageId))]) {
    if (pageId in state.instagram) continue;
    const pg = await graph<{ instagram_business_account?: { id: string } }>(token, pageId, { fields: "instagram_business_account" }).catch(() => ({}) as { instagram_business_account?: { id: string } });
    state.instagram[pageId] = pg.instagram_business_account?.id ?? null;
  }

  // Все видео — в Meta сразу: обрабатываются параллельно, пока создаются кампании.
  let waiting = 0;
  for (const c of plan.campaigns) for (const a of c.adsets) for (const ad of a.ads) {
    if (Date.now() > deadline) { await stage("Загружаю креативы в кабинет…"); return false; }
    if (!(await ensureMedia(token, c.accountId, ad.key, ad.kind, ad.name, state))) waiting++;
  }
  await stage(waiting ? `Meta обрабатывает видео: ${waiting}` : "Создаю кампании");

  for (let ci = 0; ci < plan.campaigns.length; ci++) {
    const c = plan.campaigns[ci], acc = state.accounts[c.accountId];
    const cs = (state.created[ci] ??= { adsets: [] });
    const rate = await usdRate(acc.currency, mskDay());
    // Bid cap — у Артёма стратегия на кампании и адсете, сумма — на адсете.
    const bidStrategy = c.bidCapUsd !== null ? "LOWEST_COST_WITH_BID_CAP" : "LOWEST_COST_WITHOUT_CAP";
    if (!cs.id) {
      if (Date.now() > deadline) return false;
      if (cs.tried) cs.id = await adopt(token, `act_${c.accountId}/campaigns`, c.name);
      if (!cs.id) {
        cs.tried = true; await stage(`Создаю кампанию ${c.name}`);
        const r = await graph<{ id: string }>(token, `act_${c.accountId}/campaigns`, {
          name: c.name, objective: "OUTCOME_LEADS", status, daily_budget: String(minor(c.budgetUsd, rate, acc.currency)),
          bid_strategy: bidStrategy, special_ad_categories: [],
        }, "POST");
        cs.id = r.id;
      }
      await stage(`Создана кампания ${c.name}`);
    }
    for (let ai = 0; ai < c.adsets.length; ai++) {
      const a = c.adsets[ai];
      const as = (cs.adsets[ai] ??= { ads: [] });
      if (!as.id) {
        if (Date.now() > deadline) return false;
        if (as.tried) as.id = await adopt(token, `${cs.id}/adsets`, a.name);
        if (!as.id) {
          const bidAmount = c.bidCapUsd !== null ? minor(c.bidCapUsd, rate, acc.currency) : null;
          if (bidAmount !== null && !(bidAmount > 0)) throw new Error(`Не рассчитан bid cap кампании ${c.name}`);
          const body = {
            name: a.name, campaign_id: cs.id, status, billing_event: "IMPRESSIONS", optimization_goal: "OFFSITE_CONVERSIONS",
            bid_strategy: bidStrategy, targeting: await targeting(token, a),
            promoted_object: { pixel_id: c.pixelId, custom_event_type: "SUBSCRIBE" },
            start_time: zonedToUtc(c.startLocal, acc.timezone),
            ...(bidAmount !== null ? { bid_amount: String(bidAmount) } : {}),
            ...(c.dsa ? { dsa_beneficiary: c.dsa, dsa_payor: c.dsa } : {}),
          };
          as.tried = true; await stage(`Создаю адсет ${a.name}`);
          as.id = (await graph<{ id: string }>(token, `act_${c.accountId}/adsets`, body, "POST")).id;
        }
        await stage(`Создан адсет ${a.name}`);
      }
      for (let di = 0; di < a.ads.length; di++) {
        const ad = a.ads[di];
        const ds = (as.ads[di] ??= {});
        if (ds.id) continue;
        if (Date.now() > deadline) return false;
        const m = await ensureMedia(token, c.accountId, ad.key, ad.kind, ad.name, state);
        if (!m) { await stage(`Жду, пока Meta обработает видео ${ad.name}`); return false; }
        if (!ds.creativeId) {
          const cr = await graph<{ id: string }>(token, `act_${c.accountId}/adcreatives`, {
            name: ad.name, object_story_spec: storySpec(c, plan.text, m, state.instagram[c.pageId] ?? null), contextual_multi_ads: { enroll_status: "OPT_OUT" },
          }, "POST");
          ds.creativeId = cr.id;
        }
        if (ds.tried) ds.id = await adopt(token, `${as.id}/ads`, ad.name);
        if (!ds.id) {
          ds.tried = true; await stage(`Создаю объявление ${ad.name}`);
          ds.id = (await graph<{ id: string }>(token, `act_${c.accountId}/ads`, {
            name: ad.name, adset_id: as.id, status, creative: { creative_id: ds.creativeId },
          }, "POST")).id;
        }
        await stage(`Создано объявление ${ad.name}`);
      }
    }
  }
  state.retries = 0;
  await save(job.id, { state, stage: plan.paused ? "Создано на паузе" : "Создано и запущено" });
  return true;
}

// Отмена: удалить всё, что успели создать (кампания уносит свои адсеты и объявления).
export async function cancelCreated(job: Job): Promise<string[]> {
  const token = await writerToken(job.user_id);
  const errors: string[] = [];
  for (const c of job.state?.created ?? []) {
    if (!c.id) continue;
    try { await graph(token, c.id, { status: "DELETED" }, "POST"); } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
  }
  return errors;
}
