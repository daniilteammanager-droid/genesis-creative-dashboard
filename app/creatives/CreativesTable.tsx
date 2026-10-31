"use client";

import { Fragment, useEffect, useState } from "react";
import type { CreativesResult, CreativeRow } from "@/lib/warehouse/creatives";
import { mskDaysAgo } from "@/lib/day";
import { COLS, money, n, romi, totalsOf, type Metrics } from "@/app/live-manager/columns";
import { baseKey, mergeVersions, toCsv, type Merged } from "@/lib/creatives/merge";
import { DateRange } from "@/components/DatePicker";
import { Busy, seg, Spinner } from "@/components/ui";

// Сортировка кликом по заголовку — по числу, а не по тексту ячейки.
const ratio = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : a / b);
const SORT_KEY: Record<string, (m: Metrics) => number | null> = {
  "Расход": (m) => m.spend, "Доход": (m) => m.depSum, "Net Profit": (m) => (m.depSum === null ? null : m.depSum - m.spend),
  "ROMI": (m) => (m.depSum === null || !m.spend ? null : (m.depSum - m.spend) / m.spend), "ROAS": (m) => ratio(m.depSum, m.spend),
  "Показы": (m) => m.impressions, "Клики": (m) => m.clicks, "Подписки": (m) => m.subscribers,
  "Цена подписки": (m) => ratio(m.subscribers ? m.spend : null, m.subscribers), "Диалоги": (m) => m.dialogs,
  "Цена диалога": (m) => ratio(m.dialogs ? m.spend : null, m.dialogs), "Депы": (m) => m.depCount, "CAC": (m) => ratio(m.depCount ? m.spend : null, m.depCount),
};
const geoOfCode = (code: string) => (/-([a-z]{2})$/i.exec(code)?.[1] ?? "").toUpperCase();



// Строка креатива в виде строки отчёта: те же столбцы, что в дереве кампаний.
// Доход и депы — вместе с повторными, как в дереве.
const both = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));
const metrics = (r: CreativeRow): Metrics => ({
  spend: r.spend, clicks: r.clicks, impressions: r.impressions, lpClicks: r.crmClicks,
  subscribers: r.subscribers, dialogs: r.dialogs, depCount: both(r.depCount, r.redepCount),
  depSum: both(r.depSum, r.redepSum), quals: r.quals,
});

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


