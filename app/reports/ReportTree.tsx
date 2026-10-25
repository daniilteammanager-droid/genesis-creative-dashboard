"use client";

import { useEffect, useState } from "react";
import type { ReportTreeResult, TreeNode } from "@/lib/warehouse/reportTree";
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
