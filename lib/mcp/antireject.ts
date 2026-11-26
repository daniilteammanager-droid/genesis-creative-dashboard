import { warehouse } from "@/lib/warehouse/read";
import type { Profile } from "@/lib/auth/types";
import { confirm, options, preview, scanTokens, type Kind } from "@/lib/antireject/web";
import { checkRejectedAds } from "@/lib/alerts/rejected";
import { myCreatives } from "@/lib/autoupload/options";
import { TYPES } from "@/lib/uniq/bot";
import { startUniq } from "@/lib/uniq/start";
import { downloadUrl } from "@/lib/uniq/source";
import { mskDay, mskTime } from "@/lib/day";
import { ToolError, type ToolDef } from "./protocol";

// Антиотклон через AI (Decision 129): те же действия и тот же путь, что кнопки на странице «Антиотклон» и в боте
// (lib/antireject/web.ts: варианты → изменение под одноразовым кодом → запись ключом Meta владельца кабинета), и та же
// уникализация (lib/uniq/start.ts). Права те же: объявление своего кабинета, владелец дашборда — любое. Каждое действие —
// в истории антиотклона (antireject_events) с тем, кто нажал. Отклонённые объявления — get_rejects.

interface Ctx { me: Profile; tokenId?: string }
type Tool = ToolDef<Ctx>;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const KINDS: Kind[] = ["link", "page", "multi"];
const tool = <T,>(p: Promise<T>) => p.catch((e: unknown) => { throw new ToolError(e instanceof Error ? e.message : String(e)); });
const at = (iso: string) => `${mskDay(new Date(iso))} ${mskTime(new Date(iso))}`;

const KIND_PROP = { type: "string", enum: KINDS, description: "link — заменить ссылку (лендинг Torro той же воронки на другом домене), page — сменить Facebook-страницу (ФП), multi — переключить Multi-advertiser." };
const AD_PROP = { type: "string", description: "ad_id отклонённого объявления — из get_rejects (отклонено сейчас)." };

const getOptions: Tool = {
  name: "get_antireject_options",
  title: "Антиотклон: варианты",
  description: "Что можно поменять у отклонённого объявления, как кнопки на странице «Антиотклон»: сейчас стоит и варианты на выбор — другие лендинги Torro (link), другие страницы кабинета (page) или переключатель Multi-advertiser (multi). Читает объявление вживую из Meta. Объявление — только Facebook и только отклонённое сейчас (get_rejects, now_rejected).",
  inputSchema: { type: "object", properties: { ad_id: AD_PROP, kind: KIND_PROP }, required: ["ad_id", "kind"], additionalProperties: false },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true, title: "Антиотклон: варианты" },
  async run({ me }, a) {
    const kind = str(a.kind) as Kind;
    if (!KINDS.includes(kind)) throw new ToolError("kind — link, page или multi");
    return tool(options(me, str(a.ad_id), kind));
  },
};

export const MAX_CHANGES = 20;

