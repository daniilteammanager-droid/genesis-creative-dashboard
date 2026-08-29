"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import type { LiveMode, LiveCampaignItem, LiveCreativeItem, LiveStatus } from "@/lib/reports-live/types";
import type { Period } from "@/lib/reports-live/periods";
import { DOLETYI_ID } from "@/lib/reports-live/buildLiveItems";
import { extractGeoName, UNKNOWN_GEO } from "@/lib/reports-live/geo";
import type { CreativeRow } from "@/lib/creatives/types";
import { loadCreativeRows } from "@/lib/creatives/loadCreativeRows";
import { type MediaFile, findMedia, normalize } from "@/lib/creatives/media";
import { supabase, isSupabaseConfigured, type CreativeNote } from "@/lib/supabase";
import SharedCreativeModal from "@/components/CreativeModal";

// ─── Format helpers ────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 0): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtMoney(n: number, decimals = 2): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  return "$" + fmt(n, decimals);
}

function fmtCost(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return "$" + fmt(n, 2);
}

function fmtPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return (n * 100).toFixed(1) + "%";
}

function romiClass(romi: number | null): string {
  if (romi === null) return "text-zinc-600";
  if (romi >= 0.5) return "text-green-400";
  if (romi >= 0) return "text-yellow-400";
  return "text-red-400";
}

function fmtPeriodLabel(p: Period): string {
  const short = (d: string) => d.slice(5).split("-").reverse().join(".");
  return `${short(p.since)} – ${short(p.until)}`;
}

function sumCreativeMetrics(items: LiveCreativeItem[]) {
  const t = { spend: 0, clicks: 0, impressions: 0, pdp: 0, dia: 0, deposits: 0, revenue: 0 };
  for (const c of items) {
    t.spend += c.spend; t.clicks += c.clicks; t.impressions += c.impressions;
    t.pdp += c.pdp; t.dia += c.dia; t.deposits += c.deposits; t.revenue += c.revenue;
  }
  return {
    ...t,
    romi: t.spend > 0 ? (t.revenue - t.spend) / t.spend : null,
    costPdp: t.pdp > 0 ? t.spend / t.pdp : null,
    costDia: t.dia > 0 ? t.spend / t.dia : null,
  };
}

// ─── API response shapes ───────────────────────────────────────────────────────

interface LiveApiResponse<T> {
  mode: LiveMode;
  period: Period;
  periods: Period[];
  items: T[];
  totalActiveDailyBudget: number;
  generatedAt: string;
  fetchedFrom: "api" | "cache";
  error?: string;
  warning?: string;
}

const SUB_MODES: { id: LiveMode; label: string }[] = [
  { id: "campaigns", label: "Кампании" },
  { id: "ads", label: "Объявления" },
];

// ─── Main component ────────────────────────────────────────────────────────────

