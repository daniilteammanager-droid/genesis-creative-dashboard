"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReportTreeResult, TreeNode } from "@/lib/warehouse/reportTree";
import type { LiveState } from "@/lib/reports-live/manage";
import { mskDaysAgo } from "@/lib/day";
import { COLS, SORTS, money, n, romi, sortBy, totalsOf } from "./columns";

const chip = (on: boolean) =>
  `px-4 py-2 rounded-xl text-sm font-semibold transition ${
    on ? "bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm"
       : "text-zinc-400 hover:text-violet-300"
  }`;

const field =
  "bg-[#0d0b14] border border-violet-900/40 rounded-xl px-3 py-2 text-sm outline-none " +
  "focus:border-violet-600/50 transition text-white";
const small = "px-3 py-1.5 rounded-lg text-sm border transition disabled:opacity-50";

const daysAgo = (days: number) => mskDaysAgo(days);

// Пресеты периодов. Раздел открывается на сегодня: раньше по умолчанию было
// 14 дней, и каждый раз приходилось переключаться руками.
const PERIODS = [
  { label: "Сегодня", since: () => daysAgo(0), until: () => daysAgo(0) },
  { label: "Вчера", since: () => daysAgo(1), until: () => daysAgo(1) },
  { label: "7 дней", since: () => daysAgo(6), until: () => daysAgo(0) },
  { label: "14 дней", since: () => daysAgo(13), until: () => daysAgo(0) },
  { label: "30 дней", since: () => daysAgo(29), until: () => daysAgo(0) },
];
// Автообновление Live Manager: склад и статусы заново. Свежий расход из Meta —
// кнопкой «Обновить сейчас» (склад сам обновляется раз в 15 минут).
const EVERY = [{ ms: 0, label: "Live: выкл" }, { ms: 60_000, label: "Live: 1 мин" }, { ms: 120_000, label: "Live: 2 мин" }, { ms: 300_000, label: "Live: 5 мин" }];
const HIDDEN_KEY = "reports.hiddenCols";
// Своё оформление Live Manager — в этом браузере, как у Артёма в рабочем пространстве:
// закреплённые и скрытые кабинеты, свои названия, закреплённые строки, наборы столбцов.
const PREFS_KEY = "reports.prefs";
interface Prefs { pinnedCabs: string[]; hiddenCabs: string[]; alias: Record<string, string>; pinnedRows: string[]; presets: Record<string, string[]> }
const NO_PREFS: Prefs = { pinnedCabs: [], hiddenCabs: [], alias: {}, pinnedRows: [], presets: {} };
const LEVELS = [{ id: "tree", label: "Дерево" }, { id: "campaign", label: "Кампании" }, { id: "adset", label: "Адсеты" }, { id: "ad", label: "Объявления" }] as const;
type LevelId = (typeof LEVELS)[number]["id"];
const NO_REACH = new Map<string, number>();
const BAN = new Set(["DISABLED", "UNSETTLED", "CLOSED", "PENDING_CLOSURE", "PENDING_SETTLEMENT"]);

// Отступ задаётся классом, а не вычисленным стилем: Tailwind не собирает
// классы, собранные из строк на лету.
const INDENT = ["", "pl-8", "pl-16"] as const;

