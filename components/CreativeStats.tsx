"use client";

import { useEffect, useState } from "react";
import { DateRange } from "./DatePicker";
import { seg, Spinner } from "./ui";
import { mskDay, mskDaysAgo } from "@/lib/day";
import { rangeLabel } from "@/lib/calendar";
import { metricsOf, type CreativeDetail, type Sums } from "@/lib/creatives/detail";
import type { TileMetrics } from "@/lib/creatives/tile";
import { formatRomi, formatUsd } from "@/lib/creatives/format";

// Цифры крео в модалке (31.10.2026): период, все метрики со склада и динамика по неделям.
// Нет крео на складе (крутилось до подключений) — показываем то, что пришло с карточкой.

type Preset = "7" | "30" | "90" | "all" | "custom";
const PRESETS: { id: Exclude<Preset, "custom">; label: string }[] = [
  { id: "7", label: "7 дней" }, { id: "30", label: "30 дней" }, { id: "90", label: "90 дней" }, { id: "all", label: "Всё время" },
];

const count = (n: number) => n.toLocaleString("ru-RU");
const pct = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`);
const tone = (romi: number | null) => (romi === null ? "" : romi >= 130 ? "text-green-400" : romi >= 0 ? "text-yellow-300" : "text-red-400");

export default function CreativeStats({ code, fallback, fallbackLabel }: { code: string; fallback: TileMetrics; fallbackLabel: string }) {
  const [preset, setPreset] = useState<Preset>("30");
  const [range, setRange] = useState({ since: mskDaysAgo(29), until: mskDay() });
  // Ответ помнит, на какой запрос он пришёл: сменили период — старые цифры не выдаём за новые.
  const [data, setData] = useState<(CreativeDetail & { key: string }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const key = `${code}|${range.since}|${range.until}`;

  const pick = (p: Exclude<Preset, "custom">) => {
    setPreset(p);
    setRange({ since: p === "all" ? "" : mskDaysAgo(Number(p) - 1), until: mskDay() });
  };

  useEffect(() => {
    const ctl = new AbortController();
    const q = new URLSearchParams({ code, until: range.until, ...(range.since ? { since: range.since } : {}) });
    fetch(`/api/creatives/detail?${q}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((j) => { if (j.error) setErr(j.error); else { setErr(null); setData({ ...j, key: `${code}|${range.since}|${range.until}` }); } })
      .catch((e) => { if (e.name !== "AbortError") setErr("Не удалось загрузить цифры"); });
    return () => ctl.abort();
  }, [code, range]);

  const fresh = data?.key === key ? data : null;
  const loading = !fresh && !err;
  const empty = fresh && !fresh.weeks.length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="seg">
          {PRESETS.map((p) => <button key={p.id} onClick={() => pick(p.id)} {...seg(preset === p.id)}>{p.label}</button>)}
        </div>
        <DateRange since={fresh?.since || range.since || range.until} until={range.until} active={preset === "custom"}
                   onChange={(since, until) => { setPreset("custom"); setRange({ since, until }); }} />
      </div>
      <p className="text-xs text-hint -mt-3">
        Склад: расход Meta, депы Torro — по всем странам и кабинетам, которые тебе видны
        {fresh?.countries.length ? ` · страны: ${fresh.countries.join(", ")}` : ""}
      </p>

      {err && <p className="text-sm text-red-400">{err}</p>}
      {loading && <div className="flex justify-center py-10"><Spinner /></div>}

      {fresh && empty && (
        <div className="space-y-3">
          <p className="text-sm text-amber-200/90 bg-amber-950/30 border border-amber-700/30 rounded-xl px-4 py-3">
            {fresh.notice ?? "За этот период крео не крутилось и депов не давало."}
          </p>
          <Group title={fallbackLabel} tiles={[
            ["Спенд", formatUsd(fallback.spend)], ["Ревенью", formatUsd(fallback.revenue)],
            ["ROMI", formatRomi(fallback.romi), tone(fallback.romi)], ["Цена ПДП", formatUsd(fallback.cpdp)],
            ["Цена ДИА", formatUsd(fallback.cdia)], ["Цена депа", formatUsd(fallback.cdep)],
          ]} />
        </div>
      )}

      {fresh && !empty && <Numbers d={fresh} />}
    </div>
  );
}

