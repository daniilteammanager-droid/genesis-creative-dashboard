"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { DateRange } from "@/components/DatePicker";
import { SummaryCard } from "@/components/general-report/shared";
import { mskDay, mskDaysAgo } from "@/lib/day";
import {
  DIMS, DIM_LABELS, REST, ROMI_CUTS, TARGET_DEP, TEST_MULT, dimOptions, filterCells, geoName, groupCreos, lifeMap, metricsOf, romiBand, sortCreos, sumAllTime, sumRejects, totalOf, treeOf,
  type Dim, type Filters, type GroupMode, type Rejects, type ReportNode, type SortBy, type Stage, type Sums,
} from "@/lib/traffic-report/build";
import type { CreoAllTime, TrafficReport } from "@/lib/traffic-report/load";
import { ColumnPicker, useColumns } from "@/components/ColumnPicker";
import { HoverTip } from "@/components/HoverTip";
import AiPanel, { VERDICT, type Verdict } from "./AiPanel";
import { CreoLink } from "@/components/CreoModal";
import { Busy, chip, seg } from "@/components/ui";

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
const BAND = { red: "bg-red-500/25 text-red-200", orange: "bg-orange-500/25 text-orange-200", yellow: "bg-yellow-500/20 text-yellow-100", green: "bg-green-500/25 text-green-200" };