export default function CreativesTable() {
  const [since, setSince] = useState(daysAgo(0));
  const [until, setUntil] = useState(daysAgo(0));
  const [buyer, setBuyer] = useState<string>("all");
  const [country, setCountry] = useState<string>("all");
  const [face, setFace] = useState<string>("all");
  // Склейка: нет / версии (v1, v2…) / как у Артёма — версии и все GEO одного креатива вместе,
  // строка раскрывается на «GEO · лицо».
  const [merge, setMerge] = useState<"none" | "versions" | "all">("none");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ col: string; desc: boolean }>({ col: "Расход", desc: true });
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const [data, setData] = useState<CreativesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // На какой фильтр пришёл показанный ответ: не совпал с выбранным — новый ещё едет.
  const reqKey = `${since}|${until}|${buyer}|${country}`;
  const [loadedKey, setLoadedKey] = useState("");
  const isBuyer = data?.isBuyer ?? false;

  useEffect(() => {
    // Состояние меняется только в колбэках ответа, а не в теле эффекта: иначе
    // каждый набор даты запускал бы лишний каскад перерисовок.
    //
    // alive закрывает гонку: при быстром переключении дат ответ на старый запрос
    // мог прийти после нового и подменить свежие цифры прошлыми.
    let alive = true;
    const k = `${since}|${until}|${buyer}|${country}`;
    const q = new URLSearchParams({ since, until });
    if (buyer !== "all") q.set("buyer", buyer);
    if (country !== "all") q.set("country", country);

    fetch(`/api/creatives?${q}`)
      .then((r) => r.json() as Promise<CreativesResult & { error?: string }>)
      .then((d) => {
        if (!alive) return;
        if (d.error) throw new Error(d.error);
        setData(d);
        setError(null);
        setLoading(false);
        setLoadedKey(k);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setError(e.message);
        setLoading(false);
        setLoadedKey(k);
      });

    return () => { alive = false; };
  }, [since, until, buyer, country]);

  // Пока едет новый ответ, на экране прежние цифры — приглушены (Busy), чтобы не
  // принять данные за прошлый период или другого баера за текущие.
  const busy = Boolean(data) && loadedKey !== reqKey;

  // Лицо и склейка версий — поверх ответа, без нового запроса (как у Артёма в «Дашборде»).
  const all: CreativeRow[] = data?.rows ?? [];
  const faces = [...new Set(all.flatMap((r) => r.faces))].sort();
  const byFace = face === "all" ? all : all.filter((r) => (face === "none" ? r.faces.length === 0 : r.faces.includes(face)));
  const needle = q.trim().toLowerCase();
  const found = needle ? byFace.filter((r) => r.code.toLowerCase().includes(needle)) : byFace;
  const merged: (CreativeRow & Partial<Merged>)[] = merge === "none" ? found : mergeVersions(found, merge === "all" ? baseKey : undefined);
  const key = SORT_KEY[sort.col] ?? SORT_KEY["Расход"];
  const rows = [...merged].sort((a, b) => {
    const ka = key(metrics(a)), kb = key(metrics(b));
    if (ka === null && kb === null) return 0;
    if (ka === null) return 1;
    if (kb === null) return -1;
    return sort.desc ? kb - ka : ka - kb;
  });
  const t = totalsOf(rows.map(metrics));
  const sortOn = (col: string) => SORT_KEY[col] && setSort((p) => ({ col, desc: p.col === col ? !p.desc : true }));
  const toggleRow = (code: string) => setOpenRows((p) => { const n2 = new Set(p); if (n2.has(code)) n2.delete(code); else n2.add(code); return n2; });

  function downloadCsv() {
    const head = ["Код креатива", "Страны", "Лица", "Подход", ...COLS.map((c) => c.label)];
    const body = rows.map((r) => [r.code, r.countries.join(" "), r.faces.join(" "), r.approach, ...COLS.map((c) => c.cell(metrics(r)))]);
    const url = URL.createObjectURL(new Blob([toCsv([head, ...body])], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `creatives_${since}_${until}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      {/* ─── Период и баер ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <span className="text-xs text-hint uppercase tracking-wider">Период</span>
        <DateRange since={since} until={until} onChange={(a, b) => { setSince(a); setUntil(b); }} />

        <div className="seg">
          {/* Сегодня и вчера — то, что открывают чаще всего; остальное берут
              календарём. Поэтому вчера — отдельная кнопка, а не «2 дня»:
              «вчера» это один день, а не диапазон по сегодня. */}
          {PERIODS.map((p) => (
            <button key={p.label} onClick={() => { setSince(p.since()); setUntil(p.until()); }}
                    {...seg(since === p.since() && until === p.until())}>{p.label}</button>
          ))}
        </div>
      </div>

      {/* Показываем и когда выбирать некого: пропавший переключатель читается
          как поломка, а не как «баеры ещё не подключились». */}
      {!isBuyer && data && (
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <span className="text-xs text-hint uppercase tracking-wider w-16">Баеры</span>
          {data.buyers.length > 0 ? (
            <div className="seg">
              <button onClick={() => setBuyer("all")} {...seg(buyer === "all")}>Сводная</button>
              {data.buyers.map((b) => (
                <button key={b.id} onClick={() => setBuyer(b.id)} {...seg(buyer === b.id)}>{b.label}</button>
              ))}
            </div>
          ) : (
            <span className="text-sm text-hint">
              Никто из баеров ещё не подключил ключи — выбирать пока некого
            </span>
          )}
        </div>
      )}

      {/* ─── Период CRM задет краем ────────────────────────────────────── */}
      {(data?.countries.length ?? 0) > 0 && (
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <span className="text-xs text-hint uppercase tracking-wider w-16">Страны</span>
          <div className="seg">
            <button onClick={() => setCountry("all")} {...seg(country === "all")}>Все</button>
            {data!.countries.map((c) => (
              <button key={c} onClick={() => setCountry(c)} {...seg(country === c)}>{c}</button>
            ))}
          </div>
        </div>
      )}

      {data && all.length > 0 && (
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <span className="text-xs text-hint uppercase tracking-wider w-16">Лицо</span>
          <div className="seg">
            <button onClick={() => setFace("all")} {...seg(face === "all")}>Все</button>
            {faces.map((f) => <button key={f} onClick={() => setFace(f)} {...seg(face === f)}>{f}</button>)}
            <button onClick={() => setFace("none")} {...seg(face === "none")}>Без лица</button>
          </div>
          <div className="seg">
            <button onClick={() => setMerge("none")} {...seg(merge === "none")}>Как есть</button>
            <button onClick={() => setMerge("versions")} {...seg(merge === "versions")}>Склеить версии</button>
            <button onClick={() => setMerge("all")} {...seg(merge === "all")} title="Все версии и GEO одного креатива — одна строка, клик раскрывает GEO · лицо">Версии и GEO вместе</button>
          </div>
          <input placeholder="Код креатива, например storytell-t30" value={q} onChange={(e) => setQ(e.target.value)} className={`field w-64`} />
          <button onClick={downloadCsv} className="px-3 py-1.5 rounded-lg text-sm border border-line text-zinc-300 hover:bg-violet-900/20 ml-auto">↓ CSV</button>
        </div>
      )}

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

      {data?.notice && (

        <div className="bg-amber-950/30 border border-amber-700/30 rounded-xl px-4 py-3 text-amber-200/90 text-sm mb-4">

          {data.notice}

        </div>

      )}


      {error && (
        <div className="bg-red-950/40 border border-red-700/30 rounded-xl px-4 py-3 text-red-300 text-sm mb-4">{error}</div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-20">
          <Spinner />
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-white mb-2">За этот период пусто</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            В складе нет расхода за эти дни. Если источник подключён недавно — история ещё
            догружается: сразу после подключения приходит последняя неделя, дальше по неделе
            каждые 15 минут. Источник не подключён — Настройки → Интеграции.
          </p>
        </div>
      )}

      <Busy on={busy}>
      {!loading && !error && rows.length > 0 && (
        <>
          {/* Карточки — как в «Дашборде» Артёма: число и цена под ним. */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
            {([
              ["Расход", money(t.spend), `Креативов: ${n(rows.length)}`],
              ["ПДП", n(t.subscribers), `Цена ПДП ${money(t.cpaPdp)}`],
              ["ДИА", n(t.dialogs), `Цена ДИА ${money(t.cpaDia)}`],
              ["Депозиты", n(t.depCount), `Цена депа ${money(t.depCount ? t.spend / t.depCount : null)}`],
              ["Сумма депозитов", money(t.depSum), `Профит ${money(t.depSum - t.spend)}`],
              ["ROMI", romi(t.spend, t.depSum), `ROAS ${t.spend ? (t.depSum / t.spend).toFixed(2) : "—"}×`],
            ] as const).map(([label, value, hint]) => (
              <div key={label} className="card px-5 py-4">
                <p className="text-[11px] text-hint uppercase tracking-wider mb-1">{label}</p>
                <p className="text-xl font-semibold text-white">{value}</p>
                <p className="text-[11px] text-hint mt-0.5">{hint}</p>
              </div>
            ))}
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-hint uppercase tracking-wider whitespace-nowrap sticky left-0 bg-card z-10">Код креатива</th>
                  {["Страны", "Подход", ...COLS.map((c) => c.label)].map((h) => (
                    <th key={h} onClick={() => sortOn(h)} className={`px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap ${SORT_KEY[h] ? "cursor-pointer hover:text-violet-300" : ""} ${sort.col === h ? "text-violet-300" : "text-hint"}`}>
                      {h}{sort.col === h ? (sort.desc ? " ↓" : " ↑") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50">
                {rows.map((r) => (
                  <Fragment key={r.code}>
                  <tr className={`hover:bg-violet-900/10 transition ${r.details && merge === "all" ? "cursor-pointer" : ""}`} onClick={() => merge === "all" && r.details && toggleRow(r.code)}>
                    <td className="px-3 py-2.5 text-zinc-200 whitespace-nowrap max-w-[48vw] sm:max-w-[280px] truncate sticky left-0 bg-card z-10" title={r.code}>
                      {merge === "all" && <span className="text-hint text-xs mr-1.5">{openRows.has(r.code) ? "▾" : "▸"}</span>}
                      {r.code}
                      {/* Старый формат помечен, но не спрятан: сейчас все деньги
                          именно на нём (Decision 043). */}
                      {r.scheme === "legacy" && (
                        <span className="ml-2 text-[10px] text-hint border border-zinc-700/50 rounded px-1 py-0.5">старый</span>
                      )}
                      {(r.versions ?? 1) > 1 && (
                        <span className="ml-2 text-[10px] text-violet-300 border border-violet-700/40 rounded px-1 py-0.5">{merge === "all" ? "вариантов" : "версий"}: {r.versions}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-zinc-400 whitespace-nowrap">
                      {r.countries.length ? r.countries.slice(0, 3).join(", ") : "—"}
                      {r.countries.length > 3 && <span className="text-hint"> +{r.countries.length - 3}</span>}
                      {/* Гео в имени разошлось с таргетом: крео открутилось не
                          туда, куда написано. Не ошибка расчёта — повод глянуть. */}
                      {r.geoMismatch && (
                        <span className="ml-1.5 text-[10px] text-amber-400 border border-amber-700/40 rounded px-1"
                              title={`В коде указано «${r.geoFromCode}», а таргет другой`}>
                          ≠ {r.geoFromCode}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-zinc-400">{r.approach}</td>
                    {COLS.map((c) => {
                      const m = metrics(r);
                      return (
                        <td key={c.label} className={`px-3 py-2.5 whitespace-nowrap ${c.strong ? "text-zinc-200" : "text-zinc-400"} ${
                          c.label === "ROMI" && (m.depSum ?? 0) > m.spend ? "text-green-400" : ""}`}>{c.cell(m)}</td>
                      );
                    })}
                  </tr>
                  {merge === "all" && openRows.has(r.code) && [...(r.details ?? [])].sort((a, b) => b.spend - a.spend).map((d) => (
                    <tr key={d.code} className="bg-violet-950/10">
                      <td className="px-3 py-2 pl-8 text-zinc-400 whitespace-nowrap sticky left-0 bg-panel z-10" title={d.code}>
                        {d.code}<span className="ml-2 text-[11px] text-hint">{(d.countries.join(", ") || geoOfCode(d.code) || "—")} · {d.faces.join(", ") || "без лица"}</span>
                      </td>
                      <td className="px-3 py-2 text-hint">{d.countries.join(", ") || "—"}</td>
                      <td className="px-3 py-2 text-hint">{d.approach}</td>
                      {COLS.map((c) => <td key={c.label} className="px-3 py-2 whitespace-nowrap text-hint">{c.cell(metrics(d))}</td>)}
                    </tr>
                  ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-hint mt-3">
            Страны берутся из настроек таргета адсета, а не из имени креатива: имена пишет человек,
            и старые продолжают работать. Пометка ≠ значит, что гео в коде разошлось с таргетом.
            <br />
            Строка с доходом и нулевым расходом — не ошибка: депозит записывается в день, когда он
            сделан, а крео могли выключить раньше.
          </p>
        </>
      )}
      </Busy>
    </div>
  );
}
