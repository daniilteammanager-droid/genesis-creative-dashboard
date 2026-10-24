"use client";

import { useEffect, useState } from "react";
import type { ReportTreeResult, TreeNode } from "@/lib/warehouse/reportTree";
import { mskDaysAgo } from "@/lib/day";

const chip = (on: boolean) =>
  `px-4 py-2 rounded-xl text-sm font-semibold transition ${
    on ? "bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm"
       : "text-zinc-400 hover:text-violet-300"
  }`;

const field =
  "bg-[#0d0b14] border border-violet-900/40 rounded-xl px-3 py-2 text-sm outline-none " +
  "focus:border-violet-600/50 transition text-white";

const n = (v: number | null, d = 0) =>
  v === null ? "—" : v.toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d });
const money = (v: number | null) => (v === null ? "—" : `$${n(v, 2)}`);

function romi(spend: number, revenue: number | null): string {
  if (revenue === null) return "—";
  if (spend <= 0) return revenue > 0 ? "∞" : "—";
  return `${(((revenue - spend) / spend) * 100).toFixed(0)}%`;
}

const daysAgo = (days: number) => mskDaysAgo(days);

// Столбцы — как в General 4.0, кроме CPA/IB: тут просто число депов и доход.
// Производные — из сумм узла, а не средним детей (Decision 024).
const ratio = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : a / b);
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
const quals = (x: TreeNode) => (x.quals ? x.quals.reduce((s, v) => s + v, 0) : null);
const QUAL = ["A", "B", "C", "D", "E"];
type Col = { label: string; cell: (x: TreeNode) => string; strong?: boolean };
const COLS: Col[] = [
  { label: "Расход", cell: (x) => money(x.spend), strong: true },
  { label: "Доход", cell: (x) => money(x.depSum), strong: true },
  { label: "Net Profit", cell: (x) => (x.depSum === null ? "—" : money(x.depSum - x.spend)) },
  { label: "ROMI", cell: (x) => romi(x.spend, x.depSum) },
  { label: "ROAS", cell: (x) => { const v = ratio(x.depSum, x.spend); return v === null ? "—" : v.toFixed(2); } },
  { label: "Показы", cell: (x) => n(x.impressions) },
  { label: "Клики", cell: (x) => n(x.clicks) },
  { label: "CPM", cell: (x) => money(x.impressions ? (x.spend / x.impressions) * 1000 : null) },
  { label: "CPC", cell: (x) => money(ratio(x.spend, x.clicks)) },
  { label: "CTR", cell: (x) => pct(ratio(x.clicks, x.impressions)) },
  { label: "Клики на ленде", cell: (x) => n(x.lpClicks) },
  { label: "CR% клик → ленд", cell: (x) => pct(ratio(x.lpClicks, x.clicks)) },
  { label: "CR% ленд → канал", cell: (x) => pct(ratio(x.subscribers, x.lpClicks)) },
  { label: "Подписки", cell: (x) => n(x.subscribers) },
  { label: "Общая CR", cell: (x) => pct(ratio(x.subscribers, x.clicks)) },
  { label: "Цена подписки", cell: (x) => money(ratio(x.spend, x.subscribers)), strong: true },
  { label: "Диалоги", cell: (x) => n(x.dialogs) },
  { label: "CR% в диалог", cell: (x) => pct(ratio(x.dialogs, x.subscribers)) },
  { label: "Цена диалога", cell: (x) => money(ratio(x.spend, x.dialogs)), strong: true },
  { label: "Депы", cell: (x) => n(x.depCount) },
  { label: "CR% диалог → деп", cell: (x) => pct(ratio(x.depCount, x.dialogs)) },
  { label: "CAC", cell: (x) => money(ratio(x.spend, x.depCount)) },
  { label: "Квалы", cell: (x) => n(quals(x)) },
  { label: "Неквалы", cell: (x) => { const q = quals(x); return q === null || x.dialogs === null ? "—" : n(x.dialogs - q); } },
  ...QUAL.map((k, i): Col => ({ label: `Квал ${k}`, cell: (x) => n(x.quals ? x.quals[i] : null) })),
  ...QUAL.map((k, i): Col => ({ label: `% ${k}`, cell: (x) => pct(x.quals ? ratio(x.quals[i], quals(x)) : null) })),
];

