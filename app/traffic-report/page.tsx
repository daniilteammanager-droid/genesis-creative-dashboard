"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { DateRange } from "@/components/DatePicker";
import { SummaryCard } from "@/components/general-report/shared";
import { mskDay, mskDaysAgo } from "@/lib/day";
import { ROMI_CUTS, TARGET_DEP, TEST_MULT, groupCreos, romiBand, sortCreos, type GroupMode, type ReportNode, type SortBy, type Stage } from "@/lib/traffic-report/build";
import type { TrafficReport } from "@/lib/traffic-report/load";

// Отчёт по трафику (Decision 098): Баер → страна → крео за любой период, из склада.
// Крео оцениваем по ROMI и этапу теста — правила и цвета в lib/traffic-report/build.ts.

const monthStart = (day: string) => `${day.slice(0, 8)}01`;
const prevMonth = (day: string) => {
  const [y, m] = day.split("-").map(Number);
  const first = new Date(Date.UTC(m === 1 ? y - 1 : y, m === 1 ? 11 : m - 2, 1));
  const last = new Date(Date.UTC(y, m - 1, 0));
  return { since: first.toISOString().slice(0, 10), until: last.toISOString().slice(0, 10) };
};
const PERIODS = [
  { label: "Этот месяц", range: () => ({ since: monthStart(mskDay()), until: mskDay() }) },
  { label: "Прошлый месяц", range: () => prevMonth(mskDay()) },
  { label: "7 дней", range: () => ({ since: mskDaysAgo(6), until: mskDay() }) },
  { label: "30 дней", range: () => ({ since: mskDaysAgo(29), until: mskDay() }) },
];

// 1 лузер, 2 лузера, 5 лузеров.
const lusers = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "лузер" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "лузера" : "лузеров");
const STAGES: { id: Stage; label: string; many: (n: number) => string; chip: string }[] = [
  { id: "deps", label: "Есть депы", many: () => "с депами", chip: "border-green-500/50 text-green-300" },
  { id: "test", label: "На тесте", many: () => "на тесте", chip: "border-amber-400/50 text-amber-200" },
  { id: "loser", label: "Лузер пока что", many: lusers, chip: "border-red-500/50 text-red-300" },
  { id: "nospend", label: "Без спенда", many: () => "без спенда", chip: "border-zinc-600 text-zinc-400" },
];
const BAND = { red: "bg-red-500/25 text-red-200", orange: "bg-orange-500/25 text-orange-200", yellow: "bg-yellow-400/20 text-yellow-100", green: "bg-green-500/25 text-green-200" };

