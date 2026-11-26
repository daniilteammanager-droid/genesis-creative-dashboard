import { createHash } from "node:crypto";
import { warehouse } from "@/lib/warehouse/read";
import { selfOf, type Profile } from "@/lib/auth/types";
import { accountDetails, myAccounts, myCreatives, myLandings } from "@/lib/autoupload/options";
import { cancelJob, createJob, listJobs, planFor, resumeJob } from "@/lib/autoupload/jobs";
import { activeKey, setUploadKey, uploadKeys, type UploadKey } from "@/lib/autoupload/key";
import { ACTORS, CTAS, FUNNEL_LANDERS, GEOS, MARKERS, TARGETS, cabCode, type Plan } from "@/lib/autoupload/plan";
import { draftInput, expandSet, type DraftForm } from "@/lib/autoupload/sets";
import { issueUpload } from "@/lib/creatives/upload";
import { mskDay, mskTime } from "@/lib/day";
import { ToolError, type ToolDef } from "./protocol";

// Автозалив через AI (Decision 129): та же сборка, что на странице «Автозалив» (planFor → buildPlan), те же свои
// кабинеты и своя Медиатека, то же задание с проходами крона (autoupload_jobs, launch.ts). Сверх страницы — страховка
// от модели: залить можно только план, который сначала показали человеку (plan_id из preview_autoupload), и тот же
// залив не повторяется 30 минут (обрыв связи и повтор вызова не создадут кампании дважды).

interface Ctx { me: Profile; tokenId?: string }
type Tool = ToolDef<Ctx>;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const at = (iso: string) => `${mskDay(new Date(iso))} ${mskTime(new Date(iso))}`;
export const REPEAT_MS = 30 * 60_000;

// ── Чистая часть (самопроверка — autoupload.test.ts) ─────────────────────────

// Отпечаток плана: что именно создастся. Сборка детерминирована, поэтому тот же вход даёт тот же отпечаток.
export function planPrint(p: Plan): string {
  const shape = [p.paused, p.text, p.campaigns.map((c) => [c.accountId, c.name, c.budgetUsd, c.bidCapUsd, c.startLocal, c.pixelId, c.pageId, c.landingUrl,
    c.adsets.map((a) => [a.name, a.country, a.target, a.budgetUsd ?? null, a.customAudienceId ?? null, a.ads.map((x) => [x.name, x.key])])])];
  return createHash("sha256").update(JSON.stringify(shape)).digest("hex").slice(0, 12);
}

// Тот же залив — те же кампании в тех же кабинетах (план из базы приходит jsonb, порядок ключей там другой).
const names = (p: Plan) => p.campaigns.map((c) => `${c.accountId}|${c.name}`).sort().join("\n");
export function repeatOf(recent: { plan: Plan; created_at: string; status: string }[], p: Plan, now = Date.now()) {
  return recent.find((j) => j.status !== "cancelled" && now - Date.parse(j.created_at) < REPEAT_MS && names(j.plan) === names(p)) ?? null;
}

// Сохранённая сборка по названию, без учёта регистра.
export function draftByName<T extends { name: string }>(drafts: T[], want: string): T {
  const v = want.trim().toLowerCase();
  const hit = drafts.find((d) => d.name.trim().toLowerCase() === v) ?? (() => {
    const like = drafts.filter((d) => d.name.toLowerCase().includes(v));
    return like.length === 1 ? like[0] : undefined;
  })();
  if (!hit) throw new ToolError(drafts.length ? `Сборки «${want}» нет. Есть: ${drafts.map((d) => `«${d.name}»`).join(", ")}` : "Сохранённых сборок нет — их сохраняют на странице «Автозалив»");
  return hit;
}

// План — коротко, для показа человеку перед заливом.
export function planView(p: Plan, max = 20) {
  return {
    paused: p.paused, summary: p.summary,
    campaigns: p.campaigns.slice(0, max).map((c) => ({
      cabinet: `${c.cab} (${c.accountId})`, name: c.name, geo: c.geo, budget_usd: c.budgetUsd ?? "ABO — у адсетов", bid_cap_usd: c.bidCapUsd ?? undefined,
      start: `${c.startLocal.replace("T", " ")} (время кабинета)`, link: c.landingUrl,
      adsets: c.adsets.map((a) => ({ name: a.name, country: a.country, budget_usd: a.budgetUsd ?? undefined, ads: a.ads.map((x) => x.name) })),
    })),
    more_campaigns: Math.max(0, p.campaigns.length - max) || undefined,
  };
}

