import { warehouse } from "@/lib/warehouse/read";
import type { Profile } from "@/lib/auth/types";
import { mskDay, mskDaysAgo } from "@/lib/day";
import { notify } from "@/lib/telegram/links";
import { escapeHtml } from "@/lib/telegram/api";
import { loadTrafficReport, type TrafficReport } from "@/lib/traffic-report/load";
import { geoName, regionName, stageOf, REST, type Cell, type Sums } from "@/lib/traffic-report/build";
import { dashboardUrl } from "@/lib/alerts/autocheck";
import { aiReady, ask, CREO_MODEL } from "./claude";
import { CREO_SYSTEM, WINDOW_DAYS, creoPrompt, dataHash, parseVerdict, pickTranscript, textBase, toTelegramHtml, type CreoFacts, type Verdict } from "./prompt";

// AI-разбор крео баера (Decision 101): кнопка в «Отчётах» и автоматически — когда крео прошло
// границу теста без депов и когда дало первые депы (очередь, крон kind=ai, разбор уходит баеру
// в Telegram). Разбор — на «баер × крео» по всем странам за 30 дней. Те же цифры — тот же разбор:
// повторно модель не зовём.

export const DEFAULT_BUDGET_USD = 10;
export type Trigger = "manual" | "test_limit" | "first_deps";

export interface Analysis {
  id: string; buyer_id: string; creo: string; trigger: Trigger; status: string;
  verdict: Verdict | null; text: string | null; cost_usd: number; created_at: string; error: string | null;
}
const COLS = "id, buyer_id, creo, trigger, status, verdict, text, cost_usd, created_at, error";

const db = () => warehouse();
const zero = (): Sums => ({ spend: 0, impr: 0, clicks: 0, subs: 0, dia: 0, deps: 0, rev: 0 });
const add = (a: Sums, b: Sums) => { for (const k of Object.keys(a) as (keyof Sums)[]) a[k] += b[k]; };

// ── Лимит баера ─────────────────────────────────────────────────────────────

const monthStart = () => `${mskDay().slice(0, 8)}01T00:00:00+03:00`;

export async function budgetOf(buyerId: string): Promise<{ limit: number; used: number }> {
  const [{ data: b }, { data: rows }] = await Promise.all([
    db().from("ai_budgets").select("monthly_usd").eq("buyer_id", buyerId).maybeSingle(),
    db().from("ai_creo_analyses").select("cost_usd").eq("buyer_id", buyerId).eq("charged", true).gte("created_at", monthStart()),
  ]);
  return { limit: b ? Number(b.monthly_usd) : DEFAULT_BUDGET_USD, used: (rows ?? []).reduce((s, r) => s + Number(r.cost_usd), 0) };
}

