import { warehouse } from "@/lib/warehouse/read";
import { escapeHtml, sendToLinks } from "@/lib/telegram/links";
import { mskDay, mskTime } from "@/lib/day";
import type { Profile } from "@/lib/auth/types";
import { dashboardUrl, dueSlot } from "./autocheck";
import { facesMessage, loadFaces, n0, nb, reportButton, romiTds, td, type BuyerLine, type Rich } from "./faces";

// Утренняя сводка владельцу и тимлиду (Decision 066). Моментальные алерты им
// больше не идут — только баеру, чей кабинет. Вместо них раз в день: вчерашние
// цифры по лицам, площадкам и странам с общим итогом, под ним баеры и что сломалось
// за день; по будням, а в понедельник — пятница, суббота, воскресенье и неделя (morningPlan).
//
// Цифры — те же, что в «Отчётах» (faces.ts): сводка и «Отчёты» за вчера обязаны совпадать.
// ponytail: время константой; понадобится своё у каждого — переедет в привязку, как у авточека.
export const SUMMARY_TIME = "09:00";

// Проблемные статусы кабинета — те же, по которым шлётся алерт (cabinets.ts).
const PROBLEM = ["DISABLED", "MISSING", "IN_GRACE_PERIOD", "UNSETTLED", "PENDING_RISK_REVIEW"];
const NO_OWNER = "без владельца";

export interface TroubleLine { label: string; cabinets: number; rejected: number }

const money = (v: number) => v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const line = (spend: number, revenue: number | null, romi: number | null) =>
  `${money(spend)}$ / доход ${revenue === null ? "—" : `${money(revenue)}$`} / ROMI ${romi === null ? "—" : `${romi.toFixed(0)}%`}`;

// head — готовый HTML отчёта по лицам (facesMessage) с общим итогом; под ним баеры и что сломалось.
export function summaryText(head: string, buyers: BuyerLine[], trouble: TroubleLine[], period = "За сутки"): string {
  const e = escapeHtml;
  const lines = [head, "", "<b>По баерам:</b>"];
  // Баеры без расхода за период — не строка сводки, а шум.
  const spent = buyers.filter((x) => x.spend > 0).sort((a, b) => b.spend - a.spend);
  for (const b of spent) lines.push(`${e(b.label)}: ${line(b.spend, b.revenue, b.romi)}`);
  if (!spent.length) lines.push("расхода не было");

  const bad = trouble.filter((t) => t.cabinets || t.rejected);
  lines.push("", `<b>${period}:</b>`);
  if (!bad.length) lines.push("блокировок и отклонений не было ✅");
  for (const t of bad) lines.push(`${e(t.label)} — ${troubleOf(t)}`);
  return lines.join("\n");
}

const troubleOf = (t: TroubleLine) => [
  t.cabinets ? `проблемных кабинетов: ${t.cabinets}` : null,
  t.rejected ? `отклонённых объявлений: ${t.rejected}` : null,
].filter(Boolean).join(", ");

// Rich-вид той же сводки: head — rich отчёта по лицам; баеры таблицей, что сломалось — свёрнуто, наружу только сумма.
// Строки не переносятся — как в отчёте по лицам (faces.ts): ROMI — двумя ячейками, пробелы неразрывные.
export function summaryRich(head: string, buyers: BuyerLine[], trouble: TroubleLine[]): string {
  const e = escapeHtml;
  const spent = buyers.filter((x) => x.spend > 0).sort((a, b) => b.spend - a.spend);
  const table = spent.length
    ? `<table bordered striped compact><tr><th>Баер</th><th>Спенд</th><th>Доход</th><th colspan="2">ROMI</th></tr>${spent.map((b) =>
      `<tr><td>${nb(e(b.label))}</td>${td(n0(b.spend))}${td(b.revenue === null ? "—" : n0(b.revenue))}${romiTds(b.romi)}</tr>`).join("")}</table>`
    : "<p>Расхода не было.</p>";
  const bad = trouble.filter((t) => t.cabinets || t.rejected);
  const cabs = bad.reduce((a, t) => a + t.cabinets, 0), rej = bad.reduce((a, t) => a + t.rejected, 0);
  const tail = bad.length
    ? `<details><summary>⚠️ Кабинеты ${cabs} · отклонения ${rej}</summary><table bordered striped compact>`
      + `<tr><th>Баер</th><th>Кабинеты</th><th>Отклонения</th></tr>${bad.map((t) =>
      `<tr><td>${nb(e(t.label))}</td>${td(String(t.cabinets))}${td(String(t.rejected))}</tr>`).join("")}</table></details>`
    : "<p>✅ Без блокировок и отклонений</p>";
  return `${head}<h4>По баерам</h4>${table}${tail}`;
}

interface LinkRow { id: string; user_id: string; chat_id: number; thread_id: number | null; summary_sent_slot: string | null }
interface Report { message: Rich; button: Record<string, unknown> }