// ── База ─────────────────────────────────────────────────────────────────────

async function drafts(userId: string) {
  const { data } = await warehouse().from("autoupload_drafts").select("name, form, updated_at").eq("user_id", userId).order("updated_at", { ascending: false }).limit(30);
  return (data ?? []) as { name: string; form: DraftForm; updated_at: string }[];
}

// Форма с полями по умолчанию, как пустая форма страницы; у строк кампаний и адсетов без ключа — свои ключи.
export function formOf(raw: Partial<DraftForm>): DraftForm {
  const f: DraftForm = {
    accountIds: [], pixelId: "", pageId: "", date: mskDay(), campaignNumber: 1, budget: "20", oneToOne: false, abo: false, paused: false,
    campaigns: [], adsets: [], omitted: [], overrides: {}, text: { cta: "LEARN_MORE" }, ...raw,
  };
  f.accountIds = (f.accountIds ?? []).map((x) => String(x).trim().replace(/^act_/, "")).filter(Boolean);
  f.campaigns = (f.campaigns ?? []).map((c, i) => ({ ...c, key: c.key || `c${i + 1}`, startAtByAccount: c.startAtByAccount ?? {} }));
  f.adsets = (f.adsets ?? []).map((x, i) => ({ ...x, id: x.id || `a${i + 1}`, creatives: x.creatives ?? [] }));
  return f;
}

// Форма: сохранённая сборка или целиком от модели, с правками кабинетов, даты, паузы и номера.
async function formFor(me: Profile, a: Record<string, unknown>): Promise<DraftForm> {
  const date = str(a.date);
  if (date && !DAY.test(date)) throw new ToolError("Дата — в формате YYYY-MM-DD");
  let raw: Partial<DraftForm>;
  if (str(a.draft)) raw = draftByName(await drafts(me.id), str(a.draft)).form;
  else if (a.form && typeof a.form === "object" && !Array.isArray(a.form)) raw = a.form as Partial<DraftForm>;
  else throw new ToolError("Нужна сборка: draft — название сохранённой сборки (get_autoupload_options), или form — сборка целиком");
  const f = formOf(raw);
  if (Array.isArray(a.account_ids)) f.accountIds = formOf({ accountIds: a.account_ids.map(String) }).accountIds;
  if (date) f.date = date;
  if (typeof a.paused === "boolean") f.paused = a.paused;
  if (Number.isInteger(a.campaign_number)) f.campaignNumber = a.campaign_number as number;
  return f;
}

// 1-1-1: какие кампании раскроет каждый сет — omit_key кладут в form.omitted, чтобы убрать лишнюю.
export function setChildren(f: DraftForm) {
  if (!f.oneToOne) return undefined;
  return f.campaigns.flatMap((c, i) => expandSet(c, i + 1, f.adsets, new Set(f.omitted ?? []), f.overrides ?? {})
    .map((x) => ({ omit_key: x.key, set: i + 1, adset: x.adsetIndex + 1, creative: x.code })));
}

async function planOf(me: Profile, a: Record<string, unknown>) {
  const form = await formFor(me, a);
  // Ссылки Torro нужны, только если у кампании нет своей: лишний раз Torro не трогаем.
  const [accounts, landings] = await Promise.all([myAccounts(me), form.campaigns.some((c) => !c.landingUrl) ? myLandings(me).catch(() => []) : Promise.resolve([])]);
  const alive = new Set(accounts.map((x) => x.id));
  const dead = form.accountIds.filter((id) => !alive.has(id));
  const plan = await planFor(me, draftInput(form, alive, landings)).catch((e: unknown) => { throw new ToolError(e instanceof Error ? e.message : String(e)); });
  return { plan, form, notice: dead.length ? `Не живые или не твои кабинеты убраны из залива: ${dead.join(", ")}` : undefined };
}

// ── Инструменты ──────────────────────────────────────────────────────────────