export default function LiveAutoReport() {
  const [subMode, setSubMode] = useState<LiveMode>("campaigns");
  const [campaigns, setCampaigns] = useState<LiveCampaignItem[] | null>(null);
  const [creatives, setCreatives] = useState<LiveCreativeItem[] | null>(null);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [period, setPeriod] = useState<Period | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [partialWarning, setPartialWarning] = useState<string | null>(null);
  const [totalActiveDailyBudget, setTotalActiveDailyBudget] = useState(0);
  const [meta, setMeta] = useState<{ generatedAt: string; fetchedFrom: string } | null>(null);
  const [media, setMedia] = useState<MediaFile[]>([]);

  // Creative Library data — clicking a creative opens the exact same all-time modal
  // as the Creatives page, matched by "Creative Code" (the ad name, untouched).
  const [creativeRows, setCreativeRows] = useState<CreativeRow[]>([]);
  const [selectedRow, setSelectedRow] = useState<CreativeRow | null>(null);
  const [selectedNote, setSelectedNote] = useState<CreativeNote | undefined>(undefined);
  const [notFoundNotice, setNotFoundNotice] = useState<string | null>(null);

  useEffect(() => {
    // /api/media answers {error} on failure — without this guard media stops being an
    // array and the first findMedia() call throws while rendering.
    fetch("/api/media")
      .then((r) => r.json())
      .then((d) => setMedia(Array.isArray(d) ? d : []))
      .catch(() => {});
    loadCreativeRows().then(setCreativeRows).catch(() => {});
  }, []);

  // Switching mode resets the selected period — campaigns and ads have separate sheet lists.
  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/reports-live?mode=${subMode}`)
      .then((r) => r.json() as Promise<LiveApiResponse<LiveCampaignItem | LiveCreativeItem>>)
      .then((d) => {
        if (d.error) throw new Error(d.error);
        if (d.mode === "campaigns") setCampaigns(d.items as LiveCampaignItem[]);
        else setCreatives(d.items as LiveCreativeItem[]);
        setPeriods(d.periods);
        setPeriod(d.period);
        setMeta({ generatedAt: d.generatedAt, fetchedFrom: d.fetchedFrom });
        setPartialWarning(d.warning ?? null);
        setTotalActiveDailyBudget(d.totalActiveDailyBudget ?? 0);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [subMode]);

  function loadPeriod(key: string) {
    setLoading(true);
    setError(null);
    fetch(`/api/reports-live?mode=${subMode}&period=${encodeURIComponent(key)}`)
      .then((r) => r.json() as Promise<LiveApiResponse<LiveCampaignItem | LiveCreativeItem>>)
      .then((d) => {
        if (d.error) throw new Error(d.error);
        if (d.mode === "campaigns") setCampaigns(d.items as LiveCampaignItem[]);
        else setCreatives(d.items as LiveCreativeItem[]);
        setPeriods(d.periods);
        setPeriod(d.period);
        setMeta({ generatedAt: d.generatedAt, fetchedFrom: d.fetchedFrom });
        setPartialWarning(d.warning ?? null);
        setTotalActiveDailyBudget(d.totalActiveDailyBudget ?? 0);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  async function openCreative(creativeCode: string) {
    const key = normalize(creativeCode);
    const row = creativeRows.find((r) => normalize(r.creative) === key);
    if (!row) {
      setNotFoundNotice(`Крео «${creativeCode}» ещё не добавлено в таблицу Creatives.`);
      setTimeout(() => setNotFoundNotice(null), 4000);
      return;
    }
    setSelectedRow(row);
    setSelectedNote(undefined);
    if (isSupabaseConfigured) {
      const { data } = await supabase.from("creative_notes").select("*").eq("creative_code", row.creative).maybeSingle();
      if (data) setSelectedNote(data as CreativeNote);
    }
  }

  async function toggleFavorite(creativeCode: string) {
    if (!isSupabaseConfigured) return;
    const newFavorite = !(selectedNote?.favorite ?? false);
    const updated: CreativeNote = selectedNote
      ? { ...selectedNote, favorite: newFavorite, updated_at: new Date().toISOString() }
      : { creative_code: creativeCode, favorite: newFavorite, note: null, transcription_ru: null, updated_at: new Date().toISOString() };
    setSelectedNote(updated);
    try {
      const { error: err } = await supabase.from("creative_notes").upsert(updated, { onConflict: "creative_code" });
      if (err) throw err;
    } catch (e) {
      console.error("Ошибка сохранения favorite:", e);
    }
  }

  const sortedCampaigns = useMemo(() => {
    if (!campaigns) return [];
    // "Долёты" (no Meta match) always pinned last regardless of sort.
    return [...campaigns].sort((a, b) => {
      if (a.campaignId === DOLETYI_ID) return 1;
      if (b.campaignId === DOLETYI_ID) return -1;
      return b.spend - a.spend;
    });
  }, [campaigns]);
  const sortedCreatives = useMemo(
    () => (creatives ? [...creatives].sort((a, b) => b.spend - a.spend) : []),
    [creatives]
  );

  const campaignTotals = useMemo(() => {
    const t = { spend: 0, clicks: 0, impressions: 0, pdp: 0, dia: 0, deposits: 0, revenue: 0 };
    for (const c of sortedCampaigns) {
      t.spend += c.spend; t.clicks += c.clicks; t.impressions += c.impressions;
      t.pdp += c.pdp; t.dia += c.dia; t.deposits += c.deposits; t.revenue += c.revenue;
    }
    return {
      ...t,
      romi: t.spend > 0 ? (t.revenue - t.spend) / t.spend : null,
      costPdp: t.pdp > 0 ? t.spend / t.pdp : null,
      costDia: t.dia > 0 ? t.spend / t.dia : null,
    };
  }, [sortedCampaigns]);

  const creativeTotals = useMemo(() => sumCreativeMetrics(sortedCreatives), [sortedCreatives]);

  // Grouped by geo (second dash-segment of the creative name, e.g. "balance5-es-tg" -> Испания).
  // Groups sorted by spend desc; "Без гео" always last.
  const creativesByGeo = useMemo(() => {
    const groups = new Map<string, LiveCreativeItem[]>();
    for (const c of sortedCreatives) {
      const geo = extractGeoName(c.creativeCode);
      (groups.get(geo) ?? groups.set(geo, []).get(geo)!).push(c);
    }
    return [...groups.entries()]
      .map(([geo, items]) => ({ geo, items, totals: sumCreativeMetrics(items) }))
      .sort((a, b) => {
        if (a.geo === UNKNOWN_GEO) return 1;
        if (b.geo === UNKNOWN_GEO) return -1;
        return b.totals.spend - a.totals.spend;
      });
  }, [sortedCreatives]);

  const chip = (active: boolean) =>
    `px-4 py-2 rounded-xl text-sm font-semibold transition ${
      active
        ? "bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm"
        : "text-zinc-400 hover:text-violet-300"
    }`;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-1 bg-[#111118] border border-violet-900/40 rounded-2xl p-1 w-fit">
            {SUB_MODES.map((m) => (
              <button key={m.id} onClick={() => setSubMode(m.id)} className={chip(subMode === m.id)}>
                {m.label}
              </button>
            ))}
          </div>
          {periods.length > 0 && period && (
            <select
              value={period.key}
              onChange={(e) => loadPeriod(e.target.value)}
              className="bg-[#111118] border border-violet-900/40 rounded-xl px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-violet-500/50"
            >
              {periods.map((p) => (
                <option key={p.key} value={p.key}>
                  {fmtPeriodLabel(p)}
                </option>
              ))}
            </select>
          )}
        </div>
        {meta && (
          <span className="text-xs text-zinc-600">
            Meta Marketing API · Обновлено: {new Date(meta.generatedAt).toLocaleTimeString()}
            {meta.fetchedFrom === "cache" ? " (кэш)" : ""}
          </span>
        )}
      </div>

      {notFoundNotice && (
        <div className="bg-amber-950/40 border border-amber-700/30 text-amber-300/90 rounded-xl px-4 py-2.5 mb-4 text-sm">
          {notFoundNotice}
        </div>
      )}

      {partialWarning && !loading && (
        <div className="bg-amber-950/40 border border-amber-700/30 text-amber-300/90 rounded-xl px-4 py-2.5 mb-4 text-sm">
          ⚠ {partialWarning}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-24">
          <div className="flex flex-col items-center gap-4 animate-pulse">
            <div className="w-10 h-10 rounded-full border-2 border-violet-600/40 border-t-violet-400 animate-spin" />
            <p className="text-violet-300/50 text-sm tracking-widest uppercase">Loading live data...</p>
          </div>
        </div>
      )}

      {error && !loading && (
        <div className="bg-red-950/40 border border-red-700/30 rounded-xl px-5 py-4 text-red-300 text-sm">
          Не удалось загрузить: {error}
        </div>
      )}

      {!loading && !error && subMode === "campaigns" && sortedCampaigns.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-11 gap-2 mb-4">
          <Stat label="Актив. бюджет/день" value={fmtMoney(totalActiveDailyBudget)} />
          <Stat label="Spend" value={fmtMoney(campaignTotals.spend)} />
          <Stat label="Клики" value={fmt(campaignTotals.clicks)} />
          <Stat label="Показы" value={fmt(campaignTotals.impressions)} />
          <Stat label="ПДП" value={fmt(campaignTotals.pdp)} />
          <Stat label="Cost ПДП" value={fmtCost(campaignTotals.costPdp)} />
          <Stat label="Диа" value={fmt(campaignTotals.dia)} />
          <Stat label="Cost Диа" value={fmtCost(campaignTotals.costDia)} />
          <Stat label="Депозиты" value={fmt(campaignTotals.deposits)} />
          <Stat label="Revenue" value={campaignTotals.revenue > 0 ? fmtMoney(campaignTotals.revenue, 0) : "—"} tone={campaignTotals.revenue > 0 ? "good" : undefined} />
          <Stat label="ROMI" value={fmtPct(campaignTotals.romi)} tone={campaignTotals.romi !== null ? (campaignTotals.romi >= 0 ? "good" : "bad") : undefined} />
        </div>
      )}

      {!loading && !error && subMode === "campaigns" && (
        <div className="bg-[#111118] border border-violet-900/20 rounded-2xl">
          <div className="overflow-auto max-h-[75vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[#0f0d18] border-b border-violet-900/20">
                <tr>
                  {["", "Кампания", "Кабинет", "Бюджет/день", "Spend", "Клики", "Показы", "ПДП", "Cost ПДП", "Диа", "Cost Диа", "Депозиты", "Revenue", "ROMI"].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-violet-900/10">
                {sortedCampaigns.map((c) => (
                  <tr
                    key={c.campaignId}
                    className={`hover:bg-violet-900/5 transition-colors ${c.campaignId === DOLETYI_ID ? "bg-zinc-900/40 italic" : ""}`}
                  >
                    <td className="px-3 py-2.5"><StatusBadge status={c.status} /></td>
                    <td className="px-3 py-2.5 text-zinc-200 max-w-[280px]">
                      <span className="block truncate" title={c.campaignId === DOLETYI_ID ? "Кампании без спенда и без метча в Meta API" : c.campaignName}>
                        {c.campaignName}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-zinc-500 text-xs whitespace-nowrap">{c.accountName}</td>
                    <td className="px-3 py-2.5 tabular-nums whitespace-nowrap text-violet-300">{fmtMoney(c.dailyBudget ?? 0)}</td>
                    <td className="px-3 py-2.5 tabular-nums whitespace-nowrap text-white">{fmtMoney(c.spend)}</td>
                    <td className="px-3 py-2.5 tabular-nums text-zinc-300">{fmt(c.clicks)}</td>
                    <td className="px-3 py-2.5 tabular-nums text-zinc-500">{fmt(c.impressions)}</td>
                    <td className="px-3 py-2.5 tabular-nums text-zinc-300">{c.pdp > 0 ? fmt(c.pdp) : "—"}</td>
                    <td className="px-3 py-2.5 tabular-nums text-zinc-400">{fmtCost(c.costPdp)}</td>
                    <td className="px-3 py-2.5 tabular-nums text-zinc-300">{c.dia > 0 ? fmt(c.dia) : "—"}</td>
                    <td className="px-3 py-2.5 tabular-nums text-zinc-400">{fmtCost(c.costDia)}</td>
                    <td className="px-3 py-2.5 tabular-nums text-zinc-300">{c.deposits > 0 ? fmt(c.deposits) : "—"}</td>
                    <td className="px-3 py-2.5 tabular-nums whitespace-nowrap">
                      {c.revenue > 0 ? <span className="text-green-400">{fmtMoney(c.revenue, 0)}</span> : <span className="text-zinc-700">—</span>}
                    </td>
                    <td className={`px-3 py-2.5 tabular-nums font-medium whitespace-nowrap ${romiClass(c.romi)}`}>{fmtPct(c.romi)}</td>
                  </tr>
                ))}
                {sortedCampaigns.length === 0 && (
                  <tr>
                    <td colSpan={14} className="px-4 py-12 text-center text-zinc-600 text-sm">
                      Нет данных за выбранный период.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && !error && subMode === "ads" && sortedCreatives.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-11 gap-2 mb-4">
          <Stat label="Актив. бюджет/день" value={fmtMoney(totalActiveDailyBudget)} />
          <Stat label="Spend" value={fmtMoney(creativeTotals.spend)} />
          <Stat label="Клики" value={fmt(creativeTotals.clicks)} />
          <Stat label="Показы" value={fmt(creativeTotals.impressions)} />
          <Stat label="ПДП" value={fmt(creativeTotals.pdp)} />
          <Stat label="Cost ПДП" value={fmtCost(creativeTotals.costPdp)} />
          <Stat label="Диа" value={fmt(creativeTotals.dia)} />
          <Stat label="Cost Диа" value={fmtCost(creativeTotals.costDia)} />
          <Stat label="Депозиты" value={fmt(creativeTotals.deposits)} />
          <Stat label="Revenue" value={creativeTotals.revenue > 0 ? fmtMoney(creativeTotals.revenue, 0) : "—"} tone={creativeTotals.revenue > 0 ? "good" : undefined} />
          <Stat label="ROMI" value={fmtPct(creativeTotals.romi)} tone={creativeTotals.romi !== null ? (creativeTotals.romi >= 0 ? "good" : "bad") : undefined} />
        </div>
      )}

      {!loading && !error && subMode === "ads" && (
        <div className="bg-[#111118] border border-violet-900/20 rounded-2xl">
          <div className="overflow-auto max-h-[75vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[#0f0d18] border-b border-violet-900/20">
                <tr>
                  {["", "Крео", "Объявл.", "Бюджет/день", "Spend", "Клики", "Показы", "ПДП", "Cost ПДП", "Диа", "Cost Диа", "Депозиты", "Revenue", "ROMI"].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-violet-900/10">
                {creativesByGeo.map(({ geo, items, totals }) => (
                  <Fragment key={geo}>
                    <tr className="bg-[#0f0d18]">
                      <td colSpan={14} className="px-3 py-2 text-xs font-semibold text-violet-300 uppercase tracking-wider">
                        {geo} · {items.length} крео
                      </td>
                    </tr>
                    {items.map((c) => (
                      <tr
                        key={c.creativeCode}
                        onClick={() => openCreative(c.creativeCode)}
                        title={c.adCount === 0 ? "Есть результаты в CRM, но нет данных Meta API — возможно не хватает доступа к рекламному кабинету" : undefined}
                        className={`hover:bg-violet-900/5 transition-colors cursor-pointer ${c.adCount === 0 ? "bg-amber-950/10" : ""}`}
                      >
                        <td className="px-3 py-2.5"><StatusBadge status={c.status} /></td>
                        <td className="px-3 py-2.5 max-w-[220px]">
                          <span className="block truncate text-white font-medium" title={c.creativeCode}>{c.creativeCode}</span>
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-xs">
                          {c.adCount === 0 ? <span className="text-amber-400" title="Нет данных Meta API">⚠ 0</span> : <span className="text-zinc-500">{c.adCount}</span>}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums whitespace-nowrap text-violet-300">{fmtMoney(c.activeDailyBudget)}</td>
                        <td className="px-3 py-2.5 tabular-nums whitespace-nowrap text-white">{fmtMoney(c.spend)}</td>
                        <td className="px-3 py-2.5 tabular-nums text-zinc-300">{fmt(c.clicks)}</td>
                        <td className="px-3 py-2.5 tabular-nums text-zinc-500">{fmt(c.impressions)}</td>
                        <td className="px-3 py-2.5 tabular-nums text-zinc-300">{c.pdp > 0 ? fmt(c.pdp) : "—"}</td>
                        <td className="px-3 py-2.5 tabular-nums text-zinc-400">{fmtCost(c.costPdp)}</td>
                        <td className="px-3 py-2.5 tabular-nums text-zinc-300">{c.dia > 0 ? fmt(c.dia) : "—"}</td>
                        <td className="px-3 py-2.5 tabular-nums text-zinc-400">{fmtCost(c.costDia)}</td>
                        <td className="px-3 py-2.5 tabular-nums text-zinc-300">{c.deposits > 0 ? fmt(c.deposits) : "—"}</td>
                        <td className="px-3 py-2.5 tabular-nums whitespace-nowrap">
                          {c.revenue > 0 ? <span className="text-green-400">{fmtMoney(c.revenue, 0)}</span> : <span className="text-zinc-700">—</span>}
                        </td>
                        <td className={`px-3 py-2.5 tabular-nums font-medium whitespace-nowrap ${romiClass(c.romi)}`}>{fmtPct(c.romi)}</td>
                      </tr>
                    ))}
                    <tr className="bg-violet-950/20 font-semibold border-t border-violet-900/20">
                      <td colSpan={3} className="px-3 py-2 text-zinc-300">Итого — {geo}</td>
                      <td className="px-3 py-2 tabular-nums text-zinc-600" title="Бюджет пересекается между крео одной кампании — сумма по группе была бы задвоена">—</td>
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap text-white">{fmtMoney(totals.spend)}</td>
                      <td className="px-3 py-2 tabular-nums text-zinc-300">{fmt(totals.clicks)}</td>
                      <td className="px-3 py-2 tabular-nums text-zinc-500">{fmt(totals.impressions)}</td>
                      <td className="px-3 py-2 tabular-nums text-zinc-300">{totals.pdp > 0 ? fmt(totals.pdp) : "—"}</td>
                      <td className="px-3 py-2 tabular-nums text-zinc-400">{fmtCost(totals.costPdp)}</td>
                      <td className="px-3 py-2 tabular-nums text-zinc-300">{totals.dia > 0 ? fmt(totals.dia) : "—"}</td>
                      <td className="px-3 py-2 tabular-nums text-zinc-400">{fmtCost(totals.costDia)}</td>
                      <td className="px-3 py-2 tabular-nums text-zinc-300">{totals.deposits > 0 ? fmt(totals.deposits) : "—"}</td>
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                        {totals.revenue > 0 ? <span className="text-green-400">{fmtMoney(totals.revenue, 0)}</span> : <span className="text-zinc-700">—</span>}
                      </td>
                      <td className={`px-3 py-2 tabular-nums font-semibold whitespace-nowrap ${romiClass(totals.romi)}`}>{fmtPct(totals.romi)}</td>
                    </tr>
                  </Fragment>
                ))}
                {sortedCreatives.length === 0 && (
                  <tr>
                    <td colSpan={14} className="px-4 py-12 text-center text-zinc-600 text-sm">
                      Нет данных за выбранный период.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedRow && (
        <SharedCreativeModal
          item={selectedRow}
          mediaFile={findMedia(selectedRow.creative, media)}
          note={selectedNote}
          supabaseAvailable={isSupabaseConfigured}
          onClose={() => setSelectedRow(null)}
          onToggleFavorite={toggleFavorite}
          onNotesUpdated={setSelectedNote}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: LiveStatus }) {
  if (status === "active") {
    return <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" title="Активно" />;
  }
  if (status === "paused") {
    return (
      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-zinc-700 text-zinc-300 text-[8px] leading-none" title="Выключено">
        ⏸
      </span>
    );
  }
  return <span className="inline-block w-2.5 h-2.5 rounded-full bg-zinc-800" title="Нет данных о статусе" />;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="bg-[#111118] border border-violet-900/20 rounded-xl px-3 py-2.5">
      <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-base font-semibold tabular-nums ${tone === "good" ? "text-green-400" : tone === "bad" ? "text-red-400" : "text-white"}`}>
        {value}
      </p>
    </div>
  );
}