const ddmm = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;
const noon = (day: string) => new Date(`${day}T12:00:00Z`);
const shift = (day: string, n: number) => { const d = noon(day); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = (day: string) => new Intl.DateTimeFormat("ru", { weekday: "short", timeZone: "UTC" }).format(noon(day));
// Начало московских суток дня — граница окна «что сломалось».
const mskStart = (day: string) => new Date(`${day}T00:00:00+03:00`).toISOString();

// Какие отчёты уходят утром этого дня (Даниил, 16.11.2026): по будням — за вчера; в субботу и воскресенье —
// ничего, пятница и выходные приходят в понедельник отдельными сообщениями, следом — прошлая неделя целиком.
export function morningPlan(day: string): { since: string; until: string; title: string; period: string }[] {
  const dow = noon(day).getUTCDay();
  const one = (n: number) => {
    const d = shift(day, -n);
    return { since: d, until: d, title: `📊 Отчёт за ${ddmm(d)}, ${weekday(d)}`, period: "За день" };
  };
  if (dow === 0 || dow === 6) return [];
  if (dow !== 1) return [one(1)];
  const from = shift(day, -7), to = shift(day, -1);
  return [one(3), one(2), one(1), { since: from, until: to, title: `📊 Отчёт за неделю ${ddmm(from)}–${ddmm(to)}`, period: "За неделю" }];
}

// Что сломалось за сутки, по тому, за кем кабинет: ровно то, о чём ушёл бы
// алерт (alerted_at), а не всё, что впервые попало в таблицу.
// until — конец окна (не включая); нет — по сейчас. У кабинета alerted_at — последний алерт: кабинет,
// который снова упал позже окна, в окно уже не попадёт.
export async function troubleByOwner(since: string, label: Map<string, string>, until?: string): Promise<TroubleLine[]> {
  const db = warehouse();
  const upTo = <T extends { lt: (c: string, v: string) => T }>(q: T) => (until ? q.lt("alerted_at", until) : q);
  const [{ data: cabs }, { data: ads }] = await Promise.all([
    upTo(db.from("wh_cabinet_states").select("account_id").in("status", PROBLEM).gte("alerted_at", since)),
    upTo(db.from("wh_rejected_ads").select("account_id, owner_user_id").gte("alerted_at", since)),
  ]);
  const ids = [...new Set([...(cabs ?? []), ...(ads ?? [])].map((r) => r.account_id as string))];
  const { data: owners } = ids.length
    ? await db.from("wh_account_owners").select("account_id, owner_user_id").in("account_id", ids)
    : { data: [] };
  const ownerOf = new Map((owners ?? []).map((o) => [o.account_id as string, o.owner_user_id as string | null]));
  const by = new Map<string, TroubleLine>();
  const bump = (accountId: string, k: "cabinets" | "rejected", direct?: string | null) => {
    const owner = direct ?? ownerOf.get(accountId);
    const name = owner ? label.get(owner) ?? owner : NO_OWNER;
    const t = by.get(name) ?? { label: name, cabinets: 0, rejected: 0 };
    t[k]++;
    by.set(name, t);
  };
  for (const c of cabs ?? []) bump(c.account_id as string, "cabinets");
  for (const a of ads ?? []) bump(a.account_id as string, "rejected", a.owner_user_id as string | null);
  return [...by.values()];
}

export async function runDailySummary(at: Date = new Date()): Promise<{ due: number; sent: number; failed: number }> {
  const db = warehouse();
  const day = mskDay(at), now = mskTime(at);
  const { data, error } = await db.from("telegram_links")
    .select("id, user_id, chat_id, thread_id, summary_sent_slot")
    .contains("events", ["daily_summary"]);
  if (error) throw new Error(`telegram_links: ${error.message}`);

  const due = ((data ?? []) as LinkRow[])
    .map((l) => ({ link: l, slot: dueSlot([SUMMARY_TIME], day, now, l.summary_sent_slot) }))
    .filter((d): d is { link: LinkRow; slot: string } => d.slot !== null);
  if (due.length === 0) return { due: 0, sent: 0, failed: 0 };

  const { data: profiles } = await db.from("profiles").select("*").in("id", [...new Set(due.map((d) => d.link.user_id))]);
  const profileOf = new Map(((profiles ?? []) as Profile[]).map((p) => [p.id, p]));

  // Сводка одна на всех получателей: и владелец, и тимлид видят всю команду.
  let texts: Promise<Report[]> | null = null;
  // Отчёты дня собираются по очереди: в понедельник их четыре, и все уходят в одном порядке.
  const build = async (me: Profile): Promise<Report[]> => {
    const out: Report[] = [];
    for (const p of morningPlan(day)) out.push(await report(me, p.since, p.until, p.title, p.period));
    return out;
  };
  const report = async (me: Profile, since: string, until: string, title: string, period: string): Promise<Report> => {
    const [{ rows, buyers }, { data: people }] = await Promise.all([
      loadFaces(me, since, until),
      db.from("profiles").select("id, name, email, buyer_code"),
    ]);
    const label = new Map((people ?? []).map((p) => [p.id as string, (p.name as string) || (p.buyer_code as string) || (p.email as string)]));
    const trouble = await troubleByOwner(mskStart(since), label, mskStart(shift(until, 1)));
    const head = facesMessage(rows, title);
    return {
      message: { rich: summaryRich(head.rich, buyers, trouble), text: summaryText(head.text, buyers, trouble, period).replace(/(\d),(\d)/g, "$1.$2") },
      button: reportButton(dashboardUrl()),
    };
  };

  let sent = 0, failed = 0;
  for (const { link, slot } of due) {
    const me = profileOf.get(link.user_id);
    // Баеру сводка не положена: в ней цифры всей команды.
    if (me?.status === "active" && (me.role === "main" || me.role === "teamlead")) {
      try {
        texts ??= build(me);
        for (const r of await texts) sent += await sendToLinks([link], r.message, r.button);
      } catch (e) {
        // Слот не отмечаем: следующий прогон в пределах получаса попробует снова.
        failed++;
        texts = null;
        console.warn("summary:", e instanceof Error ? e.message : e);
        continue;
      }
    }
    await db.from("telegram_links").update({ summary_sent_slot: slot }).eq("id", link.id);
  }
  return { due: due.length, sent, failed };
}
