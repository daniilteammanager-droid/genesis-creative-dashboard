"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReportTreeResult, TreeNode } from "@/lib/warehouse/reportTree";
import type { LiveState } from "@/lib/reports-live/manage";
import { mskDaysAgo } from "@/lib/day";
import { COLS, money, n, romi } from "./columns";

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
}

function Row({ node, depth, open, toggle, live, selected, select, flip, cols }: RowProps) {
  const expandable = Boolean(node.children?.length);
  const isOpen = open.has(node.id);
  const s = live.get(node.id);

  return (
    <>
      <tr className={`hover:bg-violet-900/10 transition border-b border-violet-900/15 ${node.outside ? "opacity-70" : ""} ${selected.has(node.id) ? "bg-violet-900/15" : ""}`}>
        {/* На телефоне закреплённое имя — не шире половины экрана, иначе цифрам
            не остаётся места и таблица не листается вбок. */}
        <td className={`px-3 py-2.5 sticky left-0 bg-[#111118] z-10 max-w-[48vw] sm:max-w-[440px] ${INDENT[depth]}`}>
          <div className="flex items-center gap-2 max-w-full min-w-0">
            <input type="checkbox" checked={selected.has(node.id)} disabled={!s?.canEdit} onChange={() => select(node.id)}
                   className="shrink-0 accent-violet-500 disabled:opacity-20" aria-label="Выбрать" />
            <button
              onClick={() => expandable && toggle(node.id)}
              className={`text-left flex items-center gap-2 max-w-full min-w-0 ${expandable ? "cursor-pointer" : "cursor-default"}`}
            >
              <span className={`text-zinc-600 text-xs w-3 ${expandable ? "" : "opacity-0"}`}>{isOpen ? "▾" : "▸"}</span>
              <span className={`truncate min-w-0 ${depth === 0 ? "text-zinc-100" : "text-zinc-300"}`} title={node.name}>
                {node.name}
              </span>
              {node.outside && depth === 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-700/40 text-amber-300/90 whitespace-nowrap shrink-0">нет в кабинетах</span>
              )}
            </button>
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
            {pill(s)}
          </div>
        </td>
        <td className="px-3 py-2.5 whitespace-nowrap text-zinc-400">{s?.dailyBudget ? money(s.dailyBudget) : "—"}</td>
        {cols.map((c) => (
          <td key={c.label} className={`px-3 py-2.5 whitespace-nowrap ${c.strong ? "text-zinc-200" : "text-zinc-400"} ${
            c.label === "ROMI" && (node.depSum ?? 0) > node.spend ? "text-green-400" : ""}`}>{c.cell(node)}</td>
        ))}
      </tr>
      {isOpen && node.children?.map((c) => (
        <Row key={c.id} node={c} depth={depth + 1} open={open} toggle={toggle} live={live} selected={selected} select={select} flip={flip} cols={cols} />
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
  const shown = useMemo(() => (data?.nodes ?? []).filter((x) =>
    (face === "all" || (face === "none" ? !x.face : x.face === face)) && (geo === "all" || (x.countries ?? []).includes(geo))), [data, face, geo]);
  const cols = COLS.filter((c) => !hidden.has(c.label));
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {([
              ["Расход", money(data!.totals.spend)],
              ["Доход", money(data!.totals.depSum)],
              ["ROMI", romi(data!.totals.spend, data!.totals.depSum)],
              data!.outside
                ? ["Вне подключённых кабинетов", `${money(data!.outside.depSum)} · ${n(data!.outside.campaigns)} РК`]
                : ["Кампаний", n(data!.nodes.length)],
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
                  <Row key={node.id} node={node} depth={0} open={open} toggle={toggle} live={live} selected={selected} select={select} flip={flip} cols={cols} />
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
