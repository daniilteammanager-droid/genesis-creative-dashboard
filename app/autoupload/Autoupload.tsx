"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Plan, PlanInput } from "@/lib/autoupload/plan";
import type { LibraryItem } from "@/lib/autoupload/options";
import { mskDay } from "@/lib/day";
import LibraryPicker from "./LibraryPicker";

// Автозалив (Decision 081): форма → «Проверить сборку» → «Создать». Сборку и
// нейминг считает сервер (lib/autoupload/plan.ts), здесь только ввод и показ.

const GEOS = ["ESP", "ARG", "MEX", "COL", "CHL", "PER", "PRY", "URY", "ECU", "PAN"];
const LANDERS: Record<string, string[]> = { TG: ["TGR", "MTG", "VSL1", "VSL2", "KAL1", "KAL2"], WA: ["ART1", "ART2", "ART3"] };
const CTAS: [string, string][] = [["LEARN_MORE", "Узнать больше"], ["SIGN_UP", "Регистрация"], ["CONTACT_US", "Написать нам"], ["SUBSCRIBE", "Подписаться"], ["APPLY_NOW", "Подать заявку"]];

const card = "bg-[#111118] border border-violet-900/30 rounded-2xl p-5";
const field = "bg-[#0d0b14] border border-violet-900/40 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-600/50 text-white";
const small = "px-3 py-1.5 rounded-lg text-sm border transition disabled:opacity-50";
const primary = "px-4 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-600 to-violet-500 text-white hover:from-violet-500 hover:to-violet-400 transition disabled:opacity-50";
const h2 = "text-base font-semibold text-white mb-3";

interface Options { accounts: { id: string; name: string; status: string }[]; landings: { id: number; name: string; url: string }[]; creatives: LibraryItem[] }
interface JobView { id: string; status: string; stage: string | null; error: string | null; createdAt: string; summary: Plan["summary"]; names: string[]; done: { campaigns: number; ads: number } }
type CampaignRow = PlanInput["campaigns"][number];
type AdsetRow = PlanInput["adsets"][number];

const newCampaign = (): CampaignRow => ({ geo: "ESP", actor: "ROMAN", funnel: "TG", marker: "NEW", lander: "TGR", landingUrl: "" });
const newAdset = (): AdsetRow => ({ target: "BROAD", customAudienceId: "", label: "", creatives: [] });
const STATUS: Record<string, string> = { creating: "Заливается", created: "Готово", failed: "Ошибка", cancelling: "Удаляю", cancelled: "Отменено" };