const change: Tool = {
  name: "antireject_change",
  title: "Антиотклон: поменять",
  description: `Поменять в отклонённых объявлениях ссылку, ФП или Multi-advertiser — как «Подтвердить» на странице «Антиотклон»: запись в Meta ключом владельца кабинета, объявление уходит на повторную модерацию. Одно объявление — ad_id, kind, value; пачкой — changes (до ${MAX_CHANGES}). value — из choices у get_antireject_options. Перед вызовом скажи человеку, что именно поменяется (объявления, было → станет), и дождись «да».`,
  inputSchema: {
    type: "object",
    properties: {
      ad_id: AD_PROP, kind: KIND_PROP, value: { type: "string", description: "value выбранного варианта из get_antireject_options." },
      changes: {
        type: "array", description: `Пачка изменений, до ${MAX_CHANGES}: у каждого свои ad_id, kind и value.`,
        items: { type: "object", properties: { ad_id: AD_PROP, kind: KIND_PROP, value: { type: "string" } }, required: ["ad_id", "kind", "value"] },
      },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true, title: "Антиотклон: поменять" },
  async run({ me }, a) {
    const items = (Array.isArray(a.changes) ? a.changes : [{ ad_id: a.ad_id, kind: a.kind, value: a.value }]) as Record<string, unknown>[];
    if (!items.length || items.length > MAX_CHANGES) throw new ToolError(`За раз — от 1 до ${MAX_CHANGES} изменений`);
    for (const x of items) {
      if (!str(x.ad_id) || !str(x.value)) throw new ToolError("У каждого изменения нужны ad_id и value");
      if (!KINDS.includes(str(x.kind) as Kind)) throw new ToolError("kind — link, page или multi");
    }
    // По одному, как кнопки: упавшее не останавливает остальные, каждое — своей строкой в истории антиотклона.
    const done: unknown[] = [], failed: unknown[] = [];
    for (const x of items) {
      try {
        const p = await preview(me, str(x.ad_id), str(x.kind) as Kind, str(x.value));
        const r = await confirm(me, p.nonce);
        done.push({ ad_id: str(x.ad_id), ad: p.adName, campaign: p.campaignName, change: r.describe, status_after: r.status });
      } catch (e) {
        failed.push({ ad_id: str(x.ad_id), error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (!done.length) throw new ToolError(`Ничего не поменялось: ${failed.map((f) => `${(f as { ad_id: string }).ad_id} — ${(f as { error: string }).error}`).join("; ")}`);
    return { done, failed: failed.length ? failed : undefined, note: "Записано в Meta и в историю антиотклона. Объявления снова на модерации — итог появится в get_rejects." };
  },
};

const SCAN_GAP_MS = 5 * 60_000;

const checkNow: Tool = {
  name: "check_rejects_now",
  title: "Антиотклон: проверить сейчас",
  description: "Найти отклонённые объявления в своих кабинетах Meta прямо сейчас, не дожидаясь прогона (раз в 15 минут) — как «Проверить сейчас» на странице «Антиотклон». Новые отклонения сразу попадут в get_rejects и, как обычно, алертом в Telegram. Только Meta: Dolphin и FB Tool приходят с прогоном склада. Не чаще раза в 5 минут.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Антиотклон: проверить сейчас" },
  async run({ me }) {
    const { data } = await warehouse().from("mcp_calls").select("created_at").eq("user_id", me.id).eq("tool", "check_rejects_now").eq("ok", true)
      .gte("created_at", new Date(Date.now() - SCAN_GAP_MS).toISOString()).limit(1);
    if (data?.length) throw new ToolError("Проверял меньше 5 минут назад — отклонённые уже в get_rejects");
    const tokens = await scanTokens(me);
    if (!tokens.size) return { accounts: 0, note: "Живых кабинетов Meta с ключом нет — проверять нечего" };
    const r = await tool(checkRejectedAds(tokens));
    return { accounts: tokens.size, rejected_now: r.rejected, new: r.fresh, failed_accounts: r.failedAccounts || undefined };
  },
};

const history: Tool = {
  name: "get_antireject_history",
  title: "Антиотклон: история",
  description: "История антиотклона, как на странице: новые отклонения и все действия — из бота, со страницы, от AI и уникализации: когда, объявление, кампания, кто нажал, что сделано, приняла ли Meta (ok) и статус после. Баер видит свои кабинеты, владелец и тимлид — все.",
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["rejected", "action"], description: "rejected — только отклонения, action — только действия. Пусто — всё." },
      ad_id: { type: "string", description: "История одного объявления." },
      limit: { type: "integer", description: "Сколько событий, 1–200. По умолчанию 50, новые первыми." },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false, title: "Антиотклон: история" },
  async run({ me }, a) {
    const db = warehouse();
    const limit = Math.min(200, Math.max(1, Number.isInteger(a.limit) ? (a.limit as number) : 50));
    let q = db.from("antireject_events").select("created_at, kind, ad_id, ad_name, campaign_name, actor, text, ok, status").order("created_at", { ascending: false }).limit(limit);
    // Как /api/antireject: баеру — его кабинеты и его строки TG Ads.
    if (me.role === "buyer") {
      const { data: own } = await db.from("wh_account_owners").select("account_id").eq("owner_user_id", me.id);
      q = q.or(`account_id.in.(${(own ?? []).map((r) => r.account_id as string).join(",") || "0"}),owner_user_id.eq.${me.id}`);
    }
    if (str(a.kind) === "rejected" || str(a.kind) === "action") q = q.eq("kind", str(a.kind));
    if (str(a.ad_id)) q = q.eq("ad_id", str(a.ad_id));
    const { data } = await q;
    return {
      events: (data ?? []).map((e) => ({
        at: at(e.created_at as string), kind: e.kind === "action" ? "действие" : "отклонение", ad_id: e.ad_id, ad: e.ad_name ?? undefined, campaign: e.campaign_name ?? undefined,
        by: e.actor ?? undefined, what: e.text ?? undefined, ok: e.ok ?? undefined, status: e.status ?? undefined,
      })),
    };
  },
};

const TYPE_PROP = (what: string) => ({ type: "string", enum: Object.keys(TYPES), description: `${what}: ${Object.entries(TYPES).map(([k, v]) => `${k} — ${v}`).join(", ")}.` });

const startUniquify: Tool = {
  name: "start_uniquify",
  title: "Уникализация: запустить",
  description: "Уникализировать видео — как на страницах «Антиотклон» и «Уникализация»: воркер монтирует вставку и кадры (10–15 минут на видео, очередь одна на команду). С ad_id — исходник v1 этого отклонённого объявления, и готовое видео само заменит видео в объявлении Meta. С videos — видео своей Медиатеки (до 30), готовое — файлом, в объявления не ставится. Перед вызовом скажи человеку, что и с какими настройками уйдёт в монтаж, и дождись «да».",
  inputSchema: {
    type: "object",
    properties: {
      ad_id: AD_PROP,
      videos: { type: "array", items: { type: "string" }, description: "Коды или ключи видео своей Медиатеки (get_autoupload_options → creatives), до 30. Вместо ad_id." },
      tail: TYPE_PROP("Вставка"),
      frame: TYPE_PROP("Кадры"),
    },
    required: ["tail", "frame"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true, title: "Уникализация: запустить" },
  async run({ me }, a) {
    const adId = str(a.ad_id);
    const want = Array.isArray(a.videos) ? a.videos.map((x) => String(x).trim()).filter(Boolean) : [];
    if (!adId === !want.length) throw new ToolError("Нужно одно из двух: ad_id или videos");
    let keys: string[] | undefined;
    if (want.length) {
      const videos = (await myCreatives(me)).filter((c) => c.kind === "video");
      const missing: string[] = [];
      keys = want.map((w) => {
        const hit = videos.find((v) => v.key === w || v.code === w.toLowerCase().replace(/\.(mp4|mov)$/, ""));
        if (!hit) missing.push(w);
        return hit?.key ?? "";
      });
      if (missing.length) throw new ToolError(`Нет среди видео твоей Медиатеки: ${missing.join(", ")}`);
    }
    const ids = await tool(startUniq(me, { adId: adId || undefined, keys, tail: str(a.tail), frame: str(a.frame) }));
    return { job_ids: ids, note: "В очереди на монтаж. Ход и ссылки на готовые видео — get_uniquify_jobs." };
  },
};

const STATUS: Record<string, string> = {
  choosing: "Выбор настроек", queued: "В очереди", processing: "Монтаж", ready: "Смонтировано", replacing: "Ставлю в объявление",
  done: "Готово", failed: "Ошибка", cancelled: "Отменено",
};

const getUniqJobs: Tool = {
  name: "get_uniquify_jobs",
  title: "Уникализация: задания",
  description: "Последние задания уникализации, как список на странице: видео, объявление (если было), вставка и кадры, статус, этап, ошибка, ссылка на готовое видео. Баер видит свои, владелец и тимлид — все.",
  inputSchema: { type: "object", properties: { limit: { type: "integer", description: "Сколько заданий, 1–50. По умолчанию 20." } }, additionalProperties: false },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false, title: "Уникализация: задания" },
  async run({ me }, a) {
    const limit = Math.min(50, Math.max(1, Number.isInteger(a.limit) ? (a.limit as number) : 20));
    let q = warehouse().from("video_variant_jobs").select("id, ad_id, source_name, tail_type, frame_type, status, stage, error, result_key, created_at")
      .order("created_at", { ascending: false }).limit(limit);
    if (me.role === "buyer") q = q.eq("owner_id", me.id);
    const { data } = await q;
    return {
      jobs: await Promise.all((data ?? []).map(async (j) => ({
        job_id: j.id, video: j.source_name, ad_id: j.ad_id ?? undefined, tail: TYPES[j.tail_type as string] ?? j.tail_type, frame: TYPES[j.frame_type as string] ?? j.frame_type,
        status: STATUS[j.status as string] ?? j.status, stage: j.stage ?? undefined, error: j.error ?? undefined, created: at(j.created_at as string),
        download: j.result_key && ["done", "failed"].includes(j.status as string) ? await downloadUrl(j.result_key as string, j.source_name as string) : undefined,
      }))),
    };
  },
};

export const ANTIREJECT_TOOLS: Tool[] = [getOptions, change, checkNow, history, startUniquify, getUniqJobs];
