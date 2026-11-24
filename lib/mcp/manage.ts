import { warehouse } from "@/lib/warehouse/read";
import { applyLive, liveStates, type Item, type Level } from "@/lib/reports-live/manage";
import { escapeHtml, notify } from "@/lib/telegram/links";
import { selfOf, type Profile } from "@/lib/auth/types";
import { ToolError, type ToolDef } from "./protocol";

// AI-доступ, этап 2 (Decision 117): пауза, запуск и дневной бюджет тем же путём, что Live Manager
// (applyLive — ключ владельца кабинета или API Dolphin; FB Tool не умеет). Права те же: свои кабинеты,
// владелец дашборда — все. Выключателя у баера нет: в Live Manager он и так может то же самое.
// Страховка — лимиты ниже, просьба модели спросить человека, журнал mcp_changes и Telegram.

export const MAX_ITEMS = 20;      // объектов за вызов
export const MAX_PER_HOUR = 100;  // удачных изменений в час на человека
export const BUDGET_X = 2;        // бюджет за раз — не больше чем вдвое в любую сторону

interface Ctx { me: Profile; tokenId?: string }
type Tool = ToolDef<Ctx>;

const LEVEL_RU: Record<Level, string> = { campaign: "Кампания", adset: "Адсет", ad: "Объявление" };
const money = (n: number) => `$${Math.round(n * 100) / 100}`;

// Новый бюджет из «сколько поставить» или «на сколько % поменять» — и не дальше чем вдвое от текущего.
export function budgetTarget(current: number | null, usd: number | null, pct: number | null): { usd: number } | { error: string } {
  if (current == null || !(current > 0)) return { error: "бюджет не на этом уровне: при CBO он у кампании, при ABO — у адсетов" };
  const t = Math.round((usd ?? current * (1 + (pct ?? 0) / 100)) * 100) / 100;
  if (!(t > 0)) return { error: "бюджет должен быть больше нуля" };
  const lo = Math.ceil((current / BUDGET_X) * 100) / 100, hi = Math.floor(current * BUDGET_X * 100) / 100;
  if (t < lo || t > hi) return { error: `за раз — не больше чем вдвое: сейчас ${money(current)}, можно от ${money(lo)} до ${money(hi)}` };
  return { usd: t };
}

function idsOf(v: unknown, max: number): string[] {
  const ids = [...new Set((Array.isArray(v) ? v : []).map((x) => String(x).trim()))];
  if (!ids.length) throw new ToolError("Нужны id — бери их из get_campaigns");
  if (ids.some((id) => !/^\d+$/.test(id))) throw new ToolError("id — только цифры, как в get_campaigns");
  if (ids.length > max) throw new ToolError(`За раз — не больше ${max} объектов`);
  return ids;
}

interface Entity { id: string; level: Level; accountId: string; name: string }

// Объекты — из склада (wh_entities, раз в час): уровень и кабинет берём сами, а не со слов модели.
// Баеру — только из своих кабинетов: чужие для него «не найдены».
async function entities(me: Profile, ids: string[]): Promise<Entity[]> {
  const db = warehouse();
  const { data, error } = await db.from("wh_entities").select("entity_id, level, account_id, name").in("entity_id", ids);
  if (error) throw new Error(error.message);
  let rows = (data ?? []).filter((r) => r.account_id);
  if (me.role === "buyer" && rows.length) {
    const { data: own } = await db.from("wh_account_owners").select("account_id").eq("owner_user_id", me.id)
      .in("account_id", [...new Set(rows.map((r) => r.account_id as string))]);
    const mine = new Set((own ?? []).map((o) => o.account_id as string));
    rows = rows.filter((r) => mine.has(r.account_id as string));
  }
  const found = new Map(rows.map((r) => [r.entity_id as string, r]));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) throw new ToolError(`Не нашёл среди своих кабинетов: ${missing.join(", ")}. Id бери из get_campaigns; созданное меньше часа назад появится после ближайшего обновления.`);
  return ids.map((id) => {
    const r = found.get(id)!;
    return { id, level: r.level as Level, accountId: r.account_id as string, name: (r.name as string | null) ?? id };
  });
}
const itemOf = (e: Entity): Item => ({ level: e.level, id: e.id, accountId: e.accountId });