const usd0 = (v: number) => `$${Math.round(v).toLocaleString("ru-RU")}`;
const usd2 = (v: number) => `$${v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (digits: number) => (v: number) => `${(v * 100).toLocaleString("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
const romiText = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v).toLocaleString("ru-RU")}%`;
const show = (v: number | null | undefined, f: (v: number) => string) => (v === null || v === undefined || Number.isNaN(v) ? "—" : f(v));

const COLS: { label: string; cell: (n: ReportNode) => string }[] = [
  { label: "Спенд", cell: (n) => usd0(n.sums.spend) },
  { label: "CPM", cell: (n) => show(n.m.cpm, usd2) },
  { label: "CPC", cell: (n) => show(n.m.cpc, usd2) },
  { label: "CTR", cell: (n) => show(n.m.ctr, pct(2)) },
  { label: "Цена подп.", cell: (n) => show(n.m.cps, usd2) },
  { label: "Клик → подп.", cell: (n) => show(n.m.crSub, pct(1)) },
  { label: "Цена диал.", cell: (n) => show(n.m.cpd, usd2) },
  { label: "Подп. → диал.", cell: (n) => show(n.m.crDia, pct(1)) },
  { label: "Цена депа", cell: (n) => show(n.m.cpdep, usd0) },
  { label: "Диал. → деп", cell: (n) => show(n.m.crDep, pct(1)) },
  { label: "Депы", cell: (n) => n.sums.deps.toLocaleString("ru-RU") },
  { label: "Ревенью", cell: (n) => usd0(n.sums.rev) },
];

const MODES: { id: GroupMode; label: string; hint: string }[] = [
  { id: "creo", label: "Крео", hint: "Каждое объявление отдельно" },
  { id: "text", label: "По тексту", hint: "Все крео одного текста (t11) — одна строка, клик раскрывает крео" },
  { id: "version", label: "Текст + версия", hint: "Все крео одной версии текста (t11_v8) — одна строка, клик раскрывает крео" },
];
const SORTS: { id: SortBy; label: string }[] = [
  { id: "spend", label: "по спенду" }, { id: "romi", label: "по ROMI" }, { id: "deps", label: "по депам" }, { id: "rev", label: "по ревенью" },
];

const chip = (on: boolean) =>
  `px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
    on ? "bg-violet-600 text-white" : "bg-[#111118] border border-violet-900/30 text-zinc-400 hover:text-violet-300 hover:border-violet-700/50"}`;
const control = "bg-[#0d0b14] border border-violet-900/40 rounded-xl px-3 py-2 text-sm text-white";

export default function TrafficReportPage() {
  const [range, setRange] = useState(PERIODS[0].range);
  const [buyer, setBuyer] = useState("all");
  const [data, setData] = useState<TrafficReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [closed, setClosed] = useState<Set<string>>(new Set());   // свёрнутые баеры (по умолчанию раскрыты)
  const [open, setOpen] = useState<Set<string>>(new Set());       // раскрытые страны (по умолчанию свёрнуты)
  const [stage, setStage] = useState<Stage | "">("");
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<GroupMode>("creo");
  const [sortBy, setSortBy] = useState<SortBy>("spend");

  useEffect(() => {
    let alive = true;
    const p = new URLSearchParams({ since: range.since, until: range.until });
    if (buyer !== "all") p.set("buyer", buyer);
    fetch(`/api/traffic-report?${p}`).then((r) => r.json()).then((j) => {
      if (!alive) return;
      if (j.error) setErr(j.error); else { setErr(null); setData(j); }
    }).catch(() => alive && setErr("Не удалось загрузить"));
    return () => { alive = false; };
  }, [range, buyer]);

  const tree = useMemo(() => (data ? sortCreos(groupCreos(data.nodes, mode), sortBy) : []), [data, mode, sortBy]);

  // Видимые строки: дерево с учётом раскрытия. Фильтр — по строке страны (крео или текст):
  // её этап, её имя или имя крео под ней; баер и страна — если под ними есть подходящие.
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtering = Boolean(stage || needle);
    const named = (n: ReportNode) => n.label.toLowerCase().includes(needle) || (n.children ?? []).some((c) => c.label.toLowerCase().includes(needle));
    const hits = (n: ReportNode): boolean => (n.level >= 2 ? (!stage || n.stage === stage) && (!needle || named(n)) : (n.children ?? []).some(hits));
    const isOpen = (n: ReportNode) => (n.level === 0 ? filtering || !closed.has(n.key) : n.level === 1 ? filtering || open.has(n.key) : open.has(n.key));
    const out: { n: ReportNode; open: boolean }[] = [];
    const walk = (list: ReportNode[]) => {
      for (const n of list) {
        if (filtering && n.level <= 2 && !hits(n)) continue;
        out.push({ n, open: isOpen(n) });
        if (n.children && isOpen(n)) walk(n.children);
      }
    };
    walk(tree);
    return out;
  }, [tree, closed, open, stage, q]);

  const toggle = (n: ReportNode) => {
    const flip = (s: Set<string>) => { const x = new Set(s); if (x.has(n.key)) x.delete(n.key); else x.add(n.key); return x; };
    if (n.level === 0) setClosed(flip); else setOpen(flip);
  };
  const expandAll = () => { setClosed(new Set()); setOpen(new Set((data?.nodes ?? []).flatMap((b) => (b.children ?? []).map((g) => g.key)))); };
  const collapseAll = () => { setOpen(new Set()); setClosed(new Set((data?.nodes ?? []).map((b) => b.key))); };

  const t = data?.total;
  const pick = (r: { since: string; until: string }) => { setData(null); setRange(r); };

  return (
    <main className="min-h-screen bg-[#0a080f] text-white p-4 md:p-8">
      <div className="max-w-screen-2xl mx-auto">
        <h1 className="text-white text-3xl font-semibold tracking-wide mb-2">Отчёт по трафику</h1>
        <p className="text-sm text-zinc-500 mb-6">Баер → страна → крео. Крео оцениваем по ROMI и этапу теста.</p>

        <div data-tour="traffic-periods" className="flex flex-wrap items-center gap-2 mb-3">
          <DateRange since={range.since} until={range.until} onChange={(since, until) => pick({ since, until })} />
          {PERIODS.map((p) => {
            const r = p.range();
            return <button key={p.label} onClick={() => pick(r)} className={chip(range.since === r.since && range.until === r.until)}>{p.label}</button>;
          })}
        </div>
        {data && !data.isBuyer && data.buyers.length > 1 && (
          <div className="flex flex-wrap gap-2 mb-5">
            <button onClick={() => { setData(null); setBuyer("all"); }} className={chip(buyer === "all")}>Все баеры</button>
            {data.buyers.map((b) => (
              <button key={b.id} onClick={() => { setData(null); setBuyer(b.id); }} className={chip(buyer === b.id)}>{b.label}</button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-2">
          <SummaryCard label="Спенд" value={t ? usd0(t.sums.spend) : "…"} />
          <SummaryCard label="Ревенью" value={t ? usd0(t.sums.rev) : "…"} />
          <SummaryCard label="ROMI" value={t ? show(t.m.romi, romiText) : "…"} tone={t && t.m.romi !== null ? (t.m.romi >= 0 ? "good" : "bad") : undefined} />
          <SummaryCard label="Депозиты" value={t ? t.sums.deps.toLocaleString("ru-RU") : "…"} />
          <SummaryCard label="Цена депа" value={t ? show(t.m.cpdep, usd0) : "…"} />
        </div>
        <div className="text-xs mb-6 space-y-1">
          {err && <p className="text-red-400">{err}</p>}
          {data?.notice && <p className="text-amber-300/80">{data.notice}</p>}
        </div>

        <section data-tour="traffic-tree" className="bg-[#111118] border border-violet-900/30 rounded-2xl p-4 md:p-5">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-zinc-400 mb-3">
            <span className="text-zinc-500">ROMI:</span>
            <span className="flex items-center gap-1.5"><i className={`w-3 h-3 rounded-sm ${BAND.red}`} />{ROMI_CUTS.red}%</span>
            <span className="flex items-center gap-1.5"><i className={`w-3 h-3 rounded-sm ${BAND.orange}`} />от {ROMI_CUTS.red + 1}% до {ROMI_CUTS.orange}%</span>
            <span className="flex items-center gap-1.5"><i className={`w-3 h-3 rounded-sm ${BAND.yellow}`} />от {ROMI_CUTS.orange + 1}% до {ROMI_CUTS.yellow}%</span>
            <span className="flex items-center gap-1.5"><i className={`w-3 h-3 rounded-sm ${BAND.green}`} />{ROMI_CUTS.yellow + 1}% и выше</span>
          </div>
          <p className="text-xs text-zinc-500 mb-4 max-w-5xl">
            «На тесте» — депов нет и спенд меньше {TEST_MULT.toLocaleString("ru-RU")} × целевой цены депа страны: Испания {usd0(TEST_MULT * TARGET_DEP.ES)},
            Латам {usd0(TEST_MULT * TARGET_DEP.LATAM)}, остальные {usd0(TEST_MULT * TARGET_DEP.OTHER)}. «Лузер пока что» — депов нет, граница пройдена.
            «Есть депы» — оцениваем по ROMI. «Без спенда» — депы и подписки пришли в периоде с крео, которое в нём уже не крутилось.
          </p>

          <div data-tour="traffic-filters" className="flex flex-wrap items-center gap-2 mb-3">
            <div className="flex gap-1 bg-[#0d0b14] border border-violet-900/40 rounded-full p-0.5" role="group" aria-label="Склейка крео">
              {MODES.map((m) => (
                <button key={m.id} title={m.hint} onClick={() => setMode(m.id)} aria-pressed={mode === m.id}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${mode === m.id ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-violet-300"}`}>{m.label}</button>
              ))}
            </div>
            <select id="traffic-sort" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} className={control} aria-label="Сортировка крео">
              {SORTS.map((s) => <option key={s.id} value={s.id}>Крео {s.label}</option>)}
            </select>
            <button onClick={expandAll} className={chip(false)}>Развернуть всё</button>
            <button onClick={collapseAll} className={chip(false)}>Свернуть всё</button>
            <select id="traffic-stage" value={stage} onChange={(e) => setStage(e.target.value as Stage | "")} className={control} aria-label="Этап крео">
              <option value="">Все этапы</option>
              {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <input id="traffic-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск крео" className={`${control} min-w-[10rem] flex-1 max-w-xs`} />
          </div>

          <div className="overflow-auto max-h-[70vh] rounded-xl border border-violet-900/25 [color-scheme:dark]">
            <table className="w-full text-xs tabular-nums border-separate border-spacing-0">
              <thead>
                <tr className="text-zinc-500">
                  <th className="sticky top-0 left-0 z-30 bg-[#111118] text-left font-medium px-3 py-2 border-b border-violet-900/30 min-w-[13rem]">Баер / страна / крео</th>
                  <th className="sticky top-0 z-20 bg-[#111118] text-left font-medium px-3 py-2 border-b border-violet-900/30">Этап</th>
                  {COLS.map((c) => <th key={c.label} className="sticky top-0 z-20 bg-[#111118] text-right font-medium px-3 py-2 border-b border-violet-900/30 whitespace-nowrap">{c.label}</th>)}
                  <th className="sticky top-0 z-20 bg-[#111118] text-right font-medium px-3 py-2 border-b border-violet-900/30">ROMI</th>
                </tr>
              </thead>
              <tbody>
                {!data && !err && <tr><td colSpan={COLS.length + 3} className="px-3 py-6 text-zinc-500">Загружаю…</td></tr>}
                {data && rows.length === 0 && <tr><td colSpan={COLS.length + 3} className="px-3 py-6 text-zinc-500">За этот период расхода и Torro нет.</td></tr>}
                {rows.map(({ n, open: isOpen }) => {
                  const band = romiBand(n.m.romi);
                  const bg = n.level === 0 ? "bg-[#1a1626]" : "bg-[#111118]";
                  const st = STAGES.find((s) => s.id === n.stage);
                  return (
                    <tr key={n.key} onClick={n.children ? () => toggle(n) : undefined} className={`${n.children ? "cursor-pointer" : ""} hover:brightness-125 ${n.level === 0 ? "text-sm font-semibold" : n.level === 1 ? "font-medium" : n.level === 2 ? (n.children ? "text-zinc-100 font-medium" : "text-zinc-300") : "text-zinc-400"}`}>
                      <td className={`sticky left-0 z-10 ${bg} px-3 py-1.5 border-b border-violet-900/15 max-w-[24rem] break-words`} style={{ paddingLeft: `${0.75 + n.level * 1.1}rem` }}>
                        {n.children && <span className="inline-block w-4 text-zinc-500">{isOpen ? "▾" : "▸"}</span>}
                        {n.label}
                        {n.level === 2 && n.children && <span className="text-zinc-500 font-normal"> · {n.children.length} крео</span>}
                      </td>
                      <td className={`${bg} px-3 py-1.5 border-b border-violet-900/15 whitespace-nowrap`}>
                        {st ? (
                          <span className={`inline-block px-2 py-0.5 rounded-md border ${st.chip}`}>{st.label}{n.stage === "test" && n.left !== undefined ? ` · ещё ${usd0(n.left)}` : ""}</span>
                        ) : n.counts ? (
                          <span className="text-zinc-500 font-normal">
                            {STAGES.filter((s) => n.counts![s.id] > 0).map((s, i) => <Fragment key={s.id}>{i > 0 && " · "}{n.counts![s.id]} {s.many(n.counts![s.id])}</Fragment>)}
                          </span>
                        ) : null}
                      </td>
                      {COLS.map((c) => <td key={c.label} className={`${bg} px-3 py-1.5 border-b border-violet-900/15 text-right whitespace-nowrap`}>{c.cell(n)}</td>)}
                      <td className={`${bg} px-3 py-1.5 border-b border-violet-900/15 text-right whitespace-nowrap`}>
                        <span className={`inline-block min-w-[3.5rem] px-1.5 py-0.5 rounded-md ${band ? BAND[band] : "text-zinc-500"}`}>{show(n.m.romi, romiText)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-zinc-600 mt-3 max-w-5xl">
            Спенд, показы и клики — склад (Meta, Telegram Ads; у Артёма за 19.09–23.10 — снимки Genesis Manager), клики — все клики Meta.
            Подписки, диалоги, депы и ревенью — Torro по связке «кампания × объявление», ревенью — депы и редепы за период. Страна — из таргета адсета,
            где его нет — из имени кампании. День спенда — по часовому поясу кабинета, день Torro — по Москве. «Не разнесено по крео» — Torro,
            который не лёг на связки (связки за день не обновились), чтобы итог баера совпадал с Torro.
          </p>
        </section>
      </div>
    </main>
  );
}
