"use client";

import { useEffect, useState } from "react";
import { SummaryCard } from "@/components/general-report/shared";
import { COLS, money, type Metrics } from "@/app/live-manager/columns";
import type { HomeMetrics } from "@/lib/home/summary";
import { PERIODS, type PeriodId } from "@/lib/home/periods";
import { MIN_MONTHLY_SPEND, type Board, type Standing } from "@/lib/home/leaderboard";
import { useProfile } from "@/components/Shell";

// Главная: свои цифры за период (склад) и рейтинг баеров (таблицы General 4.0).
// Карточки — столбцы Live Manager: те же формулы, ничего второй раз не считаем.

// Охват и частота за период в склад не складываются (Decision 089) — в карточки не берём.
const CARDS = COLS.filter((c) => c.label !== "Охват" && c.label !== "Частота");
const DEFAULT_CARDS = ["Расход", "CPC", "CPM", "Цена подписки", "Цена диалога", "Доход", "Net Profit"];
const CARDS_KEY = "home:cards";

const chip = (active: boolean) =>
  `px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
    active ? "bg-violet-600 text-white"
      : "bg-[#111118] border border-violet-900/30 text-zinc-400 hover:text-violet-300 hover:border-violet-700/50"}`;

const tone = (label: string, x: Metrics): "good" | "bad" | undefined => {
  if ((label !== "Net Profit" && label !== "ROMI") || x.depSum === null || !x.spend) return undefined;
  return x.depSum >= x.spend ? "good" : "bad";
};

export default function HomePage() {
  const me = useProfile();
  const [period, setPeriod] = useState<PeriodId>("7d");
  const [data, setData] = useState<HomeMetrics | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cards, setCards] = useState<string[]>(() => {
    try { const v = JSON.parse(localStorage.getItem(CARDS_KEY) ?? "null"); return Array.isArray(v) && v.length ? v : DEFAULT_CARDS; } catch { return DEFAULT_CARDS; }
  });
  const [cardsOpen, setCardsOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/home/metrics?period=${period}`).then((r) => r.json()).then((j) => {
      if (!alive) return;
      if (j.error) setErr(j.error); else setData(j);
    }).catch(() => alive && setErr("Не удалось загрузить"));
    return () => { alive = false; };
  }, [period]);

  const toggleCard = (label: string) => {
    const next = cards.includes(label) ? cards.filter((c) => c !== label) : [...cards, label];
    if (!next.length) return;
    setCards(next);
    try { localStorage.setItem(CARDS_KEY, JSON.stringify(next)); } catch { /* приватное окно */ }
  };

  const team = me && me.role !== "buyer";

  return (
    <main className="min-h-screen bg-[#0a080f] text-white p-4 md:p-8">
      <div className="max-w-screen-2xl mx-auto">
        <h1 className="text-white text-3xl font-semibold tracking-wide mb-6">
          {me?.name ? `Привет, ${me.name}` : "Главная"}
        </h1>

        <div data-tour="home-periods" className="flex flex-wrap items-center gap-2 mb-3">
          {PERIODS.map((p) => (
            <button key={p.id} onClick={() => { if (p.id !== period) { setData(null); setErr(null); setPeriod(p.id); } }} className={chip(period === p.id)}>{p.label}</button>
          ))}
          <button onClick={() => setCardsOpen((v) => !v)} className={chip(cardsOpen)}>⚙ Настроить</button>
          <span className="text-xs text-zinc-600">{team ? "Вся команда" : "По твоим подключениям"} · склад обновляется раз в 15 минут</span>
        </div>

        {cardsOpen && (
          <div className="bg-[#111118] border border-violet-900/30 rounded-2xl p-4 mb-4 flex flex-wrap gap-2">
            {CARDS.map((c) => (
              <button key={c.label} className={chip(cards.includes(c.label))} onClick={() => toggleCard(c.label)}>{c.label}</button>
            ))}
          </div>
        )}

        <div data-tour="home-metrics" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 mb-2">
          {cards.map((l) => CARDS.find((c) => c.label === l)).filter((c) => c !== undefined).map((c) => (
            <SummaryCard key={c.label} label={c.label} value={data ? c.cell(data.totals) : "…"} tone={data ? tone(c.label, data.totals) : undefined} />
          ))}
        </div>
        <div className="text-xs text-zinc-600 mb-10 space-y-1">
          {err && <p className="text-red-400">{err}</p>}
          {data?.notice && <p className="text-amber-300/80">{data.notice}</p>}
        </div>

        <Leaders team={Boolean(team)} />
      </div>
    </main>
  );
}

function Leaders({ team }: { team: boolean }) {
  const [data, setData] = useState<{ quarter: Board; allTime: Board; failed: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/home/leaders").then((r) => r.json()).then((j) => (j.error ? setErr(j.error) : setData(j))).catch(() => setErr("Не удалось загрузить"));
  }, []);

  return (
    <section data-tour="home-leaders">
      <h2 className="text-lg font-semibold mb-1">Рейтинг баеров</h2>
      <p className="text-xs text-zinc-500 mb-4">
        Место — по профиту (доход − расход) из таблиц General 4.0. «Эффективность» — лучший ROMI среди тех, кто лил
        в среднем от ${(MIN_MONTHLY_SPEND / 1000).toFixed(0)}k в месяц.
      </p>
      {err && <p className="text-red-400 text-sm">{err}</p>}
      {!data && !err && <p className="text-zinc-500 text-sm">Загружаю…</p>}
      {data && (
        <div className="grid md:grid-cols-2 gap-4">
          <BoardCard title="🏆 За 3 месяца" board={data.quarter} team={team} />
          <BoardCard title="👑 За всё время" board={data.allTime} team={team} />
        </div>
      )}
      {data && data.failed.length > 0 && (
        <p className="text-xs text-amber-300/80 mt-3">Не прочиталась таблица: {data.failed.join(", ")} — в рейтинге без них.</p>
      )}
    </section>
  );
}

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(0)}%`);
const romiColor = (v: number | null) => (v === null ? "text-zinc-400" : v >= 0 ? "text-green-400" : "text-red-400");