const getLiveState: Tool = {
  name: "get_live_state",
  title: "Статус и бюджет сейчас",
  description: "Статус и дневной бюджет кампаний, адсетов или объявлений прямо сейчас — вживую из кабинета, а не часовой снимок get_campaigns. Нужен перед изменением бюджета или чтобы проверить, что изменение применилось.",
  inputSchema: {
    type: "object",
    properties: { ids: { type: "array", items: { type: "string" }, description: "id из get_campaigns, до 100." } },
    required: ["ids"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true, title: "Статус и бюджет сейчас" },
  async run({ me }, a) {
    const list = await entities(me, idsOf(a.ids, 100));
    const { states, errors } = await liveStates(me, list.map(itemOf));
    const now = new Map(states.map((s) => [s.id, s]));
    return {
      rows: list.map((e) => {
        const s = now.get(e.id);
        return { id: e.id, level: e.level, name: e.name, status: s?.status ?? null, effective_status: s?.effective ?? null,
          daily_budget_usd: s?.dailyBudget ?? null, can_edit: s?.canEdit ?? false };
      }),
      errors: errors.length ? errors : undefined,
    };
  },
};

type Action = "pause" | "activate" | "budget";
const ACTION_RU: Record<Action, string> = { pause: "пауза", activate: "запуск", budget: "дневной бюджет" };

const manageCampaigns: Tool = {
  name: "manage_campaigns",
  title: "Пауза, запуск, бюджет",
  description: `Поставить на паузу, запустить или поменять дневной бюджет кампаний, адсетов или объявлений в своих кабинетах — как кнопки Live Manager в дашборде. Перед вызовом покажи пользователю, что именно поменяется (названия, было → станет), и дождись его согласия. Лимиты: до ${MAX_ITEMS} объектов за вызов, до ${MAX_PER_HOUR} изменений в час, бюджет за раз — не больше чем вдвое вверх или вниз. Кабинеты FB Tool и Telegram Ads отсюда не меняются. Каждое изменение пишется в журнал и приходит владельцу кабинета в Telegram.`,
  inputSchema: {
    type: "object",
    properties: {
      ids: { type: "array", items: { type: "string" }, description: `id из get_campaigns, до ${MAX_ITEMS}.` },
      action: { type: "string", enum: ["pause", "activate", "budget"], description: "pause — пауза, activate — запуск, budget — дневной бюджет." },
      daily_budget_usd: { type: "number", description: "Для budget: новый дневной бюджет в долларах (в валюте кабинета пересчитается сам)." },
      change_pct: { type: "number", description: "Для budget вместо daily_budget_usd: на сколько % поменять текущий, например 20 или -30." },
    },
    required: ["ids", "action"],
    additionalProperties: false,
  },
  // destructive: запуск и рост бюджета тратят деньги, их не вернуть — пусть клиент спрашивает.
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true, title: "Пауза, запуск, бюджет" },
  async run({ me, tokenId }, a) {
    const action = (["pause", "activate", "budget"] as const).find((x) => x === a.action);
    if (!action) throw new ToolError("action — pause, activate или budget");
    const ids = idsOf(a.ids, MAX_ITEMS);
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const usd = num(a.daily_budget_usd), pct = num(a.change_pct);
    if (action === "budget" && (usd == null) === (pct == null)) throw new ToolError("Для budget — ровно одно: daily_budget_usd или change_pct");

    const db = warehouse();
    const { count } = await db.from("mcp_changes").select("id", { count: "exact", head: true })
      .eq("user_id", selfOf(me).id).eq("ok", true).gte("created_at", new Date(Date.now() - 3_600_000).toISOString());
    if ((count ?? 0) + ids.length > MAX_PER_HOUR) throw new ToolError(`Лимит — ${MAX_PER_HOUR} изменений в час, за последний час уже ${count}. Подожди или сделай это в Live Manager.`);

    const list = await entities(me, ids);
    const { states, errors } = await liveStates(me, list.map(itemOf));
    const now = new Map(states.map((s) => [s.id, s]));

    type Row = { e: Entity; before: { status: string | null; budget: number | null }; after: { status?: string; budget?: number }; ok: boolean; error?: string };
    const rows: Row[] = list.map((e) => ({
      e, before: { status: now.get(e.id)?.status ?? null, budget: now.get(e.id)?.dailyBudget ?? null }, after: {}, ok: false,
    }));
    const apply = async (r: Row[], act: Parameters<typeof applyLive>[2]) => {
      const res = new Map((await applyLive(me, r.map((x) => itemOf(x.e)), act)).map((x) => [x.id, x]));
      for (const x of r) { x.ok = res.get(x.e.id)?.ok ?? false; x.error = res.get(x.e.id)?.error; }
    };

    if (action === "budget") {
      for (const r of rows) {
        if (r.e.level === "ad") { r.error = "у объявления нет своего бюджета"; continue; }
        if (!now.has(r.e.id)) { r.error = `не прочитался текущий бюджет${errors.length ? ` — ${errors.join("; ")}` : ""}`; continue; }
        const t = budgetTarget(r.before.budget, usd, pct);
        if ("error" in t) { r.error = t.error; continue; }
        r.after = { budget: t.usd };
        await apply([r], { kind: "budget", usd: t.usd });
      }
    } else {
      for (const r of rows) r.after = { status: action === "activate" ? "ACTIVE" : "PAUSED" };
      await apply(rows, { kind: "status", active: action === "activate" });
    }

    await db.from("mcp_changes").insert(rows.map((r) => ({
      user_id: selfOf(me).id, token_id: tokenId ?? null, entity_id: r.e.id, level: r.e.level, account_id: r.e.accountId, name: r.e.name,
      action, before: r.before, after: r.after, ok: r.ok, error: r.error?.slice(0, 500) ?? null,
    })));
    await tell(me, tokenId, action, rows.filter((r) => r.ok)).catch(() => {});   // Telegram не роняет ответ

    return {
      action, changed: rows.filter((r) => r.ok).length, failed: rows.filter((r) => !r.ok).length,
      results: rows.map((r) => ({ id: r.e.id, level: r.e.level, name: r.e.name, before: r.before, after: r.after, ok: r.ok, error: r.error })),
      note: "В кабинете — сразу; в get_campaigns статус обновится в течение часа, сейчас — get_live_state.",
    };
  },
};