// Пресеты периодов. Раздел открывается на сегодня: раньше по умолчанию было
// 14 дней, и каждый раз приходилось переключаться руками.
const PERIODS = [
  { label: "Сегодня", since: () => daysAgo(0), until: () => daysAgo(0) },
  { label: "Вчера", since: () => daysAgo(1), until: () => daysAgo(1) },
  { label: "7 дней", since: () => daysAgo(6), until: () => daysAgo(0) },
  { label: "14 дней", since: () => daysAgo(13), until: () => daysAgo(0) },
  { label: "30 дней", since: () => daysAgo(29), until: () => daysAgo(0) },
];

// Отступ задаётся классом, а не вычисленным стилем: Tailwind не собирает
// классы, собранные из строк на лету.
const INDENT = ["", "pl-8", "pl-16"] as const;

function Row({ node, depth, open, toggle }: {
  node: TreeNode; depth: number;
  open: Set<string>; toggle: (id: string) => void;
}) {
  const expandable = Boolean(node.children?.length);
  const isOpen = open.has(node.id);

  return (
    <>
      <tr className={`hover:bg-violet-900/10 transition border-b border-violet-900/15 ${node.outside ? "opacity-70" : ""}`}>
        {/* На телефоне закреплённое имя — не шире половины экрана, иначе цифрам
            не остаётся места и таблица не листается вбок. */}
        <td className={`px-3 py-2.5 sticky left-0 bg-[#111118] z-10 max-w-[48vw] sm:max-w-[440px] ${INDENT[depth]}`}>
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
        </td>
        {COLS.map((c) => (
          <td key={c.label} className={`px-3 py-2.5 whitespace-nowrap ${c.strong ? "text-zinc-200" : "text-zinc-400"} ${
            c.label === "ROMI" && (node.depSum ?? 0) > node.spend ? "text-green-400" : ""}`}>{c.cell(node)}</td>
        ))}
      </tr>
      {isOpen && node.children?.map((c) => (
        <Row key={c.id} node={c} depth={depth + 1} open={open} toggle={toggle} />
      ))}
    </>
  );
}

export default function ReportTree() {
  const [since, setSince] = useState(daysAgo(0));
  const [until, setUntil] = useState(daysAgo(0));
  const [buyer, setBuyer] = useState("all");
  const [data, setData] = useState<ReportTreeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const isBuyer = data?.isBuyer ?? false;

  useEffect(() => {
    let alive = true;
    const q = new URLSearchParams({ since, until });
    if (buyer !== "all") q.set("buyer", buyer);
    fetch(`/api/report-tree?${q}`)
      .then((r) => r.json() as Promise<ReportTreeResult & { error?: string }>)
      .then((d) => {
        if (!alive) return;
        if (d.error) throw new Error(d.error);
        setData(d); setError(null); setLoading(false);
      })
      .catch((e: Error) => { if (alive) { setError(e.message); setLoading(false); } });
    return () => { alive = false; };
  }, [since, until, buyer]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <span className="text-xs text-zinc-600 uppercase tracking-wider">Период</span>
        <input type="date" value={since} max={until} onChange={(e) => setSince(e.target.value)} className={field} />
        <span className="text-zinc-600">—</span>
        <input type="date" value={until} min={since} onChange={(e) => setUntil(e.target.value)} className={field} />
        <div className="flex gap-1 bg-[#111118] border border-violet-900/40 rounded-2xl p-1">
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
                  {COLS.map((c) => (
                    <th key={c.label} className="px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider whitespace-nowrap">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data!.nodes.map((node) => (
                  <Row key={node.id} node={node} depth={0} open={open} toggle={toggle} />
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-zinc-600 mt-3 leading-relaxed">
            Подписки, диалоги, депы и квалы — из Torro. На кампании — срез Torro по её имени, на
            объявлении — связка «кампания × объявление»; одно имя в двух адсетах кампании делить
            нечем, тогда цифры только на кампании. Внизу — кампании, которые есть в Torro, но их
            кабинет не подключён: в итог и ROMI они не идут.
          </p>
        </>
      )}
    </div>
  );
}