function BoardCard({ title, board, team }: { title: string; board: Board; team: boolean }) {
  const nominee = (label: string, x: Standing | null, value: (x: Standing) => string) => (
    <div className="flex-1 min-w-[140px] bg-[#0d0b14] border border-violet-900/25 rounded-xl px-3 py-2">
      <p className="text-[11px] text-zinc-500 uppercase tracking-wider">{label}</p>
      <p className="text-sm text-white truncate">{x ? `${x.label}${x.me ? " — ты" : ""}` : "нет претендентов"}</p>
      {x && <p className="text-xs text-zinc-400 tabular-nums">{value(x)}</p>}
    </div>
  );
  return (
    <div className="bg-[#111118] border border-violet-900/30 rounded-2xl p-4">
      <p className="font-semibold mb-3">{title}</p>
      {board.ranking.length === 0 ? (
        <p className="text-sm text-zinc-500">Расхода за период нет ни у кого.</p>
      ) : (
        <ol className="mb-4">
          {board.ranking.map((x, i) => (
            <li key={x.id} className={`flex items-center gap-3 px-2 py-1.5 rounded-lg text-sm ${x.me ? "bg-violet-900/25" : ""}`}>
              <span className="w-5 text-zinc-500 tabular-nums">{i + 1}</span>
              <span className="flex-1 truncate">{x.label}{x.me && <span className="text-violet-300"> — ты</span>}</span>
              {team && <span className="tabular-nums text-zinc-300">{money(x.profit ?? null)}</span>}
              <span className={`tabular-nums w-14 text-right ${romiColor(x.romi)}`}>{pct(x.romi)}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap gap-2">
        {nominee("Объём", board.volume, (x) => (team ? `расход ${money(x.spend ?? null)} · ROMI ${pct(x.romi)}` : `ROMI ${pct(x.romi)}`))}
        {nominee("Эффективность", board.efficiency, (x) => `ROMI ${pct(x.romi)}`)}
      </div>
    </div>
  );
}
