import { mskDay, mskDaysAgo } from "@/lib/day";
import { rangeLabel } from "@/lib/calendar";
import type { Topup } from "./requests";
import { received } from "./view";

// Период и аналитика «Пополнений» (Decision 131): сколько ушло, куда, у кого, по дням. Чистые функции без серверных
// зависимостей — считает страница по тем же заявкам, что в списке. Ушло — что пришло на адрес (received), только
// оплаченные; день — день создания заявки по Москве, как у get_topups в MCP. Суммы — USDT: другие монеты отдельно.

export interface Range { since: string; until: string }   // "" — без границы

const month = (offset: number): Range => {
  const [y, m] = mskDay().split("-").map(Number);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return { since: day(new Date(Date.UTC(y, m - 1 + offset, 1))), until: offset ? day(new Date(Date.UTC(y, m + offset, 0))) : mskDay() };
};
export const PERIODS: { key: string; label: string; range: () => Range }[] = [
  { key: "all", label: "Всё время", range: () => ({ since: "", until: "" }) },
  { key: "today", label: "Сегодня", range: () => ({ since: mskDaysAgo(0), until: mskDaysAgo(0) }) },
  { key: "yday", label: "Вчера", range: () => ({ since: mskDaysAgo(1), until: mskDaysAgo(1) }) },
  { key: "d7", label: "7 дней", range: () => ({ since: mskDaysAgo(6), until: mskDaysAgo(0) }) },
  { key: "month", label: "Этот месяц", range: () => month(0) },
  { key: "prev", label: "Прошлый месяц", range: () => month(-1) },
];

export const MAIN = "USDT";
type R = Pick<Topup, "status" | "asset" | "amount" | "paid_amount" | "fee" | "kind" | "target" | "created_at"> & { author?: string };

export const dayOf = (r: Pick<Topup, "created_at">) => mskDay(new Date(r.created_at));
export const inRange = <T extends Pick<Topup, "created_at">>(rows: T[], g: Range) =>
  rows.filter((r) => { const d = dayOf(r); return (!g.since || d >= g.since) && (!g.until || d <= g.until); });

const paidMain = (rows: R[]) => rows.filter((r) => r.status === "paid" && r.asset === MAIN);

// Итог периода: ушло (USDT), сколько заявок оплачено (все монеты), комиссии справкой, другие монеты, ждут оплаты.
// sentN — сколько из оплаченных в USDT (на них делится средняя заявка).
export interface Totals { sent: number; sentN: number; paid: number; fee: number; other: Record<string, number>; waiting: number; waitingSum: number }
export function totalsOf(rows: R[]): Totals {
  const t: Totals = { sent: 0, sentN: 0, paid: 0, fee: 0, other: {}, waiting: 0, waitingSum: 0 };
  for (const r of rows) {
    if (r.status === "pending") { t.waiting++; if (r.asset === MAIN) t.waitingSum += r.amount; continue; }
    if (r.status !== "paid") continue;
    t.paid++;
    if (r.asset === MAIN) { t.sent += received(r); t.sentN++; t.fee += r.fee; } else t.other[r.asset] = (t.other[r.asset] ?? 0) + received(r);
  }
  return t;
}

export interface Part { name: string; v: number; n: number }
export interface CatPart extends Part { subs: Part[] }
const add = (m: Map<string, Part>, name: string, v: number) => {
  const p = m.get(name) ?? m.set(name, { name, v: 0, n: 0 }).get(name)!;
  p.v += v; p.n++;
};
const desc = <T extends Part>(a: T, b: T) => b.v - a.v || a.name.localeCompare(b.name);

// Куда уходят деньги: категория → «куда».
export function whereTo(rows: R[]): CatPart[] {
  const cats = new Map<string, { part: Part; subs: Map<string, Part> }>();
  for (const r of paidMain(rows)) {
    const c = cats.get(r.kind) ?? cats.set(r.kind, { part: { name: r.kind, v: 0, n: 0 }, subs: new Map() }).get(r.kind)!;
    c.part.v += received(r); c.part.n++;
    add(c.subs, r.target, received(r));
  }
  return [...cats.values()].map((c) => ({ ...c.part, subs: [...c.subs.values()].sort(desc) })).sort(desc);
}

// Кто запрашивает: автор заявки, сколько ушло и куда у него больше всего.
export interface Who extends Part { top: string }
export function whoAsks(rows: R[]): Who[] {
  const by = new Map<string, { part: Part; to: Map<string, Part> }>();
  for (const r of paidMain(rows)) {
    const a = r.author ?? "—";
    const w = by.get(a) ?? by.set(a, { part: { name: a, v: 0, n: 0 }, to: new Map() }).get(a)!;
    w.part.v += received(r); w.part.n++;
    add(w.to, `${r.kind} · ${r.target}`, received(r));
  }
  return [...by.values()].map((w) => ({ ...w.part, top: [...w.to.values()].sort(desc)[0]?.name ?? "" })).sort(desc);
}

// График: сколько ушло за каждый день или неделю периода, пустые дни — нулём. Без границ — от первой заявки до сегодня.
export interface Point { label: string; tip: string; v: number }
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export function series(rows: R[], g: Range, step: "day" | "week", today = mskDay()): Point[] {
  const paid = paidMain(rows);
  const days = paid.map(dayOf).sort();
  const since = g.since || days[0] || today, until = g.until || today;
  const by = new Map<string, number>();
  for (const r of paid) by.set(dayOf(r), (by.get(dayOf(r)) ?? 0) + received(r));
  const all: string[] = [];
  for (let d = since; d <= until && all.length < 800; d = plus(d, 1)) all.push(d);
  if (step === "day") return all.map((d) => ({ label: String(Number(d.slice(8))), tip: rangeLabel(d, d), v: by.get(d) ?? 0 }));
  const out: Point[] = [];
  for (let i = 0; i < all.length; i += 7) {
    const part = all.slice(i, i + 7), a = part[0], b = part[part.length - 1];
    out.push({ label: a === b ? String(Number(a.slice(8))) : `${Number(a.slice(8))}–${Number(b.slice(8))}`, tip: rangeLabel(a, b), v: part.reduce((s, d) => s + (by.get(d) ?? 0), 0) });
  }
  return out;
}