export async function setBudget(me: Profile, buyerId: string, usd: number): Promise<void> {
  if (me.role !== "main") throw new Error("Лимит меняет только владелец");
  if (!Number.isFinite(usd) || usd < 0 || usd > 1000) throw new Error("Лимит — от $0 до $1000 в месяц");
  const { error } = await db().from("ai_budgets").upsert({ buyer_id: buyerId, monthly_usd: Math.round(usd * 100) / 100, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

// ── Цифры крео ──────────────────────────────────────────────────────────────

async function profileOf(id: string): Promise<Profile> {
  const { data } = await db().from("profiles").select("*").eq("id", id).maybeSingle();
  if (!data) throw new Error("Баер не найден");
  return data as Profile;
}

async function transcriptOf(creo: string, buyerCode: string | null): Promise<string | null> {
  // Транскрипт — у видео, а не у объявления: ищем по коду текста, а чей он — решает pickTranscript.
  const base = textBase(creo);
  if (!base) return null;
  const { data } = await db().from("creative_notes").select("creative_code, transcription_ru")
    .or(`creative_code.ilike.${base},creative_code.ilike.${base}-*`).not("transcription_ru", "is", null).limit(50);
  return pickTranscript((data ?? []).map((r) => ({ code: r.creative_code as string, text: r.transcription_ru as string })), buyerCode);
}

// Вся команда за 30 дней — ради средних по регионам; в ответ баеру чужие цифры не уходят.
// ponytail: кэш на 5 минут в памяти инстанса — очередь из 30 разборов не читает склад 30 раз.
let team: { at: number; data: TrafficReport } | null = null;
async function teamReport(asProfile: Profile): Promise<TrafficReport> {
  if (team && Date.now() - team.at < 5 * 60_000 && team.data.until === mskDay()) return team.data;
  const data = await loadTrafficReport({ ...asProfile, role: "main" } as Profile, mskDaysAgo(WINDOW_DAYS - 1), mskDay());
  team = { at: Date.now(), data };
  return data;
}

export async function creoFacts(buyerId: string, creo: string): Promise<CreoFacts> {
  const buyer = await profileOf(buyerId);
  const report = await teamReport(buyer);
  const label = report.buyers.find((b) => b.id === buyerId)?.label;
  const mine = report.cells.filter((c) => c.buyer === label && c.creo === creo);
  if (!label || !mine.length) throw new Error("По этому крео нет цифр за 30 дней");
  const byGeo = new Map<string, Sums>();
  const total = zero();
  for (const c of mine) { add(byGeo.get(c.geo) ?? byGeo.set(c.geo, zero()).get(c.geo)!, c.sums); add(total, c.sums); }
  const team = new Map<string, Sums>();
  for (const c of report.cells as Cell[]) if (c.geo !== REST) add(team.get(regionName(c.geo)) ?? team.set(regionName(c.geo), zero()).get(regionName(c.geo))!, c.sums);
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].join(", ");
  return {
    buyer: label, creo, face: uniq(mine.map((c) => c.face)), funnel: uniq(mine.map((c) => c.funnel)),
    transcript: await transcriptOf(creo, buyer.buyer_code ?? null),
    geos: [...byGeo].filter(([g]) => g !== REST).sort((a, b) => b[1].spend - a[1].spend)
      .map(([geo, sums]) => ({ geo, name: geoName(geo), stage: stageOf(sums, geo), sums })),
    total,
    team: [...team].filter(([, s]) => s.spend > 0).map(([region, sums]) => ({ region, sums })),
  };
}

// ── Разбор ──────────────────────────────────────────────────────────────────

export async function latest(buyerId: string, creo: string): Promise<(Analysis & { data_hash: string | null }) | null> {
  const { data } = await db().from("ai_creo_analyses").select(`${COLS}, data_hash`)
    .eq("buyer_id", buyerId).eq("creo", creo).eq("status", "done").order("created_at", { ascending: false }).limit(1);
  return (data?.[0] as (Analysis & { data_hash: string | null }) | undefined) ?? null;
}

// Посчитать разбор и записать. charged — идёт в лимит баера; превышен — ошибка до вызова модели.
async function compute(buyerId: string, creo: string, charged: boolean): Promise<Record<string, unknown>> {
  const facts = await creoFacts(buyerId, creo);
  const hash = dataHash(facts);
  const last = await latest(buyerId, creo);
  if (last?.data_hash === hash) return { reused: last };
  if (charged) {
    const b = await budgetOf(buyerId);
    if (b.used >= b.limit) throw new Error(`Лимит AI-разборов на месяц исчерпан: $${b.used.toFixed(2)} из $${b.limit}`);
  }
  const a = await ask(CREO_MODEL, CREO_SYSTEM, creoPrompt(facts));
  return {
    status: "done", verdict: parseVerdict(a.text), text: a.text, data_hash: hash, model: a.model,
    input_tokens: a.inputTokens, output_tokens: a.outputTokens, cost_usd: a.cost, done_at: new Date().toISOString(),
  };
}

// Кнопка «Разобрать»: баер — только свои крео и в свой лимит; владелец и тимлид — любые, из общего бюджета.
export async function analyzeCreo(me: Profile, buyerId: string, creo: string): Promise<Analysis> {
  if (me.role === "buyer" && buyerId !== me.id) throw new Error("Можно разбирать только свои крео");
  if (!aiReady()) throw new Error("AI-разборы не подключены");
  creo = creo.trim();
  const row = await compute(buyerId, creo, me.id === buyerId);
  if (row.reused) return row.reused as Analysis;
  const { data, error } = await db().from("ai_creo_analyses")
    .insert({ buyer_id: buyerId, creo, trigger: "manual", requested_by: me.id, charged: me.id === buyerId, ...row })
    .select(COLS).single();
  if (error) throw new Error(error.message);
  return data as Analysis;
}

// Последний разбор по каждому крео, свежие первыми: без текста — для значков в «Отчётах»,
// с текстом — для Главной. Баеру — только свои.
export async function analysesFor(me: Profile, withText: boolean, limit = 2000): Promise<Partial<Analysis>[]> {
  let q = db().from("ai_creo_analyses").select(withText ? COLS : "id, buyer_id, creo, trigger, verdict, created_at")
    .eq("status", "done").order("created_at", { ascending: false }).limit(withText ? limit * 3 : limit);
  if (me.role === "buyer") q = q.eq("buyer_id", me.id);
  const { data } = await q;
  const seen = new Set<string>();
  return ((data ?? []) as unknown as Analysis[]).filter((a) => !seen.has(`${a.buyer_id}|${a.creo}`) && seen.add(`${a.buyer_id}|${a.creo}`)).slice(0, limit);
}

// ── Автоматические разборы: очередь ────────────────────────────────────────

// Один автоматический разбор на «крео × повод» — второй алерт по той же стране его не повторит.
export async function enqueue(buyerId: string, creo: string, trigger: Exclude<Trigger, "manual">): Promise<boolean> {
  if (!aiReady()) return false;
  const { data } = await db().from("ai_creo_analyses").select("id").eq("buyer_id", buyerId).eq("creo", creo).eq("trigger", trigger).limit(1);
  if (data?.length) return false;
  const { error } = await db().from("ai_creo_analyses").insert({ buyer_id: buyerId, creo, trigger, charged: true });
  return !error;
}

const WHY: Record<Exclude<Trigger, "manual">, string> = { test_limit: "прошло границу теста без депов", first_deps: "дало первые депы" };

function telegramText(creo: string, trigger: Exclude<Trigger, "manual">, text: string): string {
  return [`🧠 <b>AI-разбор крео</b> · ${escapeHtml(creo)}`, `<i>Крео ${WHY[trigger]}</i>`, "", toTelegramHtml(text)].join("\n");
}

// Крон kind=ai: разобрать очередь, разбор — баеру в Telegram. Упавший разбор — failed с причиной.
export async function runQueue(budgetMs = 200_000): Promise<{ done: number; failed: number; left: number }> {
  if (!aiReady()) return { done: 0, failed: 0, left: 0 };
  const started = Date.now();
  // Разбор, оборванный таймаутом прошлого прогона, — обратно в очередь.
  await db().from("ai_creo_analyses").update({ status: "queued" }).eq("status", "running").lt("created_at", new Date(Date.now() - 10 * 60_000).toISOString());
  const { data: queue } = await db().from("ai_creo_analyses").select("id, buyer_id, creo, trigger").eq("status", "queued").order("created_at").limit(30);
  const base = dashboardUrl();
  const extra = base ? { reply_markup: { inline_keyboard: [[{ text: "Открыть отчёт", url: `${base}/traffic-report` }]] } } : {};
  let done = 0, failed = 0;
  for (const q of queue ?? []) {
    if (Date.now() - started > budgetMs) break;
    const { data: took } = await db().from("ai_creo_analyses").update({ status: "running" }).eq("id", q.id).eq("status", "queued").select("id");
    if (!took?.length) continue;
    try {
      const row = await compute(q.buyer_id, q.creo, true);
      const r = (row.reused as Analysis | undefined) ?? null;
      const patch = r ? { status: "done", verdict: r.verdict, text: r.text, cost_usd: 0, done_at: new Date().toISOString() } : row;
      await db().from("ai_creo_analyses").update(patch).eq("id", q.id);
      done++;
      try { await notify(q.buyer_id, "ai_analysis", telegramText(q.creo, q.trigger, String(patch.text)), extra); } catch { /* разбор уже в дашборде */ }
    } catch (e) {
      failed++;
      await db().from("ai_creo_analyses").update({ status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 500) }).eq("id", q.id);
    }
  }
  const { count } = await db().from("ai_creo_analyses").select("id", { count: "exact", head: true }).eq("status", "queued");
  return { done, failed, left: count ?? 0 };
}

