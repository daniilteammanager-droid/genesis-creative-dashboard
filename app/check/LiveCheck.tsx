"use client";

import { useEffect, useState } from "react";
import type { CheckResult, CheckGroup } from "@/lib/warehouse/check";
import { mskDay, mskDaysAgo } from "@/lib/day";

const chip = (on: boolean) =>
  `px-4 py-2 rounded-xl text-sm font-semibold transition ${
    on ? "bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm"
       : "text-zinc-400 hover:text-violet-300"
  }`;

const field =
  "bg-[#0d0b14] border border-violet-900/40 rounded-xl px-3 py-2 text-sm outline-none " +
  "focus:border-violet-600/50 transition text-white";

const nf = (v: number | null, d = 2) =>
  v === null ? "—" : v.toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d });

const GROUPS: { id: CheckGroup; label: string; head: string }[] = [
  { id: "campaign", label: "По кампаниям", head: "Кампания" },
  { id: "creative", label: "По креативам", head: "Креатив" },
  { id: "country", label: "По странам", head: "Страна" },
];

// Тот же московский день, что и на сервере: иначе в час ночи клиент просил бы
// вчерашний период, а сервер считал его «не сегодня» и лез бы в склад.
const today = () => mskDay();

export default function LiveCheck() {
  const [since, setSince] = useState(today());
  const [until, setUntil] = useState(today());
  const [group, setGroup] = useState<CheckGroup>("campaign");
  const [buyer, setBuyer] = useState("all");
  const [data, setData] = useState<CheckResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isBuyer = data?.isBuyer ?? false;
  // Живая Мета отвечает 4–7 секунд (замер 31.08.2026). Ответ помнит, что у него
  // спрашивали, — если это не то, что выбрано сейчас, значит запрос ещё в пути.
  // Иначе смена разреза выглядела бы как «кнопка не нажалась»: цифры те же.
  const pending = Boolean(data) && (
    data!.since !== since || data!.until !== until || data!.groupBy !== group ||
    (!isBuyer && data!.buyer !== buyer)
  );

  useEffect(() => {
    let alive = true;
    const q = new URLSearchParams({ since, until, group });
    if (buyer !== "all") q.set("buyer", buyer);
    fetch(`/api/check?${q}`)
      .then((r) => r.json() as Promise<CheckResult & { error?: string }>)
      .then((d) => {
        if (!alive) return;
        if (d.error) throw new Error(d.error);
        setData(d); setError(null); setLoading(false);
      })
      .catch((e: Error) => {
        if (!alive) return;
        // Данные обнуляем намеренно. Оставить прежние — значит показать строки
        // одного разреза под заголовком другого, а кнопка «Скопировать» отправит
        // это в чат как свежий чек.
        setData(null); setError(e.message); setLoading(false);
      });
    return () => { alive = false; };
  }, [since, until, group, buyer]);

  async function copy() {
    if (!data?.text) return;
    try {
      await navigator.clipboard.writeText(data.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Буфер обмена недоступен — выдели текст ниже и скопируй вручную");
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <span className="text-xs text-zinc-600 uppercase tracking-wider">Период</span>
        <input type="date" value={since} max={until} onChange={(e) => setSince(e.target.value)} className={field} />
        <span className="text-zinc-600">—</span>
        <input type="date" value={until} min={since} onChange={(e) => setUntil(e.target.value)} className={field} />
        <button onClick={() => { setSince(today()); setUntil(today()); }}
                className={chip(since === today() && until === today())}>Сегодня</button>
        <button onClick={() => { setSince(mskDaysAgo(1)); setUntil(mskDaysAgo(1)); }}
                className={chip(since === mskDaysAgo(1) && until === mskDaysAgo(1))}>Вчера</button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <span className="text-xs text-zinc-600 uppercase tracking-wider w-20">Разрез</span>
        <div className="flex gap-1 bg-[#111118] border border-violet-900/40 rounded-2xl p-1 flex-wrap">
          {GROUPS.map((g) => (
            <button key={g.id} onClick={() => setGroup(g.id)} className={chip(group === g.id)}>{g.label}</button>
          ))}
        </div>
        {pending && !loading && (
          <span className="w-4 h-4 rounded-full border-2 border-violet-600/40 border-t-violet-400 animate-spin" />
        )}
      </div>

      {/* Переключатель баеров показывается и когда выбирать некого: иначе
          непонятно, куда он делся и почему в чеке видно только свои кабинеты. */}
      {!isBuyer && data && (
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <span className="text-xs text-zinc-600 uppercase tracking-wider w-20">Баеры</span>
          {data.buyers.length > 0 ? (
            <div className="flex gap-1 bg-[#111118] border border-violet-900/40 rounded-2xl p-1 flex-wrap">
              <button onClick={() => setBuyer("all")} className={chip(buyer === "all")}>Все</button>
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

      {/* Откуда цифры. Две разные вещи: чьи это ключи и насколько свежие числа. */}
      {data && (
        <p className="text-[11px] text-zinc-600 mb-4">
          {data.sources.length > 0 && <>Считаю по: {data.sources.join(", ")}. </>}
          {data.live
            ? "Чек за сегодня: расход тянется из Meta в момент запроса."
            : "Прошлый период: цифры из склада, он собирается кроном."}
        </p>
      )}

      {data?.warning && (
        <div className="bg-amber-950/30 border border-amber-700/30 rounded-xl px-4 py-3 text-amber-200/90 text-sm mb-4">
          {data.warning}
        </div>
      )}

      {error && <div className="bg-red-950/40 border border-red-700/30 rounded-xl px-4 py-3 text-red-300 text-sm mb-4">{error}</div>}

      {loading && !data && (
        <div className="flex items-center justify-center py-16">
          <div className="w-10 h-10 rounded-full border-2 border-violet-600/40 border-t-violet-400 animate-spin" />
        </div>
      )}

      {data && !loading && (
        <div className={pending ? "opacity-40 transition-opacity" : "transition-opacity"}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {([
              ["Расход", `$${nf(data.totals.spend)}`],
              ["Доход", data.totals.revenue === null ? "—" : `$${nf(data.totals.revenue)}`],
              ["ROMI", data.totals.romi === null ? "—" : `${data.totals.romi.toFixed(0)}%`],
              ["Дейли бюджет", data.totalBudget === null ? "—" : `$${nf(data.totalBudget, 0)}`],
            ] as const).map(([label, value]) => (
              <div key={label} className="bg-[#111118] border border-violet-900/30 rounded-2xl px-5 py-4">
                <p className="text-[11px] text-zinc-600 uppercase tracking-wider mb-1">{label}</p>
                <p className="text-xl font-semibold text-white">{value}</p>
              </div>
            ))}
          </div>

          {/* Готовый текст — то, ради чего раздел и существует */}
          <div className="bg-[#111118] border border-violet-900/30 rounded-2xl p-5 mb-5">
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <h2 className="text-lg font-semibold text-white">Готовый чек</h2>
              <button onClick={copy}
                      className="px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm hover:from-violet-500 hover:to-violet-400 transition">
                {copied ? "Скопировано" : "Скопировать"}
              </button>
            </div>
            <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">
              {data.text}
            </pre>
          </div>

          {data.rows.length > 0 && (
            <div className="bg-[#111118] border border-violet-900/30 rounded-2xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-violet-900/25">
                    {[GROUPS.find((g) => g.id === group)!.head, "Дейли", "Спенд",
                      "Цена ПДП", "Цена диалога", "Доход", "ROMI"].map((h) => (
                      <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-violet-900/15">
                  {data.rows.map((r) => (
                    <tr key={r.key} className="hover:bg-violet-900/10 transition">
                      <td className="px-3 py-2.5 text-zinc-200 max-w-[320px] truncate" title={r.label}>{r.label}</td>
                      <td className="px-3 py-2.5 text-zinc-400 whitespace-nowrap">{r.dailyBudget === null ? "—" : `$${nf(r.dailyBudget, 0)}`}</td>
                      <td className="px-3 py-2.5 text-zinc-200 whitespace-nowrap">${nf(r.spend)}</td>
                      <td className="px-3 py-2.5 text-zinc-400 whitespace-nowrap">{r.costPdp === null ? "—" : `$${nf(r.costPdp)}`}</td>
                      <td className="px-3 py-2.5 text-zinc-400 whitespace-nowrap">{r.costDia === null ? "—" : `$${nf(r.costDia)}`}</td>
                      <td className="px-3 py-2.5 text-zinc-200 whitespace-nowrap">{r.revenue === null ? "—" : `$${nf(r.revenue)}`}</td>
                      <td className={`px-3 py-2.5 whitespace-nowrap ${(r.romi ?? 0) > 0 ? "text-green-400" : "text-zinc-400"}`}>
                        {r.romi === null ? "—" : `${r.romi.toFixed(0)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {group === "country" && (
            <p className="text-[11px] text-zinc-600 mt-3">
              Страна берётся из настроек таргета адсета, а не из названия. Адсеты, таргетящие
              несколько стран, сведены в одну строку: доход между странами разделить нечем.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