const PLAN_PROPS = {
  draft: { type: "string", description: "Название сохранённой сборки со страницы «Автозалив» (get_autoupload_options → drafts). Проще всего так." },
  account_ids: { type: "array", items: { type: "string" }, description: "Заменить кабинеты сборки: id кабинетов (get_autoupload_options → cabinets). Пиксель сборки должен быть во всех." },
  date: { type: "string", description: "Дата в именах кампаний, YYYY-MM-DD. Пусто — как в сборке." },
  paused: { type: "boolean", description: "true — создать на паузе, false — сразу активными. Пусто — как в сборке. Спроси человека." },
  campaign_number: { type: "integer", description: "С какого N нумеровать кампании. Пусто — как в сборке." },
  form: {
    type: "object",
    description: "Сборка целиком, если нет сохранённой, — та же форма, что на странице «Автозалив»: accountIds[] (id кабинетов), pixelId (общий для всех кабинетов), pageId (FP по умолчанию), date (YYYY-MM-DD), campaignNumber (с какого N), budget (бюджет по умолчанию, $), oneToOne (1-1-1: из каждой строки кампаний — сет, кампания на каждый «адсет × креатив»), abo (бюджет на адсетах, не на кампании), paused, text {primaryText, headline, description, cta: LEARN_MORE | SIGN_UP | MESSAGE_PAGE}, adsets[] {id, target: BROAD | INT | RETARGET, customAudienceId (для RETARGET), label, creatives[] {key, code, kind: video | image} — из get_autoupload_options → creatives}, campaigns[] {key, geo (ESP, ARG, MEX, COL, CHL, PER, PRY, URY, ECU, PAN), actor (ROMAN | RICKY), funnel (TG | WA), marker (NEW | EXP | MIX), lander (TG: TGR, MTG, VSL1, VSL2, KAL1, KAL2; WA: ART1, ART2, ART3), landingUrl (ссылка MVP из landings; пусто — свежая своей серии), pageId (своя FP), budgetUsd (свой бюджет), bidCapEnabled + bidCapUsd, startAtByAccount {id кабинета: \"ЧЧ:ММ\"}, campaignName (шаблон имени, токены {{CAB}} {{DATE}} {{GEO}} {{FACE}} {{FUNNEL}} {{MARKER}} {{LANDER}} {{N}}), adsetNames[] (шаблоны имён адсетов по порядку набора), adsetBudgets[] (ABO: бюджет каждого адсета)}, omitted[] (1-1-1: omit_key кампаний сета, которые убрать — их даёт preview_autoupload → set_campaigns).",
  },
};

// Ключи залива без токенов: active — каким заливает сейчас (Decision 130).
const keyView = (keys: UploadKey[]) => {
  const on = activeKey(keys);
  return keys.map((k) => ({ id: k.id, name: k.name, app_id: k.appId ?? undefined, active: k === on, can_write: k.canWrite, error: k.lastError ?? undefined }));
};

