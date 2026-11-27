"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipContentProps } from "recharts";
import { chip, seg } from "@/components/ui";
import { DateRange } from "@/components/DatePicker";
import { AXIS_TICK } from "@/components/general-report/shared";
import { mskDay } from "@/lib/day";
import type { Topup } from "@/lib/topups/requests";
import { inRange, MAIN, PERIODS, series, totalsOf, whereTo, whoAsks, type Range } from "@/lib/topups/analytics";

// Аналитика «Пополнений» (Decision 131): сколько ушло, куда, у кого и по дням — по тем же заявкам, что в списке
// (владелец — все, остальные — свои). Считает lib/topups/analytics.ts; здесь только вид.

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");
const reqs = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "заявка" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "заявки" : "заявок"}`;
const pct = (v: number, of: number) => `${of ? Math.round((v / of) * 100) : 0}%`;

function Bar({ v, of, light }: { v: number; of: number; light?: boolean }) {
  return (
    <span className="block h-2 rounded bg-violet-950/60 overflow-hidden">
      <span className={`block h-full rounded ${light ? "bg-violet-400" : "bg-violet-500"}`} style={{ width: `${of ? Math.max(2, (v / of) * 100) : 0}%` }} />
    </span>
  );
}

function Tip({ active, payload }: TooltipContentProps) {
  const p = payload?.[0]?.payload as { tip: string; v: number } | undefined;
  if (!active || !p) return null;
  return (
    <div className="rounded-xl border border-line bg-raised px-3 py-2 text-sm shadow-lg">
      <p className="text-xs text-hint">{p.tip}</p>
      <p className="font-semibold tabular-nums">{fmt(p.v)} {MAIN}</p>
    </div>
  );
}

export default function TopupAnalytics({ rows, admin }: { rows: Topup[]; admin: boolean }) {
  const [range, setRange] = useState<Range>(() => PERIODS.find((p) => p.key === "month")!.range());
  const [who, setWho] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<"day" | "week">("day");

  const authors = useMemo(() => [...new Set(rows.map((r) => r.author ?? "—"))].sort(), [rows]);
  const shown = useMemo(() => inRange(rows, range).filter((r) => !who || r.author === who), [rows, range, who]);
  const t = useMemo(() => totalsOf(shown), [shown]);
  const cats = useMemo(() => whereTo(shown), [shown]);
  const people = useMemo(() => whoAsks(inRange(rows, range)), [rows, range]);
  const points = useMemo(() => series(shown, range, step), [shown, range, step]);
  const peak = points.reduce((m, p) => (p.v > m.v ? p : m), { v: 0, tip: "—", label: "" });
  const topCat = Math.max(1, ...cats.map((c) => c.v));
  const other = Object.entries(t.other).map(([a, v]) => `${fmt(v)} ${a}`).join(" · ");
  const flip = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <div className="space-y-4">
      <div className="card p-5 sm:p-6 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <DateRange since={range.since || rows.map((r) => mskDay(new Date(r.created_at))).sort()[0] || mskDay()} until={range.until || mskDay()}
                     onChange={(since, until) => setRange({ since, until })}
                     active={!PERIODS.some((p) => { const r = p.range(); return r.since === range.since && r.until === range.until; })} />
          <div className="seg">
            {PERIODS.map((p) => {
              const r = p.range();
              return <button key={p.key} type="button" onClick={() => setRange(r)} {...seg(range.since === r.since && range.until === r.until)}>{p.label}</button>;
            })}
          </div>
        </div>
        {admin && authors.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="label w-12 shrink-0">Кто</span>
            <button type="button" {...chip(!who)} onClick={() => setWho("")}>Все</button>
            {authors.map((a) => <button key={a} type="button" {...chip(who === a)} onClick={() => setWho(who === a ? "" : a)}>{a}</button>)}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Ушло", value: `${fmt(t.sent)}`, unit: MAIN, hint: "сколько пришло по блокчейну" },
          { label: "Зашло на бюджеты", value: fmt(t.net), unit: MAIN, hint: t.sentN ? `${t.paid} заявок, средняя — ${fmt(t.sent / t.sentN)}` : "за период оплат нет" },
          { label: "Комиссии", value: fmt(t.fee), unit: MAIN, hint: t.sent ? `${(t.fee / t.sent * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}% от ушедшего` : "—" },
          { label: "Ждут оплаты", value: String(t.waiting), hint: t.waiting ? `на ${fmt(t.waitingSum)} ${MAIN}` : "ничего не висит" },
        ].map((c) => (
          <div key={c.label} className="card px-4 py-3.5 min-w-0">
            <p className="label truncate">{c.label}</p>
            <p className="mt-1.5 text-2xl font-semibold tabular-nums truncate">{c.value} {c.unit && <span className="text-sm font-medium text-hint">{c.unit}</span>}</p>
            <p className="text-xs text-hint mt-1 truncate">{c.hint}</p>
          </div>
        ))}
      </div>
      {other && <p className="text-xs text-hint -mt-2">Другие монеты за период: {other} — в {MAIN} не пересчитываем.</p>}

      <div className="grid md:grid-cols-2 gap-4 items-start">
        <section className="card p-5 sm:p-6 min-w-0" aria-label="Куда уходят деньги">
          <h2 className="text-base font-semibold">Куда уходят деньги</h2>
          <p className="text-xs text-hint mt-1 mb-3">Категория → куда именно, {MAIN}. Нажми на категорию — раскроется.</p>
          {cats.length === 0 ? <p className="text-sm text-hint">За период оплат нет.</p> : cats.map((c) => {
            const on = open.has(c.name) || Boolean(who);
            return (
              <div key={c.name}>
                <button type="button" onClick={() => flip(c.name)} aria-expanded={on}
                        className="w-full grid grid-cols-[minmax(0,1.7fr)_minmax(0,0.8fr)_5rem_2.5rem] items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-raised">
                  <span className="font-semibold text-sm truncate">{on ? "▾" : "▸"} {c.name}</span>
                  <Bar v={c.v} of={topCat} />
                  <span className="text-right tabular-nums font-semibold">{fmt(c.v)}</span>
                  <span className="text-right tabular-nums text-sm text-hint">{pct(c.v, t.sent)}</span>
                </button>
                {on && c.subs.map((s) => (
                  <div key={s.name} className="grid grid-cols-[minmax(0,1.7fr)_minmax(0,0.8fr)_5rem_2.5rem] items-center gap-3 pl-7 pr-2 py-1.5 text-sm text-zinc-300">
                    <span className="truncate">{s.name} <span className="text-hint">· {reqs(s.n)}</span></span>
                    <Bar v={s.v} of={topCat} light />
                    <span className="text-right tabular-nums">{fmt(s.v)}</span>
                    <span className="text-right tabular-nums text-hint">{pct(s.v, t.sent)}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </section>

        <section className="card p-5 sm:p-6 min-w-0" aria-label="Кто запрашивает">
          <h2 className="text-base font-semibold">Кто запрашивает</h2>
          <p className="text-xs text-hint mt-1 mb-3">{admin ? "Автор заявки. Нажми на строку — вся страница по одному человеку." : "Твои оплаченные заявки за период."}</p>
          <div className="grid grid-cols-[minmax(0,1fr)_3.25rem_5.5rem_minmax(0,1.1fr)] gap-3 px-2 pb-2 text-xs text-hint">
            <span>Кто</span><span className="text-right">Заявок</span><span className="text-right">Ушло</span><span>Больше всего — куда</span>
          </div>
          {people.length === 0 ? <p className="text-sm text-hint px-2">За период оплат нет.</p> : people.map((p) => (
            <button key={p.name} type="button" disabled={!admin} onClick={() => setWho(who === p.name ? "" : p.name)} aria-pressed={who === p.name}
                    className={`w-full grid grid-cols-[minmax(0,1fr)_3.25rem_5.5rem_minmax(0,1.1fr)] items-center gap-3 border-t border-line px-2 py-2.5 text-left text-sm
                      ${admin ? "hover:bg-raised" : ""} ${who === p.name ? "bg-violet-900/20" : who ? "opacity-40" : ""}`}>
              <span className="font-semibold truncate">{p.name}</span>
              <span className="text-right tabular-nums">{p.n}</span>
              <span className="text-right tabular-nums font-semibold">{fmt(p.v)}</span>
              <span className="text-hint text-xs truncate">{p.top}</span>
            </button>
          ))}
        </section>
      </div>

      <section className="card p-5 sm:p-6" aria-label="Расход по времени">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex-1 min-w-[220px]">
            <h2 className="text-base font-semibold">Расход по {step === "week" ? "неделям" : "дням"}</h2>
            <p className="text-xs text-hint mt-1">Наведи на график — сумма. Только оплаченные заявки, {MAIN}.</p>
          </div>
          <div className="flex gap-7 flex-wrap">
            <div><p className="label">Больше всего</p><p className="text-lg font-bold tabular-nums">{fmt(peak.v)} <span className="text-sm font-medium text-hint">· {peak.tip}</span></p></div>
            <div><p className="label">В среднем за {step === "week" ? "неделю" : "день"}</p><p className="text-lg font-bold tabular-nums">{fmt(points.length ? t.sent / points.length : 0)} <span className="text-sm font-medium text-hint">{MAIN}</span></p></div>
          </div>
          <div className="seg">
            <button type="button" {...seg(step === "day")} onClick={() => setStep("day")}>Дни</button>
            <button type="button" {...seg(step === "week")} onClick={() => setStep("week")}>Недели</button>
          </div>
        </div>
        {points.length > 1 ? (
          <div className="mt-4 h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="topups-sent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-violet)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--chart-violet)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--chart-muted)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={12} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => fmt(v)} />
                <Tooltip content={(props) => <Tip {...props} />} cursor={{ stroke: "var(--chart-violet-2)", strokeDasharray: "3 4" }} />
                <Area type="monotone" dataKey="v" stroke="var(--chart-violet-2)" strokeWidth={2.5} fill="url(#topups-sent)" activeDot={{ r: 5 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-hint mt-4">Один день — графику нечего показать. Выбери неделю или месяц.</p>
        )}
      </section>
    </div>
  );
}
