"use client";

import { useEffect, useState } from "react";
import type { ReportTreeResult, TreeNode } from "@/lib/warehouse/reportTree";

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

function daysAgo(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

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
      <tr className="hover:bg-violet-900/10 transition border-b border-violet-900/15">
        <td className={`px-3 py-2.5 ${INDENT[depth]}`}>
          <button
            onClick={() => expandable && toggle(node.id)}
            className={`text-left flex items-center gap-2 max-w-[420px] ${expandable ? "cursor-pointer" : "cursor-default"}`}
          >
            <span className={`text-zinc-600 text-xs w-3 ${expandable ? "" : "opacity-0"}`}>{isOpen ? "▾" : "▸"}</span>
            <span className={`truncate ${depth === 0 ? "text-zinc-100" : "text-zinc-300"}`} title={node.name}>
              {node.name}
            </span>
          </button>
        </td>
        <td className="px-3 py-2.5 text-zinc-200 whitespace-nowrap">{money(node.spend)}</td>
        <td className="px-3 py-2.5 text-zinc-400">{n(node.clicks)}</td>
        <td className="px-3 py-2.5 text-zinc-400">{n(node.impressions)}</td>
        <td className="px-3 py-2.5 text-zinc-400">{n(node.subscribers)}</td>
        <td className="px-3 py-2.5 text-zinc-400">{n(node.dialogs)}</td>
        <td className="px-3 py-2.5 text-zinc-400">{n(node.depCount)}</td>
        <td className="px-3 py-2.5 text-zinc-200 whitespace-nowrap">{money(node.depSum)}</td>
        <td className={`px-3 py-2.5 whitespace-nowrap ${(node.depSum ?? 0) > node.spend ? "text-green-400" : "text-zinc-400"}`}>
          {romi(node.spend, node.depSum)}
        </td>
      </tr>
      {isOpen && node.children?.map((c) => (
        <Row key={c.id} node={c} depth={depth + 1} open={open} toggle={toggle} />
      ))}
    </>
  );
}

export default function ReportTree() {
  const [since, setSince] = useState(daysAgo(13));
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
          {([[0, "Сегодня"], [6, "7 дней"], [13, "14 дней"], [29, "30 дней"]] as const).map(([d, label]) => (
            <button key={d} onClick={() => { setSince(daysAgo(d)); setUntil(daysAgo(0)); }}
                    className={chip(since === daysAgo(d) && until === daysAgo(0))}>{label}</button>
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
            Дерево собирается из склада, а склад — по подключениям баеров. Пока никто не подключил
            ключ Meta и выгрузки Torro, брать данные неоткуда.
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
              ["Кампаний", n(data!.nodes.length)],
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
                  {["Кампания / адсет / объявление", "Расход", "Клики", "Показы",
                    "Подписки", "Диалоги", "Депозиты", "Доход", "ROMI"].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
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

          <p className="text-[11px] text-zinc-600 mt-3">
            Депозиты на адсете и на объявлении берутся из выгрузки Торро по id объявления.
            Если её не подключить, на этих уровнях будет прочерк, а на кампании — цифры.
          </p>
        </>
      )}
    </div>
  );
}