const getOptions: Tool = {
  name: "get_autoupload_options",
  title: "Автозалив: из чего собирать",
  description: "Что есть для автозалива, как на странице «Автозалив»: свои живые кабинеты (refresh — перепроверить вживую, как «Обновить кабинеты»), сохранённые сборки, ссылки MVP (лендинги Torro), креативы своей Медиатеки (поиск по коду, лицу, подходу, версии), допустимые GEO, лица, воронки, ленды, аудитории и CTA, ключи (приложения Meta), которыми можно заливать, — active у того, каким заливает сейчас. С account_id — ещё пиксели и Facebook-страницы этого кабинета (вживую из Meta).",
  inputSchema: {
    type: "object",
    properties: {
      account_id: { type: "string", description: "Кабинет, для которого нужны пиксели и страницы." },
      refresh: { type: "boolean", description: "«Обновить кабинеты»: перепроверить статусы своих кабинетов вживую в Meta (как кнопка на странице). Без него — из склада." },
      search: { type: "string", description: "Часть кода креатива: t38, storytell, b2." },
      face: { type: "string", enum: ["ROMAN", "RICKY"], description: "Креативы одного лица — вкладки Роман / Рики." },
      approach: { type: "string", description: "Подход: storytell, edit, balance, qa…" },
      version: { type: "string", description: "Версия: v1 (исходники — для уникализации), v2…" },
      limit: { type: "integer", description: "Сколько креативов списком, 1–200. По умолчанию 40, свежие первыми." },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true, title: "Автозалив: из чего собирать" },
  async run({ me }, a) {
    const [accounts, landings, creatives, saved, keys] = await Promise.all([myAccounts(me, a.refresh === true), myLandings(me).catch(() => []), myCreatives(me), drafts(me.id),
      me.actor ? Promise.resolve(null) : uploadKeys(me.id)]);   // ключ автозалива джуну не виден (Decision 127)
    const q = str(a.search).toLowerCase(), face = str(a.face).toUpperCase(), approach = str(a.approach).toLowerCase(), version = str(a.version).toLowerCase();
    const found = creatives.filter((c) => (!q || c.code.includes(q)) && (!face || c.face === face) && (!approach || c.approach === approach) && (!version || c.version === version));
    const limit = Math.min(200, Math.max(1, Number.isInteger(a.limit) ? (a.limit as number) : 40));
    const acc = str(a.account_id).replace(/^act_/, "");
    const details = acc ? await accountDetails(me, acc).catch((e: unknown) => { throw new ToolError(e instanceof Error ? e.message : String(e)); }) : null;
    return {
      cabinets: accounts.map((x) => ({ id: x.id, cab: cabCode(x), name: x.name, status: x.status, timezone: x.timezone })),
      drafts: saved.map((d) => ({
        name: d.name, updated: at(d.updated_at), cabinets: d.form.accountIds?.length ?? 0, campaigns: d.form.campaigns?.length ?? 0,
        adsets: d.form.adsets?.length ?? 0, creatives: (d.form.adsets ?? []).reduce((s, x) => s + (x.creatives?.length ?? 0), 0),
        one_to_one: !!d.form.oneToOne, paused: !!d.form.paused,
      })),
      landings: landings.slice(0, 15).map((l) => ({ id: l.id, name: l.name, url: l.url, series: l.series })),
      creatives: found.slice(0, limit).map((c) => ({ code: c.code, key: c.key, kind: c.kind, face: c.face, approach: c.approach || undefined, version: c.version || undefined, uploaded: c.uploadedAt.slice(0, 10) })),
      more_creatives: Math.max(0, found.length - limit) || undefined,
      pixels: details?.pixels, pages: details?.pages,
      keys: keys ? keyView(keys) : undefined,
      allowed: { geos: GEOS, actors: ACTORS, markers: MARKERS, funnels: FUNNEL_LANDERS, targets: TARGETS, ctas: CTAS },
    };
  },
};

const previewAutoupload: Tool = {
  name: "preview_autoupload",
  title: "Автозалив: проверить сборку",
  description: "Собрать план залива, ничего не создавая, — как «Проверить сборку» на странице: какие кампании, адсеты и объявления в каких кабинетах, с какими именами, бюджетами, временем старта, на паузе или нет. Покажи план человеку целиком и спроси, заливать ли. Отдаёт plan_id — его ждёт launch_autoupload.",
  inputSchema: { type: "object", properties: PLAN_PROPS, additionalProperties: false },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false, title: "Автозалив: проверить сборку" },
  async run({ me }, a) {
    const { plan, form, notice } = await planOf(me, a);
    return { plan_id: planPrint(plan), ...planView(plan), set_campaigns: setChildren(form), notice };
  },
};