// Кто сделал, чем, что было → что стало — тому, кто попросил, и владельцам кабинетов, если это не он.
async function tell(me: Profile, tokenId: string | undefined, action: Action, done: { e: Entity; before: { status: string | null; budget: number | null }; after: { status?: string; budget?: number } }[]) {
  if (!done.length) return;
  const db = warehouse();
  const [{ data: tok }, { data: own }] = await Promise.all([
    tokenId ? db.from("mcp_tokens").select("client_name").eq("id", tokenId).maybeSingle() : Promise.resolve({ data: null }),
    db.from("wh_account_owners").select("owner_user_id").in("account_id", [...new Set(done.map((d) => d.e.accountId))]),
  ]);
  const self = selfOf(me);
  const who = `${escapeHtml((tok?.client_name as string | undefined) || "AI")} · ${escapeHtml(self.name || self.email)}`;
  const lines = done.map(({ e, before, after }) => `• ${LEVEL_RU[e.level]} «${escapeHtml(e.name)}» — ` + (action === "budget"
    ? `${before.budget == null ? "?" : money(before.budget)} → ${money(after.budget!)}`
    : `${escapeHtml(before.status ?? "?")} → ${after.status}`));
  const text = `🤖 <b>Изменение через AI</b> (${who}): ${ACTION_RU[action]}\n${lines.join("\n")}`;
  const to = new Set([self.id, ...(own ?? []).map((o) => o.owner_user_id as string).filter(Boolean)]);
  await Promise.allSettled([...to].map((id) => notify(id, "ai_changes", text)));
}

export const MANAGE_TOOLS: Tool[] = [getLiveState, manageCampaigns];
