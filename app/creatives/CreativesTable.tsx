"use client";

import { useEffect, useState } from "react";
import type { CreativesResult, CreativeRow } from "@/lib/warehouse/creatives";

const chip = (on: boolean) =>
  `px-4 py-2 rounded-xl text-sm font-semibold transition ${
    on ? "bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm"
       : "text-zinc-400 hover:text-violet-300"
  }`;

const field =
  "bg-[#0d0b14] border border-violet-900/40 rounded-xl px-3 py-2 text-sm outline-none " +
  "focus:border-violet-600/50 transition text-white";

// Прочерк вместо нуля, когда колонки не было в выгрузке: «не выгружали» и
// «выгрузили ноль» — разные утверждения (Decision 039).
const n = (v: number | null, digits = 0) =>
  v === null ? "—" : v.toLocaleString("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits });

const money = (v: number | null) => (v === null ? "—" : `$${n(v, 2)}`);

// ROMI считается из сумм, а не усреднением по строкам (Decision 024).
function romi(spend: number, revenue: number): string {
  if (spend <= 0) return revenue > 0 ? "∞" : "—";
  return `${(((revenue - spend) / spend) * 100).toFixed(0)}%`;
}

function daysAgo(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function CreativesTable({ isBuyer }: { isBuyer: boolean }) {
  const [since, setSince] = useState(daysAgo(13));
  const [until, setUntil] = useState(daysAgo(0));
  const [buyer, setBuyer] = useState<string>("all");
  const [data, setData] = useState<CreativesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Состояние меняется только в колбэках ответа, а не в теле эффекта: иначе
    // каждый набор даты запускал бы лишний каскад перерисовок.
    //
    // alive закрывает гонку: при быстром переключении дат ответ на старый запрос
    // мог прийти после нового и подменить свежие цифры прошлыми.
    let alive = true;
    const q = new URLSearchParams({ since, until });
    if (!isBuyer && buyer !== "all") q.set("buyer", buyer);

    fetch(`/api/creatives?${q}`)
      .then((r) => r.json() as Promise<CreativesResult & { error?: string }>)
      .then((d) => {
        if (!alive) return;
        if (d.error) throw new Error(d.error);
        setData(d);
        setError(null);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setError(e.message);
        setLoading(false);
      });

    return () => { alive = false; };
  }, [since, until, buyer, isBuyer]);

  // Пока едет новый ответ, на экране прежние цифры. Помечаем их, чтобы не
  // принять данные за прошлый период за текущие.
  const stale = Boolean(data) && (data!.since !== since || data!.until !== until);

  const rows: CreativeRow[] = data?.rows ?? [];
  const revenue = (r: CreativeRow) => (r.depSum ?? 0) + (r.redepSum ?? 0);

  return (
    <div>
      {/* ─── Период и баер ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <span className="text-xs text-zinc-600 uppercase tracking-wider">Период</span>
        <input type="date" value={since} max={until} onChange={(e) => setSince(e.target.value)} className={field} />
        <span className="text-zinc-600">—</span>
        <input type="date" value={until} min={since} onChange={(e) => setUntil(e.target.value)} className={field} />

        <div className="flex gap-1 bg-[#111118] border border-violet-900/40 rounded-2xl p-1">
          {([[0, "Сегодня"], [6, "7 дней"], [13, "14 дней"], [29, "30 дней"]] as const).map(([d, label]) => (
            <button key={d} onClick={() => { setSince(daysAgo(d)); setUntil(daysAgo(0)); }} className={chip(since === daysAgo(d) && until === daysAgo(0))}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {!isBuyer && (data?.buyers.length ?? 0) > 0 && (
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <span className="text-xs text-zinc-600 uppercase tracking-wider w-16">Баеры</span>
          <div className="flex gap-1 bg-[#111118] border border-violet-900/40 rounded-2xl p-1 flex-wrap">
            <button onClick={() => setBuyer("all")} className={chip(buyer === "all")}>Сводная</button>
            {data!.buyers.map((b) => (
              <button key={b.id} onClick={() => setBuyer(b.id)} className={chip(buyer === b.id)}>{b.label}</button>
            ))}
          </div>
        </div>
      )}

      {/* ─── Период CRM задет краем ────────────────────────────────────── */}
      {(data?.partialPeriods.length ?? 0) > 0 && (
        <div className="bg-amber-950/30 border border-amber-700/30 rounded-2xl px-5 py-4 mb-4">
          <p className="text-sm text-amber-200/90 leading-relaxed">
            Депозиты показаны не за весь диапазон. Выгрузка Torro лежит периодами, и{" "}
            {data!.partialPeriods.map((p) => `${p.since} — ${p.until}`).join(", ")} попал в него не целиком.
          </p>
          <p className="text-[13px] text-amber-200/60 leading-relaxed mt-1">
            Разложить период по дням нельзя, поэтому он не учтён вовсе — расход при этом точен.
            Выбери диапазон по границам периодов, и цифры сойдутся.
          </p>
        </div>
      )}

      {error && (
        <div className="bg-red-950/40 border border-red-700/30 rounded-xl px-4 py-3 text-red-300 text-sm mb-4">{error}</div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-20">
          <div className="w-10 h-10 rounded-full border-2 border-violet-600/40 border-t-violet-400 animate-spin" />
        </div>
      )}

      {stale && (
        <p className="text-[11px] text-zinc-600 mb-3">
          Показаны цифры за {data!.since} — {data!.until}, новые ещё едут.
        </p>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="bg-[#111118] border border-violet-900/30 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-2">За этот период пусто</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Склад собирается по подключениям баеров. Пока никто не подключил ключ Meta и выгрузки
            Torro, брать данные неоткуда.
          </p>
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {([
              ["Расход", money(data!.totals.spend)],
              ["Доход", money(data!.totals.depSum)],
              ["ROMI", romi(data!.totals.spend, data!.totals.depSum)],
              ["Креативов", n(rows.length)],
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
                  {["Код креатива", "Гео", "Подход", "Расход", "Клики", "Показы",
                    "Подписки", "Диалоги", "Депозиты", "Доход", "ROMI"].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-violet-900/15">
                {rows.map((r) => (
                  <tr key={r.code} className="hover:bg-violet-900/10 transition">
                    <td className="px-3 py-2.5 text-zinc-200 whitespace-nowrap max-w-[280px] truncate" title={r.code}>
                      {r.code}
                      {/* Старый формат помечен, но не спрятан: сейчас все деньги
                          именно на нём (Decision 043). */}
                      {r.scheme === "legacy" && (
                        <span className="ml-2 text-[10px] text-zinc-600 border border-zinc-700/50 rounded px-1 py-0.5">старый</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-zinc-400">{r.geo}</td>
                    <td className="px-3 py-2.5 text-zinc-400">{r.approach}</td>
                    <td className="px-3 py-2.5 text-zinc-200 whitespace-nowrap">{money(r.spend)}</td>
                    <td className="px-3 py-2.5 text-zinc-400">{n(r.clicks)}</td>
                    <td className="px-3 py-2.5 text-zinc-400">{n(r.impressions)}</td>
                    <td className="px-3 py-2.5 text-zinc-400">{n(r.subscribers)}</td>
                    <td className="px-3 py-2.5 text-zinc-400">{n(r.dialogs)}</td>
                    <td className="px-3 py-2.5 text-zinc-400">{n(r.depCount === null && r.redepCount === null ? null : (r.depCount ?? 0) + (r.redepCount ?? 0))}</td>
                    <td className="px-3 py-2.5 text-zinc-200 whitespace-nowrap">
                      {r.depSum === null && r.redepSum === null ? "—" : money(revenue(r))}
                    </td>
                    <td className={`px-3 py-2.5 whitespace-nowrap ${revenue(r) > r.spend ? "text-green-400" : "text-zinc-400"}`}>
                      {romi(r.spend, revenue(r))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-zinc-600 mt-3">
            Строка с доходом и нулевым расходом — не ошибка: депозит записывается в день, когда он
            сделан, а крео могли выключить раньше.
          </p>
        </>
      )}
    </div>
  );
}