const launchAutoupload: Tool = {
  name: "launch_autoupload",
  title: "Автозалив: залить",
  description: "Создать кампании в Meta по проверенной сборке — как «Создать» на странице «Автозалив»; дальше заливает очередь (раз в минуту), ход — get_autoupload_jobs. Тратит деньги: вызывай только после того, как показал человеку план из preview_autoupload и он ответил «да». Аргументы — те же, что у preview_autoupload, плюс его plan_id: если сборка с тех пор изменилась, залив не начнётся.",
  inputSchema: {
    type: "object",
    properties: { ...PLAN_PROPS, plan_id: { type: "string", description: "plan_id из preview_autoupload, который человек одобрил." } },
    required: ["plan_id"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true, title: "Автозалив: залить" },
  async run({ me }, a) {
    const { plan } = await planOf(me, a);
    if (planPrint(plan) !== str(a.plan_id)) throw new ToolError("Сборка изменилась после проверки — покажи человеку новый план (preview_autoupload) и залей с новым plan_id");
    const { data: recent } = await warehouse().from("autoupload_jobs").select("plan, created_at, status")
      .eq("user_id", me.id).gte("created_at", new Date(Date.now() - REPEAT_MS).toISOString());
    const twin = repeatOf((recent ?? []) as { plan: Plan; created_at: string; status: string }[], plan);
    if (twin) throw new ToolError(`Этот залив уже запущен в ${at(twin.created_at)} — статус в get_autoupload_jobs. Повторить те же кампании — только на странице «Автозалив».`);
    const id = await createJob(me.id, plan, selfOf(me).id);
    return { job_id: id, summary: plan.summary, paused: plan.paused, note: "Залив в очереди: начнётся в течение минуты. Ход — get_autoupload_jobs." };
  },
};

const STATUS: Record<string, string> = { creating: "Заливается", created: "Готово", failed: "Ошибка", cancelling: "Удаляю", cancelled: "Отменено" };

const getJobs: Tool = {
  name: "get_autoupload_jobs",
  title: "Автозалив: заливы",
  description: "Последние 20 заливов, как список на странице «Автозалив»: статус, этап, ошибка, сколько кампаний и объявлений уже создано, кто залил, имена кампаний.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false, title: "Автозалив: заливы" },
  async run({ me }) {
    return {
      jobs: (await listJobs(me.id)).map((j) => ({
        job_id: j.id, status: STATUS[j.status] ?? j.status, stage: j.stage ?? undefined, error: j.error ?? undefined, created: at(j.createdAt),
        by: j.by ?? undefined, planned: j.summary, done: j.done, campaigns: j.names.slice(0, 10), more_campaigns: Math.max(0, j.names.length - 10) || undefined,
      })),
    };
  },
};

const cancelAutoupload: Tool = {
  name: "cancel_autoupload",
  title: "Автозалив: отменить и удалить",
  description: "Остановить залив и удалить в Meta уже созданные им кампании (адсеты и объявления удаляются вместе с ними) — как «Отменить и удалить» на странице. Перед вызовом назови человеку залив и его кампании и дождись «да».",
  inputSchema: { type: "object", properties: { job_id: { type: "string", description: "job_id из get_autoupload_jobs или launch_autoupload." } }, required: ["job_id"], additionalProperties: false },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true, title: "Автозалив: отменить и удалить" },
  async run({ me }, a) {
    const errors = await cancelJob(me.id, str(a.job_id)).catch((e: unknown) => { throw new ToolError(e instanceof Error ? e.message : String(e)); });
    return errors.length ? { cancelled: true, not_deleted: errors } : { cancelled: true, note: "Кампании залива удалены." };
  },
};

const setKey: Tool = {
  name: "set_autoupload_key",
  title: "Автозалив: каким ключом заливать",
  description: "Сменить ключ (приложение Meta), которым заливает автозалив, на другой уже добавленный: ключи из «Интеграций» с правом ads_management или своё приложение автозалива (id app). Для того, когда у приложения кончился часовой лимит Meta — у залива ошибка «лимит запросов приложения»: смени ключ и продолжи залив resume_autoupload. Действует и на заливы, которые уже идут, со следующего прохода. Новый ключ добавляют только на странице. Список и активный — keys в get_autoupload_options.",
  inputSchema: { type: "object", properties: { key: { type: "string", description: "id из keys (get_autoupload_options), app — приложение автозалива, или точное имя ключа." } }, required: ["key"], additionalProperties: false },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: "Автозалив: каким ключом заливать" },
  async run({ me }, a) {
    if (me.actor) throw new ToolError("Ключ автозалива меняет сам баер");
    const want = str(a.key), keys = await uploadKeys(me.id);
    const k = keys.find((x) => x.id === want) ?? keys.find((x) => x.name.toLowerCase() === want.toLowerCase());
    if (!k) throw new ToolError(`Нет такого ключа. Есть: ${keys.map((x) => `${x.name} (${x.id})`).join(", ") || "ни одного"}`);
    await setUploadKey(me.id, k.id).catch((e: unknown) => { throw new ToolError(e instanceof Error ? e.message : String(e)); });
    return { active: k.name, keys: keyView(await uploadKeys(me.id)) };
  },
};