const isOn = (s?: LiveState) => s?.status === "ACTIVE";
const pill = (s?: LiveState) => {
  if (!s) return <span className="text-zinc-600">—</span>;
  const eff = s.effective || s.status;
  const cls = eff === "ACTIVE" ? "border-green-700/40 text-green-300" : /DISAPPROVED|WITH_ISSUES/.test(eff) ? "border-red-800/40 text-red-300" : "border-zinc-700 text-zinc-400";
  return <span className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${cls}`} title={eff}>{eff.replace(/_/g, " ")}</span>;
};

interface RowProps {
  node: TreeNode; depth: number; open: Set<string>; toggle: (id: string) => void;
  live: Map<string, LiveState>; selected: Set<string>; select: (id: string) => void;
  flip: (node: TreeNode) => void; cols: typeof COLS;
  // Охват за период живьём (Decision 089), закреплённые строки.
  reach: Map<string, number>; pinned: Set<string>; pin: (id: string) => void;
}

function Row({ node: raw, depth, open, toggle, live, selected, select, flip, cols, reach, pinned, pin }: RowProps) {
  const node = reach.has(raw.id) ? { ...raw, reach: reach.get(raw.id)! } : raw;
  const expandable = Boolean(node.children?.length);
  const isOpen = open.has(node.id);
  const [full, setFull] = useState(false);
  const s = live.get(node.id);

  return (
    <>
      <tr className={`hover:bg-violet-900/10 transition border-b border-violet-900/15 ${node.outside ? "opacity-70" : ""} ${selected.has(node.id) ? "bg-violet-900/15" : ""}`}>
        {/* На телефоне закреплённое имя — не шире половины экрана, иначе цифрам
            не остаётся места и таблица не листается вбок. */}
        {/* Имя — полностью: на ПК переносится строкой, на телефоне свёрнуто в одну строку и
            раскрывается тапом по имени (стрелка слева раскрывает адсеты и объявления). */}
        <td className={`px-3 py-2.5 sticky left-0 bg-[#111118] z-10 max-w-[48vw] sm:max-w-[640px] ${INDENT[depth]}`}>
          <div className="flex items-center gap-2 max-w-full min-w-0">
            <input type="checkbox" checked={selected.has(node.id)} disabled={!s?.canEdit} onChange={() => select(node.id)}
                   className="shrink-0 accent-violet-500 disabled:opacity-20" aria-label="Выбрать" />
            <div className="text-left flex items-center gap-2 max-w-full min-w-0">
              <button type="button" onClick={() => expandable && toggle(node.id)} aria-label={isOpen ? "Свернуть" : "Раскрыть"}
                      className={`text-zinc-600 text-xs w-4 shrink-0 ${expandable ? "cursor-pointer hover:text-zinc-300" : "opacity-0 cursor-default"}`}>{isOpen ? "▾" : "▸"}</button>
              <button type="button" title={node.name}
                      onClick={() => (window.matchMedia("(max-width: 639px)").matches ? setFull((v) => !v) : expandable && toggle(node.id))}
                      className={`text-left min-w-0 sm:whitespace-normal sm:break-words ${full ? "whitespace-normal break-all" : "truncate"} ${depth === 0 ? "text-zinc-100" : "text-zinc-300"} ${expandable ? "cursor-pointer" : "cursor-default sm:cursor-text"}`}>
                {node.name}
              </button>
              {node.outside && depth === 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-700/40 text-amber-300/90 whitespace-nowrap shrink-0">нет в кабинетах</span>
              )}
            </div>
            {depth === 0 && !node.outside && (
              <button type="button" onClick={() => pin(node.id)} title={pinned.has(node.id) ? "Открепить" : "Закрепить наверху"}
                      className={`shrink-0 text-xs ${pinned.has(node.id) ? "text-amber-300" : "text-zinc-700 hover:text-zinc-400"}`}>★</button>
            )}
          </div>
        </td>
        <td className="px-3 py-2.5 whitespace-nowrap">
          <div className="flex items-center gap-2">
            {s?.canEdit && (
              <button onClick={() => flip(node)} title={isOn(s) ? "Поставить на паузу" : "Запустить"}
                      className={`w-8 h-4 rounded-full relative transition ${isOn(s) ? "bg-green-600/80" : "bg-zinc-700"}`}>
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${isOn(s) ? "left-4" : "left-0.5"}`} />
              </button>
            )}
            {s ? pill(s) : node.lastStatus ? (
              // Живого статуса нет (кабинет пропал или не читается) — последний известный из склада.
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-500 whitespace-nowrap" title="Последний известный статус из склада">
                {node.lastStatus.replace(/_/g, " ")} · история
              </span>
            ) : <span className="text-zinc-600">—</span>}
          </div>
        </td>
        <td className="px-3 py-2.5 whitespace-nowrap text-zinc-400">{s?.dailyBudget ? money(s.dailyBudget) : "—"}</td>
        {cols.map((c) => (
          <td key={c.label} className={`px-3 py-2.5 whitespace-nowrap ${c.strong ? "text-zinc-200" : "text-zinc-400"} ${
            c.label === "ROMI" && (node.depSum ?? 0) > node.spend ? "text-green-400" : ""}`}>{c.cell(node)}</td>
        ))}
      </tr>
      {isOpen && node.children?.map((c) => (
        <Row key={c.id} node={c} depth={depth + 1} open={open} toggle={toggle} live={live} selected={selected} select={select} flip={flip} cols={cols}
             reach={reach} pinned={pinned} pin={pin} />
      ))}
    </>
  );
}

const walk = (nodes: TreeNode[], f: (n: TreeNode) => void) => nodes.forEach((x) => { f(x); if (x.children) walk(x.children, f); });

export default function ReportTree() {
  const [since, setSince] = useState(daysAgo(0));
  const [until, setUntil] = useState(daysAgo(0));
  const [buyer, setBuyer] = useState("all");
  const [data, setData] = useState<ReportTreeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  // Live Manager (Decision 079)
  const [live, setLive] = useState<Map<string, LiveState>>(new Map());
  const [liveNote, setLiveNote] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [geo, setGeo] = useState("all");
  const [face, setFace] = useState("all");
  const [every, setEvery] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [refresh, setRefresh] = useState(false);
  const [showCols, setShowCols] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as string[]); } catch { return new Set(); }
  });
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState<"all" | "active" | "paused">("all");
  const [sort, setSort] = useState("spend");
  const [level, setLevel] = useState<LevelId>("tree");
  const [cab, setCab] = useState("");
  const [showHiddenCabs, setShowHiddenCabs] = useState(false);
  const [prefs, setPrefsState] = useState<Prefs>(() => {
    try { return { ...NO_PREFS, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>) }; } catch { return NO_PREFS; }
  });
  const setPrefs = (f: (p: Prefs) => Prefs) => setPrefsState((p) => {
    const next = f(p);
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* приватное окно */ }
    return next;
  });
  const toggleIn = (k: "pinnedCabs" | "hiddenCabs" | "pinnedRows", id: string) =>
    setPrefs((p) => ({ ...p, [k]: p[k].includes(id) ? p[k].filter((x) => x !== id) : [...p[k], id] }));
  const [reach, setReach] = useState<Map<string, number>>(new Map());
  const isBuyer = data?.isBuyer ?? false;

  useEffect(() => {
    let alive = true;
    const q = new URLSearchParams({ since, until });
    if (buyer !== "all") q.set("buyer", buyer);
    if (refresh) q.set("refresh", "1");
    fetch(`/api/report-tree?${q}`)
      .then((r) => r.json() as Promise<ReportTreeResult & { error?: string }>)
      .then((d) => {
        if (!alive) return;
        if (d.error) throw new Error(d.error);
        setData(d); setError(null); setLoading(false); setRefresh(false); setBusy(null);
      })
      .catch((e: Error) => { if (alive) { setError(e.message); setLoading(false); setRefresh(false); setBusy(null); } });
    return () => { alive = false; };
  }, [since, until, buyer, tick, refresh]);

  // Статусы и бюджеты — следом за деревом, из Meta / Dolphin вживую.
  const items = useMemo(() => {
    const out: { level: TreeNode["level"]; id: string; accountId: string }[] = [];
    if (data) walk(data.nodes, (x) => { if (!x.outside && x.accountId && /^\d+$/.test(x.id)) out.push({ level: x.level, id: x.id, accountId: x.accountId }); });
    return out;
  }, [data]);
  const loadLive = useCallback(() => {
    if (!items.length) return;
    fetch("/api/report-live", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) })
      .then((r) => r.json() as Promise<{ states?: LiveState[]; errors?: string[]; error?: string }>)
      .then((d) => {
        setLive(new Map((d.states ?? []).map((s) => [s.id, s])));
        setLiveNote(d.error ?? (d.errors?.length ? `Без статуса и управления: ${d.errors.join("; ")}` : null));
      })
      .catch(() => setLiveNote("Статусы не прочитались — сеть не ответила"));
  }, [items]);
  useEffect(() => { loadLive(); }, [loadLive]);

  // Охват и частота за период — живьём из Meta: дневные охваты склада не складываются.
  useEffect(() => {
    if (!data || data.reachExact || !items.length) return;
    let alive = true;
    fetch("/api/report-live", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items, reach: { since: data.since, until: data.until } }) })
      .then((r) => r.json() as Promise<{ reach?: Record<string, { reach: number }> }>)
      .then((d) => { if (alive) setReach(new Map(Object.entries(d.reach ?? {}).map(([id, v]) => [id, v.reach]))); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [data, items]);

  useEffect(() => {
    if (!every) return;
    const t = setInterval(() => setTick((k) => k + 1), every);
    return () => clearInterval(t);
  }, [every]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const select = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const nodeById = useMemo(() => {
    const m = new Map<string, TreeNode>();
    if (data) walk(data.nodes, (x) => m.set(x.id, x));
    return m;
  }, [data]);

  async function act(ids: string[], action: { kind: "status"; active: boolean } | { kind: "budget"; usd: number }) {
    const list = ids.map((id) => nodeById.get(id)).filter((x): x is TreeNode => Boolean(x?.accountId))
      .map((x) => ({ level: x.level, id: x.id, accountId: x.accountId! }));
    if (!list.length) return;
    setBusy("Применяю в кабинетах…");
    try {
      const r = await fetch("/api/report-live", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: list, action }) });
      const d = (await r.json()) as { results?: { id: string; ok: boolean; error?: string }[]; error?: string };
      const failed = (d.results ?? []).filter((x) => !x.ok);
      setLiveNote(d.error ?? (failed.length
        ? `Не получилось у ${failed.length} из ${list.length}: ${[...new Set(failed.map((f) => f.error))].join("; ")}`
        : `Готово: ${list.length} ${action.kind === "status" ? (action.active ? "запущено" : "на паузе") : `— бюджет $${action.usd}`}`));
      setSelected(new Set());
      loadLive();
    } finally {
      setBusy(null);
    }
  }
  const flip = (x: TreeNode) => {
    const on = isOn(live.get(x.id));
    if (window.confirm(`${on ? "Поставить на паузу" : "Запустить"} «${x.name}» в реальном кабинете?`)) act([x.id], { kind: "status", active: !on });
  };
  const bulk = (active: boolean) => {
    if (window.confirm(`${active ? "Запустить" : "Поставить на паузу"} ${selected.size} выбранных в реальных кабинетах?`)) act([...selected], { kind: "status", active });
  };
  const budget = () => {
    const v = Number((window.prompt("Дневной бюджет, USD (для кабинетов не в долларах пересчитается по курсу):") ?? "").replace(",", "."));
    if (!(v > 0)) return;
    const withBudget = [...selected].filter((id) => live.get(id)?.dailyBudget);
    if (!withBudget.length) return void setLiveNote("У выбранных нет своего дневного бюджета — выбери кампании (CBO) или адсеты, где бюджет задан");
    if (window.confirm(`Поставить $${v} в день для ${withBudget.length} объектов?`)) act(withBudget, { kind: "budget", usd: v });
  };

  const faces = useMemo(() => [...new Set((data?.nodes ?? []).map((x) => x.face).filter((f): f is string => Boolean(f)))].sort(), [data]);
  const geos = useMemo(() => [...new Set((data?.nodes ?? []).flatMap((x) => x.countries ?? []))].sort(), [data]);
  // Строки уровня: дерево — кампании с детьми, остальное — плоским списком, лицо и
  // страны — от родителя, чтобы фильтры работали и на объявлениях.
  const statusOf = useCallback((x: TreeNode) => live.get(x.id)?.effective || live.get(x.id)?.status || x.lastStatus || null, [live]);
  const cabName = useCallback((id?: string) => (id ? prefs.alias[id] || data?.cabinets.find((c) => c.accountId === id)?.name || id : ""), [prefs.alias, data]);
  const shown = useMemo(() => {
    const top = data?.nodes ?? [];
    const flat = (lvl: LevelId): TreeNode[] => {
      if (lvl === "tree") return top;
      if (lvl === "campaign") return top.map((c) => ({ ...c, children: undefined }));
      const sets = top.flatMap((c) => (c.children ?? []).map((a) => ({ ...a, face: c.face, accountId: a.accountId ?? c.accountId })));
      if (lvl === "adset") return sets.map((a) => ({ ...a, children: undefined }));
      return sets.flatMap((a) => (a.children ?? []).map((x) => ({ ...x, face: a.face, countries: a.countries, accountId: x.accountId ?? a.accountId })));
    };
    const needle = q.trim().toLowerCase();
    const list = flat(level).filter((x) => {
      if (face !== "all" && (face === "none" ? x.face : x.face !== face)) return false;
      if (geo !== "all" && !(x.countries ?? []).includes(geo)) return false;
      if (cab && x.accountId !== cab) return false;
      if (!showHiddenCabs && x.accountId && prefs.hiddenCabs.includes(x.accountId)) return false;
      if (needle && !`${x.name} ${x.id} ${cabName(x.accountId)}`.toLowerCase().includes(needle)) return false;
      const st = statusOf(x);
      if (statusF === "active" && st !== "ACTIVE") return false;
      if (statusF === "paused" && (!st || st === "ACTIVE")) return false;
      return true;
    });
    const sorted = sortBy(list, sort);
    const pins = new Set(prefs.pinnedRows);
    return [...sorted.filter((x) => pins.has(x.id)), ...sorted.filter((x) => !pins.has(x.id) && !x.outside), ...sorted.filter((x) => !pins.has(x.id) && x.outside)];
  }, [data, face, geo, cab, showHiddenCabs, prefs, q, statusF, sort, level, statusOf, cabName]);
  const totals = useMemo(() => totalsOf(shown.filter((x) => !x.outside)), [shown]);
  // Лента кабинетов: закреплённые сверху, дальше по расходу; пропавший — с пометкой.
  const cabinets = useMemo(() => {
    const spend = new Map<string, number>();
    for (const x of data?.nodes ?? []) if (x.accountId) spend.set(x.accountId, (spend.get(x.accountId) ?? 0) + x.spend);
    return [...(data?.cabinets ?? [])]
      .filter((c) => showHiddenCabs || !prefs.hiddenCabs.includes(c.accountId))
      .map((c) => ({ ...c, spend: spend.get(c.accountId) ?? 0, pinned: prefs.pinnedCabs.includes(c.accountId), hidden: prefs.hiddenCabs.includes(c.accountId) }))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.spend - a.spend);
  }, [data, prefs, showHiddenCabs]);
  const cols = COLS.filter((c) => !hidden.has(c.label));
  const applyPreset = (name: string) => {
    const list = prefs.presets[name];
    if (!list) return;
    const next = new Set(list);
    setHidden(next);
    try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next])); } catch { /* приватное окно */ }
  };
  const savePreset = () => {
    const name = window.prompt("Название набора столбцов:")?.trim();
    if (name) setPrefs((p) => ({ ...p, presets: { ...p.presets, [name]: [...hidden] } }));
  };
  const setCol = (label: string) => setHidden((prev) => {
    const next = new Set(prev);
    if (next.has(label)) next.delete(label); else next.add(label);
    try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next])); } catch { /* приватное окно — без запоминания */ }
    return next;
  });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <span className="text-xs text-zinc-600 uppercase tracking-wider">Период</span>
        <input type="date" value={since} max={until} onChange={(e) => setSince(e.target.value)} className={field} />
        <span className="text-zinc-600">—</span>
        <input type="date" value={until} min={since} onChange={(e) => setUntil(e.target.value)} className={field} />
        <div data-tour="reports-periods" className="flex gap-1 bg-[#111118] border border-violet-900/40 rounded-2xl p-1">
          {/* Сегодня и вчера — то, что открывают чаще всего; остальное берут
              календарём. Поэтому вчера — отдельная кнопка, а не «2 дня»:
              «вчера» это один день, а не диапазон по сегодня. */}
          {PERIODS.map((p) => (
            <button key={p.label} onClick={() => { setSince(p.since()); setUntil(p.until()); }}
                    className={chip(since === p.since() && until === p.until())}>{p.label}</button>
          ))}
        </div>
      </div>

      {/* Показываем и когда выбирать некого: пропавший переключатель читается
          как поломка, а не как «баеры ещё не подключились». */}
      {!isBuyer && data && (
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          <span className="text-xs text-zinc-600 uppercase tracking-wider w-16">Баеры</span>
          {data.buyers.length > 0 ? (
            <div className="flex gap-1 bg-[#111118] border border-violet-900/40 rounded-2xl p-1 flex-wrap">
              <button onClick={() => setBuyer("all")} className={chip(buyer === "all")}>Сводная</button>
              {data.buyers.map((b) => (
                <button key={b.id} onClick={() => setBuyer(b.id)} className={chip(buyer === b.id)}>{b.label}</button>
              ))}
            </div>
          ) : (
            <span className="text-sm text-zinc-500">
              Никто из баеров ещё не подключил ключи — выбирать пока некого
            </span>
          )}
        </div>
      )}

      {/* Live Manager: фильтры, обновление, столбцы. */}
      {data && data.nodes.length > 0 && (
        <div data-tour="reports-live" className="flex items-center gap-2 mb-4 flex-wrap">
          <div className="flex gap-1 bg-[#111118] border border-violet-900/40 rounded-2xl p-1">
            {LEVELS.map((l) => <button key={l.id} onClick={() => setLevel(l.id)} className={chip(level === l.id)}>{l.label}</button>)}
          </div>
          <input placeholder="Кампания, ID, кабинет…" value={q} onChange={(e) => setQ(e.target.value)} className={`${field} w-56`} />
          <select value={statusF} onChange={(e) => setStatusF(e.target.value as typeof statusF)} className={field}>
            <option value="all">Все статусы</option><option value="active">Активные</option><option value="paused">Стопнутые</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} className={field}>
            {SORTS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
          <select value={geo} onChange={(e) => setGeo(e.target.value)} className={field}>
            <option value="all">Все GEO</option>
            {geos.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={face} onChange={(e) => setFace(e.target.value)} className={field}>
            <option value="all">Все лица</option>
            {faces.map((f) => <option key={f} value={f}>{f}</option>)}
            <option value="none">Без лица</option>
          </select>
          <select value={every} onChange={(e) => setEvery(Number(e.target.value))} className={field}>
            {EVERY.map((e) => <option key={e.ms} value={e.ms}>{e.label}</option>)}
          </select>
          <button type="button" disabled={Boolean(busy)} onClick={() => { setBusy("Тяну свежий расход…"); setRefresh(true); }}
                  className={`${small} border-violet-700/50 text-violet-200 hover:bg-violet-900/20`}>↻ Обновить сейчас</button>
          <div className="relative">
            <button type="button" onClick={() => setShowCols((v) => !v)} className={`${small} border-violet-900/40 text-zinc-300 hover:bg-violet-900/20`}>☷ Столбцы</button>
            {showCols && (
              <div className="absolute z-30 mt-1 w-56 max-h-80 overflow-y-auto bg-[#111118] border border-violet-900/40 rounded-xl p-2 shadow-xl">
                <div className="flex items-center gap-1 px-1 pb-2 mb-1 border-b border-violet-900/30">
                  <select value="" onChange={(e) => applyPreset(e.target.value)} className="flex-1 bg-[#0d0b14] border border-violet-900/40 rounded-lg px-2 py-1 text-xs text-white">
                    <option value="">Наборы…</option>
                    {Object.keys(prefs.presets).map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                  <button type="button" onClick={savePreset} className="text-xs text-violet-300 px-1" title="Сохранить текущий набор">＋</button>
                </div>
                {COLS.map((c) => (
                  <label key={c.label} className="flex items-center gap-2 px-2 py-1 text-sm text-zinc-300 hover:bg-violet-900/15 rounded cursor-pointer">
                    <input type="checkbox" checked={!hidden.has(c.label)} onChange={() => setCol(c.label)} className="accent-violet-500" />{c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          {busy && <span className="text-xs text-zinc-500">{busy}</span>}
        </div>
      )}

      {data && data.cabinets.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2 mb-3">
          <button type="button" onClick={() => setCab("")} className={`shrink-0 px-3 py-2 rounded-xl border text-sm ${cab === "" ? "border-violet-500 bg-violet-900/25 text-white" : "border-violet-900/40 text-zinc-400"}`}>
            Все кабинеты <span className="text-zinc-500">{data.cabinets.length}</span>
          </button>
          {cabinets.map((c) => {
            const gone = c.status === "MISSING", ban = c.status ? BAN.has(c.status) : false;
            return (
              <div key={c.accountId} className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-sm ${cab === c.accountId ? "border-violet-500 bg-violet-900/25" : "border-violet-900/40"} ${c.hidden ? "opacity-50" : ""}`}>
                <button type="button" onClick={() => toggleIn("pinnedCabs", c.accountId)} title={c.pinned ? "Открепить" : "Закрепить"} className={c.pinned ? "text-amber-300" : "text-zinc-600 hover:text-zinc-400"}>★</button>
                <button type="button" onClick={() => setCab(cab === c.accountId ? "" : c.accountId)} className="text-left" title={`${c.accountId}${gone && c.lastStatus ? ` · до пропажи: ${c.lastStatus}` : ""}`}>
                  <span className="text-zinc-100">{prefs.alias[c.accountId] || c.name}</span>
                  {gone && <span className="ml-1.5 text-[10px] px-1 rounded border border-red-800/50 text-red-300">ПРОПАЛ</span>}
                  {ban && <span className="ml-1.5 text-[10px] px-1 rounded border border-red-800/50 text-red-300">{c.status === "UNSETTLED" ? "UNSETTLED" : "БАН"}</span>}
                  <span className="block text-[10px] text-zinc-500">{money(c.spend)}</span>
                </button>
                <button type="button" title="Своё название" className="text-zinc-600 hover:text-zinc-300 text-xs"
                        onClick={() => { const v = window.prompt("Название кабинета у тебя (пусто — как в Meta):", prefs.alias[c.accountId] ?? ""); if (v !== null) setPrefs((p) => ({ ...p, alias: { ...p.alias, [c.accountId]: v.trim() } })); }}>✎</button>
                <button type="button" title={c.hidden ? "Показать" : "Скрыть"} onClick={() => toggleIn("hiddenCabs", c.accountId)} className="text-zinc-600 hover:text-zinc-300 text-xs">{c.hidden ? "◉" : "×"}</button>
              </div>
            );
          })}
          {prefs.hiddenCabs.length > 0 && (
            <button type="button" onClick={() => setShowHiddenCabs((v) => !v)} className="shrink-0 px-3 py-2 rounded-xl border border-violet-900/40 text-xs text-zinc-400">
              {showHiddenCabs ? "Спрятать скрытые" : `Скрытые: ${prefs.hiddenCabs.length}`}
            </button>
          )}
        </div>
      )}

      {selected.size > 0 && (
        <div className="sticky top-0 z-20 flex items-center gap-2 flex-wrap mb-3 bg-[#1a1426] border border-violet-700/40 rounded-xl px-3 py-2">
          <span className="text-sm text-zinc-200 mr-1">Выбрано: {selected.size}</span>
          <button type="button" disabled={Boolean(busy)} onClick={() => bulk(true)} className={`${small} border-green-700/50 text-green-300 hover:bg-green-900/20`}>▶ Запустить</button>
          <button type="button" disabled={Boolean(busy)} onClick={() => bulk(false)} className={`${small} border-zinc-600 text-zinc-300 hover:bg-zinc-800`}>⏸ Пауза</button>
          <button type="button" disabled={Boolean(busy)} onClick={budget} className={`${small} border-violet-700/50 text-violet-200 hover:bg-violet-900/20`}>$ Бюджет</button>
          <button type="button" onClick={() => setSelected(new Set())} className={`${small} border-transparent text-zinc-500 hover:text-zinc-300 ml-auto`}>Снять</button>
        </div>
      )}

      {liveNote && <div className="bg-violet-950/30 border border-violet-800/30 rounded-xl px-4 py-2.5 text-violet-100/90 text-sm mb-4">{liveNote}</div>}

      {data?.notice && (
        <div className="bg-amber-950/30 border border-amber-700/30 rounded-xl px-4 py-3 text-amber-200/90 text-sm mb-4">
          {data.notice}
        </div>
      )}

      {error && <div className="bg-red-950/40 border border-red-700/30 rounded-xl px-4 py-3 text-red-300 text-sm mb-4">{error}</div>}

      {loading && !data && (
        <div className="flex items-center justify-center py-20">
          <div className="w-10 h-10 rounded-full border-2 border-violet-600/40 border-t-violet-400 animate-spin" />
        </div>
      )}

      {!loading && !error && (data?.nodes.length ?? 0) === 0 && (
        <div className="bg-[#111118] border border-violet-900/30 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-2">За этот период пусто</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            В складе нет расхода за эти дни. Если источник подключён недавно — история ещё
            догружается: сразу после подключения приходит последняя неделя, дальше по неделе
            каждые 15 минут. Источник не подключён — Настройки → Интеграции.
          </p>
        </div>
      )}

      {!loading && !error && (data?.nodes.length ?? 0) > 0 && (
        <>
          {/* Итоги того, что на экране (с фильтрами), — как карточки у Артёма. */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-5">
            {([
              ["Расход", money(totals.spend)],
              ["Клики FB", n(totals.clicks)],
              ["Показы", n(totals.impressions)],
              ["Клики на сайте", n(totals.lpClicks)],
              ["ПДП", n(totals.subscribers)],
              ["ДИА", n(totals.dialogs)],
              ["Депозиты", n(totals.depCount)],
              ["Сумма депов", money(totals.depSum)],
              ["Цена ПДП", money(totals.cpaPdp)],
              ["Цена ДИА", money(totals.cpaDia)],
              ["ROMI", romi(totals.spend, totals.depSum)],
              data!.outside
                ? ["Вне подключённых кабинетов", `${money(data!.outside.depSum)} · ${n(data!.outside.campaigns)} РК`]
                : ["Строк", n(shown.length)],
            ] as const).map(([label, value]) => (
              <div key={label} className="bg-[#111118] border border-violet-900/30 rounded-2xl px-5 py-4">
                <p className="text-[11px] text-zinc-600 uppercase tracking-wider mb-1">{label}</p>
                <p className="text-xl font-semibold text-white">{value}</p>
              </div>
            ))}
          </div>

          <div className="bg-[#111118] border border-violet-900/30 rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-violet-900/25">
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider sticky left-0 bg-[#111118] z-10 max-w-[48vw] sm:max-w-none">
                    Кампания / адсет / объявление
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider whitespace-nowrap">Статус</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider whitespace-nowrap">Бюджет в день</th>
                  {cols.map((c) => (
                    <th key={c.label} className="px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider whitespace-nowrap">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((node) => (
                  <Row key={node.id} node={node} depth={0} open={open} toggle={toggle} live={live} selected={selected} select={select} flip={flip} cols={cols}
                       reach={data!.reachExact ? NO_REACH : reach} pinned={new Set(prefs.pinnedRows)} pin={(id) => toggleIn("pinnedRows", id)} />
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-zinc-600 mt-3 leading-relaxed">
            Подписки, диалоги, депы и квалы — из Torro. На кампании — срез Torro по её имени, на
            объявлении — связка «кампания × объявление»; одно имя в двух адсетах кампании делить
            нечем, тогда цифры только на кампании. Внизу — кампании, которые есть в Torro, но их
            кабинет не подключён: в итог и ROMI они не идут.
            <br />
            Статус и бюджет — из кабинета вживую; переключатель и галочки — только у своих кабинетов с ключом Meta
            (право ads_management) или Dolphin. Через FB Tool управлять нельзя.
          </p>
        </>
      )}
    </div>
  );
}
