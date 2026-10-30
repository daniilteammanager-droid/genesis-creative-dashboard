import { warehouse } from "@/lib/warehouse/read";
import type { Profile } from "@/lib/auth/types";
import { mskDay } from "@/lib/day";
import { notify } from "@/lib/telegram/links";
import { loadTrafficReport } from "@/lib/traffic-report/load";
import { geoName, metricsOf, regionName, REST, type Cell, type Sums } from "@/lib/traffic-report/build";
import { aiReady, ask, SUMMARY_MODEL } from "./claude";
import { chunks, toTelegramHtml } from "./prompt";

// Недельная AI-сводка владельцу и тимлиду (Decision 101): по каждому баеру — что работает, что
// сливает, что делать; по команде — закономерности по подходам, текстам и гео. Сама — по
// понедельникам (крон kind=ai, после 10:00 МСК), кнопкой на Главной — за последние 7 дней.

const DAY = 86_400_000;
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const dow = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;   // 0 — понедельник

export function lastWeek(today = mskDay()): { since: string; until: string } {
  const monday = shift(today, -dow(today));
  return { since: shift(monday, -7), until: shift(monday, -1) };
}

const SYSTEM = `Ты — руководитель отдела медиабаинга и разбираешь неделю команды. Воронка: реклама в Facebook и Telegram Ads →
подписка на Telegram (ПДП) → диалог с менеджером (ДИА) → депозит (деп). ROMI = (ревенью − спенд) / спенд. Целевая цена депа:
Испания $300, Латам $200. Код крео: подход — tN номер текста — vN версия монтажа — bN баер — язык-гео.

Напиши сводку недели на русском, до 600 слов, для владельца команды:
1. По каждому баеру (отдельным блоком, имя жирным): итог недели к прошлой; что работает — крео, подходы, тексты с цифрами;
   что сливает; 2–3 конкретных действия на эту неделю.
2. По команде: какие подходы, тексты и хуки дают депы у разных баеров, какие гео тянут, что стоит перенести от одного баера
   другому, 3 действия на неделю.
Опирайся только на цифры и транскрипты из запроса. Без таблиц и заголовков «#», можно **жирный** и списки через «- ».`;

const zero = (): Sums => ({ spend: 0, impr: 0, clicks: 0, subs: 0, dia: 0, deps: 0, rev: 0 });
const add = (a: Sums, b: Sums) => { for (const k of Object.keys(a) as (keyof Sums)[]) a[k] += b[k]; };
const fmt = (s: Sums) => {
  const m = metricsOf(s);
  return `спенд $${s.spend.toFixed(0)}, подписок ${s.subs}, диалогов ${s.dia}, депов ${s.deps}, ревенью $${Math.round(s.rev)}, ` +
    `ROMI ${m.romi === null ? "—" : `${m.romi.toFixed(0)}%`}, цена депа ${m.cpdep === null ? "—" : `$${m.cpdep.toFixed(0)}`}`;
};
const baseOf = (creo: string) => creo.toLowerCase().match(/^([a-z]+-[a-z0-9]+-t\d+-v\d+)(?=-|$)/)?.[1] ?? null;

async function hooks(bases: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!bases.length) return out;
  const { data } = await warehouse().from("creative_notes").select("creative_code, transcription_ru")
    .or(bases.map((b) => `creative_code.ilike.${b}-*`).join(",")).not("transcription_ru", "is", null);
  for (const r of data ?? []) {
    const b = baseOf(r.creative_code as string);
    if (b && !out.has(b)) out.set(b, String(r.transcription_ru).replace(/\s+/g, " ").slice(0, 160));
  }
  return out;
}