const usd0 = (v: number) => `$${Math.round(v).toLocaleString("ru-RU")}`;
const usd2 = (v: number) => `$${v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (digits: number) => (v: number) => `${(v * 100).toLocaleString("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
const romiText = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v).toLocaleString("ru-RU")}%`;
const show = (v: number | null | undefined, f: (v: number) => string) => (v === null || v === undefined || Number.isNaN(v) ? "—" : f(v));

const plural = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many;

// Строка таблицы и её всё время по всем странам: у крео — своё, у склейки t11 — сумма её крео.
// rej — реджекты крео (у склейки — сумма), «tg» — крео только в TG Ads, там модерация своя. hasLife — всё время пришло.
type Row = { n: ReportNode; all?: CreoAllTime; allSums?: Sums | null; glued: boolean; rej: Rejects | "tg" | null; hasLife: boolean };
const chipCls = "inline-block min-w-[3.5rem] px-1.5 py-0.5 rounded-md";
const HISTORY_FROM = "история с 24.10.2026";
// Столбцы по умолчанию: этап, реджекты (24.11.2026), статус, спенд и сразу ROMI (Daniil 17.11.2026); свой набор и порядок — «Столбцы».
const COLS: { label: string; title?: string; left?: boolean; cell: (r: Row) => ReactNode }[] = [
  { label: "Этап", left: true, title: "Этап крео — по всему времени крео в этой стране, а не по периоду", cell: ({ n }) => {
    const st = STAGES.find((s) => s.id === n.stage);
    if (st) return (
      <span title={n.life ? `За всё время в стране: спенд ${usd0(n.life.spend)}, депов ${n.life.deps}` : undefined}
            className={`inline-block px-2 py-0.5 rounded-md border ${st.chip}`}>{st.label}{n.stage === "test" && n.left !== undefined ? ` · ещё ${usd0(n.left)}` : ""}</span>
    );
    return n.counts ? (
      <span className="text-hint font-normal">
        {STAGES.filter((s) => n.counts![s.id] > 0).map((s, i) => <Fragment key={s.id}>{i > 0 && " · "}{n.counts![s.id]} {s.many(n.counts![s.id])}</Fragment>)}
      </span>
    ) : null;
  } },
  { label: "Реджекты", left: true, title: `Сколько раз Meta отклоняла объявления с этим крео у баера — за всё время, по всем странам (${HISTORY_FROM}). Наведи — объявления и причины`, cell: ({ rej, glued }) => {
    if (!rej) return null;
    if (rej === "tg") return <HoverTip label="Реджекты: TG Ads" className="px-1 text-hint cursor-help" tip={<p>У TG Ads своя модерация — отклонения Meta тут не считаем.</p>}>—</HoverTip>;
    const bad = rej.n > 0;
    return (
      <HoverTip label={`Реджекты: ${rej.n}`} tip={<>
        <p className="text-sm font-semibold text-white">{bad ? `${rej.n} ${plural(rej.n, "отклонение", "отклонения", "отклонений")} · ${rej.ads} ${plural(rej.ads, "объявление", "объявления", "объявлений")}` : "Отклонений не было"}</p>
        {bad && <p className="text-zinc-400">Сейчас отклонено: {rej.now}</p>}
        {bad && (
          <div className="pt-1.5 border-t border-line space-y-0.5">
            <p className="text-hint">Причины Meta · объявлений</p>
            {rej.reasons.map(([p, c]) => <p key={p} className="flex justify-between gap-3"><span>{p}</span><span className="tabular-nums text-red-300">{c}</span></p>)}
          </div>
        )}
        <p className="text-hint">{glued ? "Сумма крео строки · " : ""}Всё время, все страны · {HISTORY_FROM}</p>
      </>} className={`inline-block min-w-[2.25rem] px-1.5 py-0.5 rounded-md text-center tabular-nums cursor-help ring-1 ring-inset ${bad ? "bg-red-500/20 text-red-200 ring-red-500/45" : "bg-green-500/20 text-green-200 ring-green-500/45"}`}>{rej.n}</HoverTip>
    );
  } },
  { label: "Статус", left: true, title: "Последнее состояние объявлений с этим крео у баера (обновляется раз в час)", cell: ({ all }) =>
    all?.active === true ? <span className="text-green-300">● активно</span> : all?.active === false ? <span className="text-hint">○ остановлено</span> : null },
  { label: "Спенд", cell: ({ n }) => usd0(n.sums.spend) },
  { label: "ROMI", cell: ({ n }) => { const b = romiBand(n.m.romi); return <span className={`${chipCls} ${b ? BAND[b] : "text-hint"}`}>{show(n.m.romi, romiText)}</span>; } },
  { label: "ROMI всё время", title: "ROMI за всё время: у крео — в этой стране, у страны и баера — по их крео из отчёта. Наведи — спенд, ревенью, цены", cell: ({ n, allSums, glued, hasLife }) => {
    if (!hasLife || !n.life) return null;
    const m = metricsOf(n.life), b = romiBand(m.romi);
    const line = (s: Sums) => `${show(metricsOf(s).romi, romiText)} · спенд ${usd0(s.spend)} · ревенью ${usd0(s.rev)}`;
    const head = n.level === 0 ? "Всё время крео баера из отчёта" : n.level === 1 ? `${n.label} · всё время крео из отчёта` : `${geoName(n.geo!)} · за всё время${glued ? ", сумма крео строки" : ""}`;
    return (
      <HoverTip label={`ROMI всё время: ${show(m.romi, romiText)}`} tip={<>
        <p className="text-hint">{head}</p>
        <p>{line(n.life)}</p>
        <p className="text-zinc-400">Цена подп. {show(m.cps, usd2)} · цена диал. {show(m.cpd, usd2)} · депов {n.life.deps}</p>
        {allSums && n.level >= 2 && <><p className="pt-1.5 border-t border-line text-hint">Все страны · за всё время</p><p>{line(allSums)}</p></>}
      </>} className={`${chipCls} cursor-help ${b ? BAND[b] : "text-hint"}`}>{show(m.romi, romiText)}</HoverTip>
    );
  } },
  { label: "CPM", cell: ({ n }) => show(n.m.cpm, usd2) },
  { label: "CPC", cell: ({ n }) => show(n.m.cpc, usd2) },
  { label: "CTR", cell: ({ n }) => show(n.m.ctr, pct(2)) },
  { label: "Цена подп.", cell: ({ n }) => show(n.m.cps, usd2) },
  { label: "Клик → подп.", cell: ({ n }) => show(n.m.crSub, pct(1)) },
  { label: "Цена диал.", cell: ({ n }) => show(n.m.cpd, usd2) },
  { label: "Подп. → диал.", cell: ({ n }) => show(n.m.crDia, pct(1)) },
  { label: "Цена депа", cell: ({ n }) => show(n.m.cpdep, usd0) },
  { label: "Диал. → деп", cell: ({ n }) => show(n.m.crDep, pct(1)) },
  { label: "Депы", cell: ({ n }) => n.sums.deps.toLocaleString("ru-RU") },
  { label: "Ревенью", cell: ({ n }) => usd0(n.sums.rev) },
];

const MODES: { id: GroupMode; label: string; hint: string }[] = [
  { id: "creo", label: "Крео", hint: "Каждое объявление отдельно" },
  { id: "text", label: "По тексту", hint: "Все крео одного текста (t11) — одна строка, клик раскрывает крео" },
  { id: "version", label: "Текст + версия", hint: "Все крео одной версии текста (t11_v8) — одна строка, клик раскрывает крео" },
];
const SORTS: { id: SortBy; label: string }[] = [
  { id: "spend", label: "по спенду" }, { id: "romi", label: "по ROMI" }, { id: "deps", label: "по депам" }, { id: "rev", label: "по ревенью" },
];

// Избранное — «баер × крео» (id баера, имя крео): отметка во всех странах сразу.
const favKey = (buyerId: string, creo: string) => `${buyerId}\u0000${creo}`;

export default function TrafficReportPage() {
  const [range, setRange] = useState(PERIODS[0].range);
  const [buyer, setBuyer] = useState("all");
  const [data, setData] = useState<TrafficReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Прежние цифры не стираем: пока едет ответ на новый период или баера, они приглушены (Busy).
  const reqKey = `${range.since}|${range.until}|${buyer}`;
  const [loadedKey, setLoadedKey] = useState("");
  const [closed, setClosed] = useState<Set<string>>(new Set());   // свёрнутые баеры (по умолчанию раскрыты)
  const [open, setOpen] = useState<Set<string>>(new Set());       // раскрытые страны (по умолчанию свёрнуты)
  const [stage, setStage] = useState<Stage | "">("");
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<GroupMode>("creo");
  const [sortBy, setSortBy] = useState<SortBy>("spend");

  useEffect(() => {
    let alive = true;
    const k = `${range.since}|${range.until}|${buyer}`;
    const p = new URLSearchParams({ since: range.since, until: range.until });
    if (buyer !== "all") p.set("buyer", buyer);
    fetch(`/api/traffic-report?${p}`).then((r) => r.json()).then((j) => {
      if (!alive) return;
      if (j.error) setErr(j.error); else { setErr(null); setData(j); }
      setLoadedKey(k);
    }).catch(() => { if (alive) { setErr("Не удалось загрузить"); setLoadedKey(k); } });
    return () => { alive = false; };
  }, [range, buyer]);

  // Личное избранное: звезда у крео, «Только избранные» — отчёт и итоги по ним за любой период.
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [onlyFav, setOnlyFav] = useState(false);
  const [favErr, setFavErr] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/traffic-report/favorites").then((r) => r.json()).then((j) => {
      if (j.favorites) setFavs(new Set((j.favorites as { buyer: string; creo: string }[]).map((f) => favKey(f.buyer, f.creo))));
    }).catch(() => setFavErr("Избранное не загрузилось"));
  }, []);
  // В ячейках баер — подпись; id для избранного — из списка баеров.
  const idOf = useMemo(() => new Map((data?.buyers ?? []).map((b) => [b.label, b.id])), [data]);
  const isFav = (buyer: string, creo: string) => favs.has(favKey(idOf.get(buyer) ?? buyer, creo));
  const toggleFav = (buyer: string, creo: string) => {
    const id = idOf.get(buyer);
    if (!id) return;
    const k = favKey(id, creo), on = !favs.has(k);
    const flip = (s: Set<string>, add: boolean) => { const x = new Set(s); if (add) x.add(k); else x.delete(k); return x; };
    setFavs((s) => flip(s, on));
    setFavErr(null);
    fetch("/api/traffic-report/favorites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ buyer: id, creo, on }) })
      .then((r) => r.json()).then((j) => { if (j.error) throw new Error(j.error); })
      .catch((e) => { setFavs((s) => flip(s, !on)); setFavErr(e instanceof Error ? e.message : "Не сохранилось"); });
  };

  // AI-разборы (Decision 101): значок ✦ у крео — последний вердикт «баер × крео», клик — панель разбора.
  const [ai, setAi] = useState<Map<string, Verdict | null>>(new Map());
  const [aiOpen, setAiOpen] = useState<{ buyerId: string; buyer: string; creo: string } | null>(null);
  useEffect(() => {
    fetch("/api/ai/creo").then((r) => r.json()).then((j) => {
      if (j.analyses) setAi(new Map((j.analyses as { buyer_id: string; creo: string; verdict: Verdict | null }[]).map((a) => [favKey(a.buyer_id, a.creo), a.verdict])));
    }).catch(() => {});
  }, []);

  const [filters, setFilters] = useState<Filters>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const options = useMemo(() => dimOptions(data?.cells ?? []), [data]);
  // Этап крео — по его всему времени в стране, цифры строк — за период.
  const life = useMemo(() => lifeMap(data?.creos ?? []), [data]);
  const base = useMemo(() => {
    const cells = data?.cells ?? [];
    const mine = onlyFav ? cells.filter((c) => favs.has(favKey(idOf.get(c.buyer) ?? c.buyer, c.creo))) : cells;
    return treeOf(filterCells(mine, filters), life);
  }, [data, filters, onlyFav, favs, idOf, life]);
  const cols = useColumns("traffic-report.cols", COLS);
  const tree = useMemo(() => sortCreos(groupCreos(base, mode), sortBy), [base, mode, sortBy]);
  const toggleFilter = (d: Dim, v: string | null) => setFilters((f) => {
    const cur = f[d] ?? [];
    return { ...f, [d]: v === null ? [] : cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] };
  });
  const activeFilters = DIMS.filter((d) => (filters[d]?.length ?? 0) > 0);

  // Видимые строки: дерево с учётом раскрытия. Фильтр — по строке страны (крео или текст):
  // её этап, её имя или имя крео под ней; баер и страна — если под ними есть подходящие.
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtering = Boolean(stage || needle);
    const named = (n: ReportNode) => n.label.toLowerCase().includes(needle) || (n.children ?? []).some((c) => c.label.toLowerCase().includes(needle));
    const hits = (n: ReportNode): boolean => (n.level >= 2 ? (!stage || n.stage === stage) && (!needle || named(n)) : (n.children ?? []).some(hits));
    const isOpen = (n: ReportNode) => (n.level === 0 ? filtering || !closed.has(n.key) : n.level === 1 ? filtering || open.has(n.key) : open.has(n.key));
    const out: { n: ReportNode; open: boolean; buyer: string }[] = [];
    const walk = (list: ReportNode[], buyer: string) => {
      for (const n of list) {
        if (filtering && n.level <= 2 && !hits(n)) continue;
        const b = n.level === 0 ? n.label : buyer;
        out.push({ n, open: isOpen(n), buyer: b });
        if (n.children && isOpen(n)) walk(n.children, b);
      }
    };
    walk(tree, "");
    return out;
  }, [tree, closed, open, stage, q]);

  const toggle = (n: ReportNode) => {
    const flip = (s: Set<string>) => { const x = new Set(s); if (x.has(n.key)) x.delete(n.key); else x.add(n.key); return x; };
    if (n.level === 0) setClosed(flip); else setOpen(flip);
  };
  const expandAll = () => { setClosed(new Set()); setOpen(new Set(tree.flatMap((b) => (b.children ?? []).map((g) => g.key)))); };
  const collapseAll = () => { setOpen(new Set()); setClosed(new Set(tree.map((b) => b.key))); };

  // Крео за всё время и его статус: ключ — подпись баера и имя крео, как в строках дерева.
  const allTime = useMemo(() => new Map((data?.creos ?? []).map((c) => [`${c.buyer}\u0000${c.creo}`, c])), [data]);

  const t = data ? totalOf(base) : null;
  const pick = (r: { since: string; until: string }) => setRange(r);

  return (
    <main className="min-h-screen bg-background text-white p-4 md:p-8">
      <div className="w-full">
        <h1 className="page-title mb-2">Отчёт по трафику</h1>
        <p className="text-sm text-hint mb-6">Баер → страна → крео. Крео оцениваем по ROMI и этапу теста.</p>

        <div data-tour="traffic-periods" className="flex flex-wrap items-center gap-2 mb-3">
          <DateRange since={range.since} until={range.until} onChange={(since, until) => pick({ since, until })} />
          <div className="seg">
            {PERIODS.map((p) => {
              const r = p.range();
              return <button key={p.label} onClick={() => pick(r)} {...seg(range.since === r.since && range.until === r.until)}>{p.label}</button>;
            })}
          </div>
        </div>
        {data && !data.isBuyer && data.buyers.length > 1 && (
          <div className="seg mb-5">
            <button onClick={() => setBuyer("all")} {...seg(buyer === "all")}>Все баеры</button>
            {data.buyers.map((b) => (
              <button key={b.id} onClick={() => setBuyer(b.id)} {...seg(buyer === b.id)}>{b.label}</button>
            ))}
          </div>
        )}

        {/* Фильтры как в General 4.0: в каждом разрезе можно выбрать несколько значений */}
        <div data-tour="traffic-dims" className="card p-4 mb-4">
          <button onClick={() => setFiltersOpen((v) => !v)} className="flex items-center gap-2 text-sm text-zinc-300 w-full text-left">
            <span className="text-hint">{filtersOpen ? "▾" : "▸"}</span>
            Фильтры
            {activeFilters.length > 0 && (
              <span className="text-xs text-violet-300">{activeFilters.map((d) => `${DIM_LABELS[d]}: ${filters[d]!.join(", ")}`).join(" · ")}</span>
            )}
            {activeFilters.length > 0 && (
              <span onClick={(e) => { e.stopPropagation(); setFilters({}); }} className="ml-auto text-xs text-hint hover:text-red-300 cursor-pointer">сбросить</span>
            )}
          </button>
          {filtersOpen && (
            <div className="mt-3 space-y-2">
              {DIMS.filter((d) => options[d].length > 1 || filters[d]?.length).map((d) => (
                <div key={d} className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-hint uppercase tracking-wider mr-1 w-20">{DIM_LABELS[d]}</span>
                  <button onClick={() => toggleFilter(d, null)} {...chip(!filters[d]?.length)}>Все</button>
                  {options[d].map((v) => (
                    <button key={v} onClick={() => toggleFilter(d, v)} {...chip(!!filters[d]?.includes(v))}>{v}</button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <Busy on={Boolean(data) && loadedKey !== reqKey}>
        <div className="stats mb-2">
          <SummaryCard label="Спенд" value={t ? usd0(t.sums.spend) : "…"} />
          <SummaryCard label="Ревенью" value={t ? usd0(t.sums.rev) : "…"} />
          <SummaryCard label="ROMI" value={t ? show(t.m.romi, romiText) : "…"} tone={t && t.m.romi !== null ? (t.m.romi >= 0 ? "good" : "bad") : undefined} />
          <SummaryCard label="Депозиты" value={t ? t.sums.deps.toLocaleString("ru-RU") : "…"} />
          <SummaryCard label="Цена депа" value={t ? show(t.m.cpdep, usd0) : "…"} />
        </div>
        </Busy>
        <div className="text-xs mb-6 space-y-1">
          {err && <p className="text-red-400">{err}</p>}
          {favErr && <p className="text-red-400">{favErr}</p>}
          {data?.notice && <p className="text-amber-300/80">{data.notice}</p>}
        </div>

        <section data-tour="traffic-tree" className="card p-4 md:p-5">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-zinc-400 mb-3">
            <span className="text-hint">ROMI:</span>
            <span className="flex items-center gap-1.5"><i className={`w-3 h-3 rounded-sm ${BAND.red}`} />{ROMI_CUTS.red}%</span>
            <span className="flex items-center gap-1.5"><i className={`w-3 h-3 rounded-sm ${BAND.orange}`} />от {ROMI_CUTS.red + 1}% до {ROMI_CUTS.orange}%</span>
            <span className="flex items-center gap-1.5"><i className={`w-3 h-3 rounded-sm ${BAND.yellow}`} />от {ROMI_CUTS.orange + 1}% до {ROMI_CUTS.yellow}%</span>
            <span className="flex items-center gap-1.5"><i className={`w-3 h-3 rounded-sm ${BAND.green}`} />{ROMI_CUTS.yellow + 1}% и выше</span>
          </div>
          <p className="text-xs text-hint mb-4 max-w-5xl">
            Этап — по всему времени крео в этой стране, цифры строки — за период. Реджекты — сколько раз Meta отклоняла объявления с этим крео
            у баера, за всё время и по всем странам ({HISTORY_FROM}): красный — отклоняли, зелёный — ни разу, у TG Ads прочерк — модерация своя.
            ROMI всё время — у крео в этой стране, у страны и баера — по их крео из отчёта. «На тесте» — депов нет и спенд меньше {TEST_MULT.toLocaleString("ru-RU")} × целевой
            цены депа страны: Испания {usd0(TEST_MULT * TARGET_DEP.ES)}, Латам {usd0(TEST_MULT * TARGET_DEP.LATAM)}, остальные {usd0(TEST_MULT * TARGET_DEP.OTHER)}.
            «Лузер пока что» — депов нет, граница пройдена. «Есть депы» — оцениваем по ROMI. «Без спенда» — Torro пришёл с крео, расхода по которому
            в складе нет совсем (крутилось до склада или имя в ссылке не совпало с объявлением).
          </p>

          <div data-tour="traffic-filters" className="flex flex-wrap items-center gap-2 mb-3">
            <div className="seg" role="group" aria-label="Склейка крео">
              {MODES.map((m) => (
                <button key={m.id} title={m.hint} onClick={() => setMode(m.id)} aria-pressed={mode === m.id}
                        className="seg-btn">{m.label}</button>
              ))}
            </div>
            <select id="traffic-sort" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} className="field" aria-label="Сортировка крео">
              {SORTS.map((s) => <option key={s.id} value={s.id}>Крео {s.label}</option>)}
            </select>
            <button onClick={() => setOnlyFav((v) => !v)} title="Только отмеченные звездой крео — отчёт и итоги по ним"
                    {...chip(onlyFav)}>★ Только избранные{favs.size ? ` · ${favs.size}` : ""}</button>
            <button onClick={expandAll} className="btn btn-sm">Развернуть всё</button>
            <button onClick={collapseAll} className="btn btn-sm">Свернуть всё</button>
            <ColumnPicker labels={cols.ordered.map((c) => c.label)} hidden={cols.hidden} onToggle={cols.toggle} onMove={cols.move} />
            <select id="traffic-stage" value={stage} onChange={(e) => setStage(e.target.value as Stage | "")} className="field" aria-label="Этап крео">
              <option value="">Все этапы</option>
              {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <input id="traffic-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск крео" className={`field min-w-[10rem] flex-1 max-w-xs`} />
          </div>

          <Busy on={Boolean(data) && loadedKey !== reqKey}>
          <div className="overflow-auto max-h-[70vh] rounded-xl border border-line">
            <table className="w-full text-xs tabular-nums border-separate border-spacing-0">
              <thead>
                <tr className="text-hint">
                  <th className="sticky top-0 left-0 z-30 bg-card text-left font-medium px-3 py-2 border-b border-line min-w-[13rem]">Баер / страна / крео</th>
                  {cols.visible.map((c) => (
                    <th key={c.label} title={c.title} className={`sticky top-0 z-20 bg-card ${c.left ? "text-left" : "text-right"} font-medium px-3 py-2 border-b border-line whitespace-nowrap`}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!data && !err && <tr><td colSpan={cols.visible.length + 1} className="px-3 py-6 text-hint">Загружаю…</td></tr>}
                {data && rows.length === 0 && (
                  <tr><td colSpan={cols.visible.length + 1} className="px-3 py-6 text-hint">
                    {!onlyFav ? "За этот период расхода и Torro нет."
                      : favs.size ? "Избранные крео в этом периоде не крутились и Torro по ним нет."
                      : "Избранного пока нет — отметь крео звездой ☆ слева от названия."}
                  </td></tr>
                )}
                {rows.map(({ n, open: isOpen, buyer: rowBuyer }) => {
                  const creoRow = !n.children && n.level >= 2 && n.geo !== REST;
                  const fav = creoRow && isFav(rowBuyer, n.label);
                  const aiKey = creoRow ? favKey(idOf.get(rowBuyer) ?? rowBuyer, n.label) : "";
                  const verdict = ai.get(aiKey);
                  const bg = n.level === 0 ? "bg-raised" : "bg-card";
                  const allOf = (creo: string) => allTime.get(`${rowBuyer}\u0000${creo}`);
                  const all = creoRow ? allOf(n.label) : undefined;
                  const glued = n.level === 2 && Boolean(n.children);   // строка склейки: t11, t11_v8
                  const rejOf = (creo: string) => { const a = allOf(creo); return a ? a.rejects ?? ("tg" as const) : null; };
                  const kids = glued ? n.children!.map((c) => rejOf(c.label)) : [];
                  const real = kids.filter((r): r is Rejects => typeof r === "object" && r !== null);
                  const row: Row = {
                    n, all, glued, hasLife: life.size > 0,
                    allSums: glued ? sumAllTime(n.children!.flatMap((c) => allOf(c.label)?.sums ?? [])) : all?.sums,
                    rej: creoRow ? rejOf(n.label) : glued ? (real.length ? sumRejects(real) : kids.includes("tg") ? "tg" : null) : null,
                  };
                  return (
                    <tr key={n.key} onClick={n.children ? () => toggle(n) : undefined} className={`${n.children ? "cursor-pointer" : ""} hover:brightness-125 ${n.level === 0 ? "text-sm font-semibold" : n.level === 1 ? "font-medium" : n.level === 2 ? (n.children ? "text-zinc-100 font-medium" : "text-zinc-300") : "text-zinc-400"}`}>
                      <td className={`sticky left-0 z-10 ${bg} px-3 py-1.5 border-b border-line/50 max-w-[24rem] break-words`} style={{ paddingLeft: `${0.75 + n.level * 1.1}rem` }}>
                        {n.children && <span className="inline-block w-4 text-hint">{isOpen ? "▾" : "▸"}</span>}
                        {creoRow && (
                          <button onClick={(e) => { e.stopPropagation(); toggleFav(rowBuyer, n.label); }}
                                  title={fav ? "Убрать из избранного" : "В избранное"} aria-label={fav ? "Убрать из избранного" : "В избранное"} aria-pressed={fav}
                                  className={`inline-block w-5 -ml-1 mr-0.5 ${fav ? "text-amber-300" : "text-hint hover:text-amber-200"}`}>{fav ? "★" : "☆"}</button>
                        )}
                        {creoRow && idOf.has(rowBuyer) && (
                          <button onClick={(e) => { e.stopPropagation(); setAiOpen({ buyerId: idOf.get(rowBuyer)!, buyer: rowBuyer, creo: n.label }); }}
                                  title={ai.has(aiKey) ? `AI-разбор${verdict ? `: ${VERDICT[verdict].label.toLowerCase()}` : ""}` : "AI-разбор крео"} aria-label="AI-разбор крео"
                                  className={`inline-block w-5 mr-0.5 ${ai.has(aiKey) ? (verdict ? VERDICT[verdict].tone.split(" ")[1] : "text-violet-300") : "text-hint hover:text-violet-300"}`}>✦</button>
                        )}
                        {creoRow ? <CreoLink name={n.label} /> : n.label}
                        {n.level === 2 && n.children && <span className="text-hint font-normal"> · {n.children.length} крео</span>}
                      </td>
                      {cols.visible.map((c) => (
                        <td key={c.label} className={`${bg} px-3 py-1.5 border-b border-line/50 whitespace-nowrap ${c.left ? "" : "text-right"}`}>{c.cell(row)}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </Busy>
          <p className="text-[11px] text-hint mt-3 max-w-5xl">
            Спенд, показы и клики — склад (Meta, Telegram Ads; у Артёма за 19.09–23.10 — снимки Genesis Manager), клики — все клики Meta.
            Подписки, диалоги, депы и ревенью — Torro по связке «кампания × объявление», ревенью — депы и редепы за период. Страна — из таргета адсета,
            где его нет — из имени кампании. День спенда — по часовому поясу кабинета, день Torro — по Москве. «Не разнесено по крео» — Torro,
            который не лёг на связки (связки за день не обновились), чтобы итог баера совпадал с Torro.
          </p>
        </section>
      </div>
      {aiOpen && (
        <AiPanel buyerId={aiOpen.buyerId} buyerLabel={aiOpen.buyer} creo={aiOpen.creo} onClose={() => setAiOpen(null)}
                 onDone={(v) => setAi((m) => new Map(m).set(favKey(aiOpen.buyerId, aiOpen.creo), v))} />
      )}
    </main>
  );
}