const resumeAutoupload: Tool = {
  name: "resume_autoupload",
  title: "Автозалив: продолжить упавший залив",
  description: "Продолжить залив со статусом «Ошибка» с места, где он встал: созданное уже записано и второй раз не создаётся, крон продолжит в течение минуты. Для лимита приложения Meta — сначала смени ключ (set_autoupload_key). Ошибку в самой сборке (пиксель, страница, ссылка) так не исправить — нужен новый залив.",
  inputSchema: { type: "object", properties: { job_id: { type: "string", description: "job_id из get_autoupload_jobs." } }, required: ["job_id"], additionalProperties: false },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true, title: "Автозалив: продолжить залив" },
  async run({ me }, a) {
    await resumeJob(me.id, str(a.job_id)).catch((e: unknown) => { throw new ToolError(e instanceof Error ? e.message : String(e)); });
    return { resumed: true, note: "Крон продолжит залив в течение минуты; ход — get_autoupload_jobs." };
  },
};

const saveDraft: Tool = {
  name: "save_autoupload_draft",
  title: "Автозалив: сохранить сборку",
  description: "Сохранить сборку под названием — как «Сохранить сборку» на странице «Автозалив»: та же форма, потом её заливают по draft (здесь или на странице). Аргументы — как у preview_autoupload; сборка с тем же названием перезаписывается.",
  inputSchema: { type: "object", properties: { name: { type: "string", description: "Название сборки, до 80 знаков." }, ...PLAN_PROPS }, required: ["name"], additionalProperties: false },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: "Автозалив: сохранить сборку" },
  async run({ me }, a) {
    const name = str(a.name).slice(0, 80);
    if (!name) throw new ToolError("Назови сборку");
    const form = await formFor(me, a);
    const { error } = await warehouse().from("autoupload_drafts").upsert({ user_id: me.id, name, form, updated_at: new Date().toISOString() }, { onConflict: "user_id,name" });
    if (error) throw new Error(error.message);
    return { saved: name, cabinets: form.accountIds.length, campaigns: form.campaigns.length, adsets: form.adsets.length };
  },
};

const uploadUrl: Tool = {
  name: "get_media_upload_url",
  title: "Медиатека: загрузить крео",
  description: "Ссылка, чтобы загрузить файл крео в свою Медиатеку — как загрузка в «Креативах» и «Автозаливе»: файл кладётся в твою папку, лицо обязательно, дальше воркер сожмёт видео, сделает превью и расшифровку. Ссылка живёт 10 минут; загрузить — PUT файла, например: curl -T <файл> -H \"Content-Type: <тип>\" \"<upload_url>\" (Claude Code, Codex, терминал). Имя файла — код крео с расширением (vid-edit-t38-v1-b1-es-es.mp4). exists: true — такой файл уже есть и заменится: спроси человека.",
  inputSchema: {
    type: "object",
    properties: {
      file_name: { type: "string", description: "Имя файла: код крео и расширение mp4, mov, jpg, jpeg, png или webp." },
      face: { type: "string", enum: ["ROMAN", "RICKY"], description: "Лицо крео." },
      content_type: { type: "string", description: "MIME-тип: video/mp4, video/quicktime, image/jpeg, image/png, image/webp." },
    },
    required: ["file_name", "face"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true, title: "Медиатека: загрузить крео" },
  async run({ me }, a) {
    const r = await issueUpload(me, str(a.file_name), str(a.content_type) || undefined, str(a.face), warehouse())
      .catch((e: unknown) => { throw new ToolError(e instanceof Error ? e.message : String(e)); });
    return { upload_url: r.uploadUrl, key: r.key, exists: r.exists, warning: r.warning, public_url: r.publicUrl, expires_in_min: 10 };
  },
};

export const AUTOUPLOAD_TOOLS: Tool[] = [getOptions, previewAutoupload, launchAutoupload, getJobs, resumeAutoupload, cancelAutoupload, setKey, saveDraft, uploadUrl];