export default function Autoupload() {
  const [opt, setOpt] = useState<Options | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [details, setDetails] = useState<Record<string, { pixels: { id: string; name: string }[]; pages: { id: string; name: string }[] } | string>>({});
  const [pixelBy, setPixelBy] = useState<Record<string, string>>({});
  const [pageId, setPageId] = useState("");
  const [date, setDate] = useState(mskDay());
  const [launchTime, setLaunchTime] = useState("");
  const [campaignNumber, setCampaignNumber] = useState(1);
  const [budget, setBudget] = useState("20");
  const [oneToOne, setOneToOne] = useState(false);
  const [paused, setPaused] = useState(false);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([newCampaign()]);
  const [adsets, setAdsets] = useState<AdsetRow[]>([newAdset()]);
  const [text, setText] = useState({ primaryText: "", headline: "", description: "", cta: "LEARN_MORE" });
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetch("/api/autoupload?op=options").then((r) => r.json()).then((d) => (d.error ? setErr(d.error) : setOpt(d))).catch(() => setErr("Сеть не ответила"));
  }, []);
  const loadJobs = useCallback(() => fetch("/api/autoupload?op=jobs").then((r) => r.json()).then((d) => d.jobs && setJobs(d.jobs)).catch(() => undefined), []);
  useEffect(() => { loadJobs(); }, [loadJobs]);
  useEffect(() => {
    if (!jobs.some((j) => j.status === "creating" || j.status === "cancelling")) return;
    const t = setInterval(loadJobs, 5000);
    return () => clearInterval(t);
  }, [jobs, loadJobs]);

  // Статусы кабинетов вживую из Meta: забаненные и в unsettled пропадут из списка.
  async function refreshAccounts() {
    setRefreshing(true);
    try {
      const d = await fetch("/api/autoupload?op=accounts").then((r) => r.json());
      if (d.error) throw new Error(d.error);
      setOpt((o) => (o ? { ...o, accounts: d.accounts } : o));
      const alive = new Set((d.accounts as { id: string }[]).map((a) => a.id));
      setAccountIds((ids) => ids.filter((id) => alive.has(id)));
      setPlan(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }

  // Пиксели и страницы — у каждого выбранного кабинета свои.
  function toggleAccount(id: string) {
    setPlan(null);
    setAccountIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
    if (details[id]) return;
    fetch(`/api/autoupload?op=account&id=${id}`).then((r) => r.json()).then((d) => {
      setDetails((prev) => ({ ...prev, [id]: d.error ?? d }));
      if (!d.error && d.pixels?.length === 1) setPixelBy((p) => ({ ...p, [id]: d.pixels[0].id }));
    });
  }
  const pages = useMemo(() => {
    const m = new Map<string, string>();
    for (const id of accountIds) { const d = details[id]; if (d && typeof d !== "string") d.pages.forEach((p) => m.set(p.id, p.name)); }
    return [...m];
  }, [accountIds, details]);

  const input = (): PlanInput => ({
    accountIds, pixelByAccount: pixelBy, pageId, date, launchTime, campaignNumber, dailyBudgetUsd: Number(budget.replace(",", ".")),
    oneToOne, paused, campaigns, adsets: adsets.map((a) => ({ ...a, customAudienceId: a.customAudienceId || undefined })), text,
  });
  const edit = <T,>(set: React.Dispatch<React.SetStateAction<T[]>>, i: number, patch: Partial<T>) => {
    setPlan(null);
    set((rows) => rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  };

  async function post(op: "preview" | "launch") {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/autoupload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op, input: input() }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Не получилось");
      if (op === "preview") setPlan(d.plan);
      else { setPlan(null); loadJobs(); }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function cancel(id: string) {
    if (!window.confirm("Удалить кампании этого залива в кабинетах? Адсеты и объявления удалятся вместе с ними.")) return;
    await fetch("/api/autoupload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "cancel", id }) });
    loadJobs();
  }

  if (err && !opt) return <div className="max-w-5xl mx-auto px-4 py-6 text-red-300">{err}</div>;
  if (!opt) return <div className="max-w-5xl mx-auto px-4 py-6 text-zinc-500">Загружаю…</div>;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-white">Автозалив</h1>
        <p className="text-sm text-zinc-500 mt-1">Кампании, адсеты и объявления в Meta по неймингу команды. Креативы — только те, что ты сам загрузил в Медиатеку, в Meta уходит исходник без сжатия.</p>
      </div>

      <div data-tour="au-base" className={card}>
        <div className="flex items-center gap-2 mb-3">
          <h2 className={`${h2} mb-0`}>01 · Кабинеты и основа</h2>
          <button type="button" disabled={refreshing} onClick={refreshAccounts} className={`${small} border-violet-700/50 text-violet-200 ml-auto`}>
            {refreshing ? "Обновляю…" : "↻ Обновить кабинеты"}
          </button>
        </div>
        {opt.accounts.length === 0 ? (
          <p className="text-sm text-zinc-400 mb-4">Живых кабинетов нет. Здесь только ACTIVE без ограничений — бан, unsettled и пропавшие не показываются. Ключ Meta — в Настройках → Интеграции.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-2 mb-4">
            {opt.accounts.map((a) => {
              const d = details[a.id];
              return (
                <div key={a.id} className={`border rounded-xl px-3 py-2 ${accountIds.includes(a.id) ? "border-violet-600/60 bg-violet-900/10" : "border-violet-900/30"}`}>
                  <label className="flex items-center gap-2 text-sm text-zinc-200 cursor-pointer">
                    <input type="checkbox" checked={accountIds.includes(a.id)} onChange={() => toggleAccount(a.id)} className="accent-violet-500" />
                    <span className="truncate">{a.name}</span>
                    <span className={`ml-auto text-[10px] ${a.status === "ACTIVE" ? "text-green-400" : "text-amber-400"}`}>{a.status}</span>
                  </label>
                  {accountIds.includes(a.id) && (
                    typeof d === "string" ? <p className="text-xs text-red-300 mt-1">{d}</p> : !d ? <p className="text-xs text-zinc-500 mt-1">Гружу пиксели…</p> : (
                      <select value={pixelBy[a.id] ?? ""} onChange={(e) => { setPlan(null); setPixelBy((p) => ({ ...p, [a.id]: e.target.value })); }} className={`${field} w-full mt-2`}>
                        <option value="" disabled>Пиксель</option>
                        {d.pixels.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.id}</option>)}
                      </select>
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="grid sm:grid-cols-3 gap-2">
          <select value={pageId} onChange={(e) => { setPlan(null); setPageId(e.target.value); }} className={field}>
            <option value="">Facebook Page</option>
            {pages.map(([id, name]) => <option key={id} value={id}>{name} · {id}</option>)}
          </select>
          <label className="flex items-center gap-2 text-xs text-zinc-500">Дата <input type="date" value={date} onChange={(e) => { setPlan(null); setDate(e.target.value); }} className={`${field} flex-1`} /></label>
          <label className="flex items-center gap-2 text-xs text-zinc-500">Старт (время кабинета) <input type="time" value={launchTime} onChange={(e) => { setPlan(null); setLaunchTime(e.target.value); }} className={`${field} flex-1`} /></label>
          <label className="flex items-center gap-2 text-xs text-zinc-500">Номер с <input type="number" min={1} value={campaignNumber} onChange={(e) => { setPlan(null); setCampaignNumber(Number(e.target.value)); }} className={`${field} w-24`} /></label>
          <label className="flex items-center gap-2 text-xs text-zinc-500">Бюджет в день, $ <input inputMode="decimal" value={budget} onChange={(e) => { setPlan(null); setBudget(e.target.value); }} className={`${field} w-24`} /></label>
          <div className="flex items-center gap-4 text-sm text-zinc-300">
            <label className="flex items-center gap-2"><input type="checkbox" checked={oneToOne} onChange={(e) => { setPlan(null); setOneToOne(e.target.checked); }} className="accent-violet-500" />1‑1‑1</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={paused} onChange={(e) => { setPlan(null); setPaused(e.target.checked); }} className="accent-violet-500" />на паузе</label>
          </div>
        </div>
        <p className="text-[11px] text-zinc-600 mt-2">1‑1‑1 — каждый креатив своей кампанией с одним адсетом. Без «на паузе» всё создаётся ACTIVE и сразу крутится.</p>
      </div>

      <div data-tour="au-campaigns" className={card}>
        <h2 className={h2}>02 · Кампании</h2>
        <div className="space-y-2">
          {campaigns.map((c, i) => (
            <div key={i} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2 items-center">
              <select value={c.geo} onChange={(e) => edit(setCampaigns, i, { geo: e.target.value })} className={field}>{GEOS.map((g) => <option key={g}>{g}</option>)}</select>
              <select value={c.actor} onChange={(e) => edit(setCampaigns, i, { actor: e.target.value })} className={field}><option>ROMAN</option><option>RICKY</option></select>
              <select value={c.funnel} onChange={(e) => edit(setCampaigns, i, { funnel: e.target.value, lander: LANDERS[e.target.value][0] })} className={field}><option>TG</option><option>WA</option></select>
              <select value={c.marker} onChange={(e) => edit(setCampaigns, i, { marker: e.target.value })} className={field}><option>NEW</option><option>EXP</option><option>MIX</option></select>
              <select value={c.lander} onChange={(e) => edit(setCampaigns, i, { lander: e.target.value })} className={field}>{LANDERS[c.funnel].map((l) => <option key={l}>{l}</option>)}</select>
              <select value={c.landingUrl} onChange={(e) => edit(setCampaigns, i, { landingUrl: e.target.value })} className={`${field} col-span-2 sm:col-span-2 lg:col-span-1`}>
                <option value="">Ссылка MVP</option>
                {opt.landings.map((l) => <option key={l.id} value={l.url}>{l.name}</option>)}
              </select>
              <button type="button" onClick={() => setCampaigns((r) => r.filter((_, k) => k !== i))} disabled={campaigns.length === 1} className={`${small} border-red-900/40 text-red-300`}>Убрать</button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setCampaigns((r) => [...r, newCampaign()])} className={`${small} border-violet-700/50 text-violet-200 mt-3`}>＋ Кампания</button>
        <p className="text-[11px] text-zinc-600 mt-2">Имя соберётся само: CAB####_ДД.ММ_ВОРОНКА_МАРКЕР_GEO_ЛЕНДИНГ_ЛИЦО_N. К ссылке допишется трекинг: твой id Torro, пиксель и макросы кампании.</p>
      </div>

      <div data-tour="au-adsets" className={card}>
        <h2 className={h2}>03 · Адсеты и креативы</h2>
        <div className="space-y-3">
          {adsets.map((a, i) => {
            return (
              <div key={i} className="border border-violet-900/30 rounded-xl p-3">
                <div className="flex flex-wrap gap-2 items-center mb-2">
                  <span className="text-xs text-zinc-500">Адсет {i + 1}</span>
                  <select value={a.target} onChange={(e) => edit(setAdsets, i, { target: e.target.value })} className={field}><option>BROAD</option><option>INT</option><option>RETARGET</option></select>
                  {a.target === "RETARGET" && <input placeholder="ID Custom Audience" value={a.customAudienceId ?? ""} onChange={(e) => edit(setAdsets, i, { customAudienceId: e.target.value.trim() })} className={field} />}
                  <input placeholder="Метка (необязательно)" value={a.label ?? ""} onChange={(e) => edit(setAdsets, i, { label: e.target.value })} className={`${field} w-44`} />
                  <button type="button" onClick={() => setAdsets((r) => r.filter((_, k) => k !== i))} disabled={adsets.length === 1} className={`${small} border-red-900/40 text-red-300 ml-auto`}>Убрать</button>
                </div>
                {a.creatives.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {a.creatives.map((c) => (
                      <button key={c.key} type="button" onClick={() => edit(setAdsets, i, { creatives: a.creatives.filter((x) => x.key !== c.key) })}
                              className="text-[11px] px-2 py-1 rounded-lg bg-violet-900/30 text-violet-100 border border-violet-700/40">{c.code} ✕</button>
                    ))}
                  </div>
                )}
                <button type="button" onClick={() => setPickerFor(i)} className={`${small} border-violet-700/50 text-violet-200`}>＋ Креативы из медиатеки</button>
              </div>
            );
          })}
        </div>
        {pickerFor !== null && adsets[pickerFor] && (
          <LibraryPicker items={opt.creatives} added={new Set(adsets[pickerFor].creatives.map((c) => c.key))} onClose={() => setPickerFor(null)}
                         onAdd={(picked) => { edit(setAdsets, pickerFor, { creatives: [...adsets[pickerFor].creatives, ...picked.map(({ key, code, kind }) => ({ key, code, kind }))] }); setPickerFor(null); }} />
        )}
        <button type="button" onClick={() => setAdsets((r) => [...r, newAdset()])} className={`${small} border-violet-700/50 text-violet-200 mt-3`}>＋ Адсет</button>
        <p className="text-[11px] text-zinc-600 mt-2">Набор креативов клонируется во все кампании; у имён по неймингу хвост гео пересоберётся под страну кампании, старые имена уйдут как есть.</p>
      </div>

      <div className={card}>
        <h2 className={h2}>04 · Текст</h2>
        <div className="grid sm:grid-cols-2 gap-2">
          <textarea placeholder="Основной текст" value={text.primaryText} onChange={(e) => { setPlan(null); setText({ ...text, primaryText: e.target.value }); }} className={`${field} sm:col-span-2 min-h-20`} />
          <input placeholder="Заголовок" value={text.headline} onChange={(e) => { setPlan(null); setText({ ...text, headline: e.target.value }); }} className={field} />
          <input placeholder="Описание" value={text.description} onChange={(e) => { setPlan(null); setText({ ...text, description: e.target.value }); }} className={field} />
          <select value={text.cta} onChange={(e) => { setPlan(null); setText({ ...text, cta: e.target.value }); }} className={field}>{CTAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </div>
      </div>

      <div data-tour="au-check" className={card}>
        <div className="flex flex-wrap gap-2 items-center">
          <button type="button" disabled={busy} onClick={() => post("preview")} className={`${small} border-violet-700/50 text-violet-200 py-2.5`}>Проверить сборку</button>
          <button type="button" disabled={busy || !plan} onClick={() => { if (window.confirm(`Создать ${plan!.summary.campaigns} кампаний, ${plan!.summary.adsets} адсетов и ${plan!.summary.ads} объявлений${paused ? " на паузе" : " и сразу запустить"}?`)) post("launch"); }} className={primary}>
            {paused ? "Создать на паузе" : "Создать и запустить"}
          </button>
          {busy && <span className="text-xs text-zinc-500">Секунду…</span>}
        </div>
        {err && <div className="mt-3 rounded-xl px-4 py-3 text-sm border bg-red-950/40 border-red-700/30 text-red-300">{err}</div>}
        {plan && (
          <div className="mt-3 text-sm">
            <p className="text-zinc-300 mb-2">Сборка в порядке: {plan.summary.campaigns} кампаний · {plan.summary.adsets} адсетов · {plan.summary.ads} объявлений · кабинетов {plan.summary.accounts}</p>
            <div className="max-h-72 overflow-y-auto space-y-2">
              {plan.campaigns.map((c, i) => (
                <div key={i} className="border border-violet-900/30 rounded-lg px-3 py-2">
                  <p className="text-zinc-100 font-mono text-xs">{c.name} · ${c.budgetUsd}/день{c.startLocal ? ` · старт ${c.startLocal.replace("T", " ")}` : ""}</p>
                  {c.adsets.map((a, k) => (
                    <p key={k} className="text-zinc-400 font-mono text-[11px] pl-3">↳ {a.name}: {a.ads.map((d) => d.name).join(", ")}</p>
                  ))}
                  <p className="text-zinc-600 text-[10px] pl-3 break-all">{c.landingUrl}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div data-tour="au-jobs" className={card}>
        <h2 className={h2}>Заливы</h2>
        {jobs.length === 0 ? <p className="text-sm text-zinc-500">Пока не было.</p> : (
          <div className="divide-y divide-violet-900/20">
            {jobs.map((j) => (
              <div key={j.id} className="py-2.5 flex flex-wrap items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-200">{new Date(j.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · {j.summary.campaigns} кампаний · {j.summary.ads} объявлений
                    <span className="text-zinc-500"> · создано {j.done.campaigns}/{j.summary.campaigns} кампаний, {j.done.ads}/{j.summary.ads} объявлений</span></p>
                  <p className="text-[11px] text-zinc-500 truncate">{j.names.slice(0, 3).join(", ")}{j.names.length > 3 ? ` +${j.names.length - 3}` : ""}</p>
                  {j.stage && <p className="text-[11px] text-zinc-400 mt-0.5">{j.stage}</p>}
                  {j.error && <p className="text-[11px] text-red-300 mt-0.5">{j.error}</p>}
                </div>
                <span className="text-[11px] px-2 py-1 rounded-full border border-violet-900/40 text-zinc-300 shrink-0">{STATUS[j.status] ?? j.status}</span>
                {["creating", "created", "failed"].includes(j.status) && j.done.campaigns > 0 && (
                  <button type="button" onClick={() => cancel(j.id)} className={`${small} border-red-900/40 text-red-300 shrink-0`}>Отменить и удалить</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