function Numbers({ d }: { d: CreativeDetail }) {
  const s = d.sums;
  const m = metricsOf(s);
  return (
    <>
      <Group title="Деньги" tiles={[
        ["Спенд", formatUsd(s.spend)], ["Ревенью", formatUsd(s.rev)],
        ["Профит", formatUsd(m.profit), m.profit >= 0 ? "text-green-400" : "text-red-400"],
        ["ROMI", formatRomi(m.romi), tone(m.romi)], ["ROAS", m.roas === null ? "—" : m.roas.toLocaleString("ru-RU", { maximumFractionDigits: 2 })],
      ]} />
      <Group title="Трафик" tiles={[
        ["Показы", count(s.impressions)], ["CPM", formatUsd(m.cpm)], ["Клики", count(s.clicks)],
        ["CPC", formatUsd(m.cpc)], ["CTR", pct(m.ctr)],
      ]} />
      <Group title="Воронка Torro" tiles={[
        ["ПДП", count(s.subs)], ["Цена ПДП", formatUsd(m.cpdp)], ["Клик → ПДП", pct(m.clickToSub)],
        ["ДИА", count(s.dia)], ["Цена ДИА", formatUsd(m.cdia)], ["ПДП → ДИА", pct(m.subToDia)],
        ["Депы", count(s.deps)], ["Цена депа", formatUsd(m.cdep)], ["ДИА → деп", pct(m.diaToDep)],
        ["Сумма депов", formatUsd(s.rev)],
      ]} />
      <Weeks d={d} />
    </>
  );
}

function Group({ title, tiles }: { title: string; tiles: [string, string, string?][] }) {
  return (
    <section>
      <h3 className="label mb-2">{title}</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {tiles.map(([label, value, cls]) => (
          <div key={label} className="card rounded-xl px-3 py-2.5 min-w-0">
            <p className="label truncate">{label}</p>
            <p className={`mt-0.5 text-[17px] font-semibold tabular-nums truncate ${cls || "text-white"}`} title={value}>{value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// Столбик — спенд недели, над ним ROMI недели; под графиком та же неделя строкой таблицы.
function Weeks({ d }: { d: CreativeDetail }) {
  const max = Math.max(...d.weeks.map((w) => w.sums.spend), 1);
  const row = (s: Sums) => {
    const m = metricsOf(s);
    return [formatUsd(s.spend), count(s.subs), formatUsd(m.cpdp), count(s.dia), formatUsd(m.cdia), count(s.deps), formatUsd(m.cdep), s.rev ? formatUsd(s.rev) : "—"];
  };
  const HEAD = ["Неделя", "Спенд", "ПДП", "Цена ПДП", "ДИА", "Цена ДИА", "Депы", "Цена депа", "Ревенью", "ROMI"];
  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h3 className="label">Динамика по неделям</h3>
        <span className="text-xs text-hint">столбик — спенд, над ним — ROMI недели</span>
      </div>
      <div className="card rounded-xl overflow-hidden">
        <div className="flex items-end gap-1.5 h-32 px-3 pt-3 overflow-x-auto">
          {d.weeks.map((w) => {
            const romi = metricsOf(w.sums).romi;
            return (
              <div key={w.start} className="flex-1 min-w-[28px] h-full flex flex-col items-center justify-end gap-1" title={`${rangeLabel(w.start, w.end)}: ${formatUsd(w.sums.spend)}`}>
                <span className={`text-[11px] font-semibold tabular-nums ${tone(romi)}`}>{w.sums.spend ? formatRomi(romi === null ? null : Math.round(romi)) : ""}</span>
                <div className="w-full max-w-11 rounded-t-md bg-gradient-to-b from-violet-500 to-violet-800" style={{ height: `${Math.max(2, (w.sums.spend / max) * 84)}px` }} />
              </div>
            );
          })}
        </div>
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full text-[13px] tabular-nums">
            <thead>
              <tr>{HEAD.map((h, i) => <th key={h} className={`label px-3 py-2 whitespace-nowrap ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {d.weeks.map((w) => {
                const romi = metricsOf(w.sums).romi;
                return (
                  <tr key={w.start} className="border-t border-line/50">
                    <td className="px-3 py-1.5 whitespace-nowrap text-zinc-300">{rangeLabel(w.start, w.end)}</td>
                    {row(w.sums).map((v, i) => <td key={i} className="px-3 py-1.5 text-right whitespace-nowrap text-zinc-200">{v}</td>)}
                    <td className={`px-3 py-1.5 text-right whitespace-nowrap ${tone(romi)}`}>{formatRomi(romi)}</td>
                  </tr>
                );
              })}
              <tr className="border-t border-line bg-violet-950/30 font-semibold">
                <td className="px-3 py-2 text-white">Итого</td>
                {row(d.sums).map((v, i) => <td key={i} className="px-3 py-2 text-right whitespace-nowrap text-white">{v}</td>)}
                <td className={`px-3 py-2 text-right whitespace-nowrap ${tone(metricsOf(d.sums).romi)}`}>{formatRomi(metricsOf(d.sums).romi)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