export function summaryPrompt(week: Cell[], prev: Cell[], hook: Map<string, string>, range: { since: string; until: string }): string {
  const buyers = [...new Set(week.map((c) => c.buyer))].sort();
  const sum = (cells: Cell[]) => cells.reduce((s, c) => (add(s, c.sums), s), zero());
  const lines = [`Неделя ${range.since} — ${range.until}.`, ""];
  for (const b of buyers) {
    const mine = week.filter((c) => c.buyer === b);
    lines.push(`## Баер ${b}: ${fmt(sum(mine))}`, `Прошлая неделя: ${fmt(sum(prev.filter((c) => c.buyer === b)))}`);
    const byCreo = new Map<string, { s: Sums; geos: Set<string> }>();
    for (const c of mine) {
      if (c.geo === REST) continue;
      const x = byCreo.get(c.creo) ?? byCreo.set(c.creo, { s: zero(), geos: new Set() }).get(c.creo)!;
      add(x.s, c.sums);
      if (c.sums.spend > 0 || c.sums.deps > 0) x.geos.add(geoName(c.geo));
    }
    // Топ по спенду и все с депами — остальное шум для недельного взгляда.
    const top = [...byCreo].sort((a, b2) => b2[1].s.spend - a[1].s.spend);
    const picked = [...top.slice(0, 20), ...top.slice(20).filter(([, x]) => x.s.deps > 0)];
    for (const [creo, x] of picked) {
      const h = hook.get(baseOf(creo) ?? "");
      lines.push(`- ${creo} (${[...x.geos].join(", ")}): ${fmt(x.s)}${h ? `. Начало текста: «${h}»` : ""}`);
    }
    lines.push("");
  }
  const regions = new Map<string, Sums>();
  for (const c of week) if (c.geo !== REST) add(regions.get(regionName(c.geo)) ?? regions.set(regionName(c.geo), zero()).get(regionName(c.geo))!, c.sums);
  lines.push(`## Команда: ${fmt(sum(week))}`, `Прошлая неделя: ${fmt(sum(prev))}`, ...[...regions].map(([r, s]) => `- ${r}: ${fmt(s)}`));
  return lines.join("\n");
}

export async function weeklySummary(asProfile: Profile, range = lastWeek()): Promise<{ text: string; cost: number }> {
  if (!aiReady()) throw new Error("AI-разборы не подключены");
  const owner = { ...asProfile, role: "main" } as Profile;
  const [week, prev] = await Promise.all([
    loadTrafficReport(owner, range.since, range.until),
    loadTrafficReport(owner, shift(range.since, -7), shift(range.until, -7)),
  ]);
  if (!week.cells.length) throw new Error("За неделю нет цифр");
  const bases = [...new Set(week.cells.map((c) => baseOf(c.creo)).filter((b): b is string => Boolean(b)))];
  const a = await ask(SUMMARY_MODEL, SYSTEM, summaryPrompt(week.cells, prev.cells, await hooks(bases), range), 16000);
  const { error } = await warehouse().from("ai_summaries").upsert({
    week: range.since, text: a.text, model: a.model, input_tokens: a.inputTokens, output_tokens: a.outputTokens, cost_usd: a.cost,
    created_at: new Date().toISOString(),
  }, { onConflict: "week" });
  if (error) throw new Error(error.message);
  return { text: a.text, cost: a.cost };
}

export async function latestSummary(): Promise<{ week: string; text: string; created_at: string } | null> {
  const { data } = await warehouse().from("ai_summaries").select("week, text, created_at").order("created_at", { ascending: false }).limit(1);
  return (data?.[0] as { week: string; text: string; created_at: string } | undefined) ?? null;
}

// Крон: по понедельникам после 10:00 МСК, раз в неделю — сводку в базу и владельцу с тимлидом в Telegram.
export async function runWeekly(now = new Date()): Promise<string> {
  if (!aiReady()) return "off";
  const today = mskDay(now);
  if (dow(today) !== 0 || (now.getUTCHours() + 3) % 24 < 10) return "not yet";
  const range = lastWeek(today);
  const { data: done } = await warehouse().from("ai_summaries").select("week").eq("week", range.since).limit(1);
  if (done?.length) return "done";
  const { data: heads } = await warehouse().from("profiles").select("*").in("role", ["main", "teamlead"]).eq("status", "active");
  if (!heads?.length) return "no owners";
  const { text } = await weeklySummary(heads[0] as Profile, range);
  const parts = chunks(`🧠 <b>AI-сводка недели</b> · ${range.since} — ${range.until}\n\n${toTelegramHtml(text)}`);
  for (const h of heads) for (const p of parts) await notify(h.id as string, "ai_weekly", p).catch(() => 0);
  return "sent";
}
