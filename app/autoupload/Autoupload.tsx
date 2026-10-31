"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACTORS, CTAS, FUNNEL_LANDERS, GEOS, MARKERS, codeForGeo, type Plan, type PlanInput, type SharedAdset } from "@/lib/autoupload/plan";
import { childKey, expandSet, rowsFor, type ChildOverride, type SetForm } from "@/lib/autoupload/sets";
import { landingChoices } from "@/lib/autoupload/landings";
import type { Landing, LibraryItem } from "@/lib/autoupload/options";
import { mskDay } from "@/lib/day";
import LibraryPicker from "./LibraryPicker";
import UploadApp from "./UploadApp";
import CreativeUploadModal from "@/app/library/CreativeUploadModal";
import { DatePicker } from "@/components/DatePicker";
import { Icon } from "@/components/ui";

// Автозалив (Decision 081, 087) — форма один в один с Genesis Manager Артёма:
// 01 кабинеты и основа → общий набор адсетов с креативами → текст → 02 кампании
// (или сеты 1-1-1) со своими GEO, ссылкой, FP, бюджетом, бидкапом, временем старта на
// каждый кабинет и шаблонами имён → «Проверить сборку» → «Создать». Сборку и нейминг
// считает сервер (plan.ts), сеты раскрывает sets.ts — здесь только ввод и показ.

const CTA_LABEL: Record<string, string> = { LEARN_MORE: "Узнать больше", SIGN_UP: "Регистрация", MESSAGE_PAGE: "Написать нам" };
const card = "card p-5";
const h2 = "text-base font-semibold text-white mb-3";
const DRAFT = "autoupload.draft.v2";

interface Account { id: string; name: string; status: string; timezone?: string | null }
interface Options { accounts: Account[]; landings: Landing[]; creatives: LibraryItem[] }
type Details = { pixels: { id: string; name: string }[]; pages: { id: string; name: string }[] } | string;
interface JobView { id: string; status: string; stage: string | null; error: string | null; createdAt: string; summary: Plan["summary"]; names: string[]; done: { campaigns: number; ads: number } }
type Fields = Partial<Omit<SetForm, "key">>;

let seq = 0;
const newKey = () => `upload-${Date.now()}-${++seq}`;
const newCampaign = (): SetForm => ({ key: newKey(), geo: "ESP", actor: "ROMAN", funnel: "TG", marker: "NEW", lander: "TGR", landingUrl: "", pageId: "", budgetUsd: "", bidCapEnabled: false, bidCapUsd: "", startAtByAccount: {}, campaignName: "", adsetNames: [] });
const newAdset = (): SharedAdset => ({ id: newKey(), target: "BROAD", customAudienceId: "", label: "", creatives: [] });
const STATUS: Record<string, string> = { creating: "Заливается", created: "Готово", failed: "Ошибка", cancelling: "Удаляю", cancelled: "Отменено" };

interface Draft {
  accountIds: string[]; pixelId: string; pageId: string; date: string; campaignNumber: number; budget: string;
  oneToOne: boolean; paused: boolean; campaigns: SetForm[]; adsets: SharedAdset[]; omitted: string[];
  overrides: Record<string, ChildOverride>; text: PlanInput["text"];
}
const EMPTY: Draft = {
  accountIds: [], pixelId: "", pageId: "", date: mskDay(), campaignNumber: 1, budget: "20", oneToOne: false, paused: false,
  campaigns: [newCampaign()], adsets: [newAdset()], omitted: [], overrides: {}, text: { primaryText: "", headline: "", description: "", cta: "LEARN_MORE" },
};
function loadDraft(): Draft {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT) ?? "null") as Draft | null;
    return d?.campaigns?.length && d.adsets?.length ? { ...EMPTY, ...d, date: d.date < mskDay() ? mskDay() : d.date } : EMPTY;
  } catch { return EMPTY; }
}

export default function Autoupload() {
  const [opt, setOpt] = useState<Options | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState<Draft>(EMPTY);
  const [details, setDetails] = useState<Record<string, Details>>({});
  const [plan, setPlan] = useState<{ plan: Plan; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [drafts, setDrafts] = useState<{ id: string; name: string; form: Draft; updated_at: string }[]>([]);
  const loadDrafts = useCallback(() => fetch("/api/autoupload?op=drafts").then((r) => r.json()).then((d) => d.drafts && setDrafts(d.drafts)).catch(() => undefined), []);
  useEffect(() => { loadDrafts(); }, [loadDrafts]);
  const saveDraft = async () => {
    const name = window.prompt("Название сборки:", f.campaigns.map((c) => c.geo).join(" ") + " · " + f.date)?.trim();
    if (!name) return;
    const r = await fetch("/api/autoupload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "saveDraft", name, form: f }) });
    const d = await r.json().catch(() => ({}));
    setErr(d.error ?? null);
    loadDrafts();
  };
  const openDraft = (id: string) => {
    const d = drafts.find((x) => x.id === id);
    if (d) set({ ...EMPTY, ...d.form, date: d.form.date < mskDay() ? mskDay() : d.form.date });
  };
  const deleteDraft = async () => {
    const name = window.prompt(`Какую сборку удалить? Название:\n${drafts.map((d) => d.name).join("\n")}`)?.trim();
    const d = drafts.find((x) => x.name === name);
    if (!d) return;
    await fetch("/api/autoupload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "deleteDraft", id: d.id }) });
    loadDrafts();
  };
  const set = (patch: Partial<Draft>) => setF((d) => ({ ...d, ...patch }));

  const loadOptions = useCallback(() =>
    fetch("/api/autoupload?op=options").then((r) => r.json()).then((d) => (d.error ? setErr(d.error) : setOpt(d))).catch(() => setErr("Сеть не ответила")), []);
  useEffect(() => {
    setF(loadDraft()); // eslint-disable-line react-hooks/set-state-in-effect -- черновик есть только в браузере
    loadOptions();
  }, [loadOptions]);
  useEffect(() => { try { localStorage.setItem(DRAFT, JSON.stringify(f)); } catch { /* приватный режим */ } }, [f]);

  // Пиксели и страницы выбранных кабинетов (черновик мог принести их сразу).
  const asked = useRef(new Set<string>());
  useEffect(() => {
    for (const id of f.accountIds) {
      if (asked.current.has(id)) continue;
      asked.current.add(id);
      fetch(`/api/autoupload?op=account&id=${id}`).then((r) => r.json()).then((d) => setDetails((p) => ({ ...p, [id]: d.error ?? d })))
        .catch(() => setDetails((p) => ({ ...p, [id]: "Сеть не ответила" })));
    }
  }, [f.accountIds, details]);

  const loadJobs = useCallback(() => fetch("/api/autoupload?op=jobs").then((r) => r.json()).then((d) => d.jobs && setJobs(d.jobs)).catch(() => undefined), []);
  useEffect(() => { loadJobs(); }, [loadJobs]);
  useEffect(() => {
    if (!jobs.some((j) => j.status === "creating" || j.status === "cancelling")) return;
    const t = setInterval(loadJobs, 5000);
    return () => clearInterval(t);
  }, [jobs, loadJobs]);

  // Живые кабинеты: черновик не должен держать кабинет, который уже в бане.
  const alive = useMemo(() => new Set(opt?.accounts.map((a) => a.id) ?? []), [opt]);
  const accountIds = useMemo(() => f.accountIds.filter((id) => alive.has(id)), [f.accountIds, alive]);
  const selected = useMemo(() => opt?.accounts.filter((a) => accountIds.includes(a.id)) ?? [], [opt, accountIds]);
  // Общий пиксель — как у Артёма: только тот, что есть во всех выбранных кабинетах.
  const pixels = useMemo(() => {
    const lists = accountIds.map((id) => details[id]).filter((d): d is Exclude<Details, string> => typeof d === "object");
    if (!lists.length || lists.length < accountIds.length) return [];
    return lists[0].pixels.filter((p) => lists.every((l) => l.pixels.some((x) => x.id === p.id)));
  }, [accountIds, details]);
  const pages = useMemo(() => {
    const m = new Map<string, string>();
    for (const id of accountIds) { const d = details[id]; if (typeof d === "object") d.pages.forEach((p) => m.set(p.id, p.name)); }
    return [...m];
  }, [accountIds, details]);

  const landings = useMemo(() => opt?.landings ?? [], [opt]);
  const omitted = useMemo(() => new Set(f.omitted), [f.omitted]);
  const withLanding = useCallback((r: SetForm): SetForm => ({ ...r, landingUrl: r.landingUrl || landingChoices(landings, r.geo, r.actor)[0]?.url || "" }), [landings]);
  const input = useMemo((): PlanInput => ({
    accountIds, pixelId: f.pixelId, pageId: f.pageId, date: f.date, campaignNumber: f.campaignNumber, dailyBudgetUsd: f.budget,
    oneToOne: f.oneToOne, paused: f.paused, adsets: f.adsets, text: f.text,
    campaigns: rowsFor(f.oneToOne, f.campaigns, f.adsets, omitted, f.overrides).map(withLanding),
  }), [accountIds, f, omitted, withLanding]);
  const inputKey = JSON.stringify(input);
  const fresh = plan && plan.key === inputKey ? plan.plan : null;

  async function refreshAccounts() {
    setRefreshing(true);
    try {
      const d = await fetch("/api/autoupload?op=accounts").then((r) => r.json());
      if (d.error) throw new Error(d.error);
      setOpt((o) => (o ? { ...o, accounts: d.accounts } : o));
      setDetails({});
      asked.current.clear();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }
  const toggleAccount = (id: string) => set({ accountIds: accountIds.includes(id) ? accountIds.filter((x) => x !== id) : [...accountIds, id] });

  async function post(op: "preview" | "launch") {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/autoupload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op, input }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Не получилось");
      if (op === "preview") setPlan({ plan: d.plan, key: inputKey });
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

  const editAdset = (i: number, patch: Partial<SharedAdset>) => set({ adsets: f.adsets.map((a, k) => (k === i ? { ...a, ...patch } : a)) });
  const editCampaign = (i: number, patch: Fields) => set({ campaigns: f.campaigns.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
  const duplicate = (i: number) => {
    const src = f.campaigns[i], copy = { ...src, key: newKey() };
    // Правки кампаний сета едут в копию, убранные — тоже.
    const overrides = { ...f.overrides };
    const extra: string[] = [];
    for (const a of f.adsets) for (const c of a.creatives) {
      const from = childKey(src.key, a.id, c.key), to = childKey(copy.key, a.id, c.key);
      if (f.overrides[from]) overrides[to] = f.overrides[from];
      if (omitted.has(from)) extra.push(to);
    }
    set({ campaigns: [...f.campaigns.slice(0, i + 1), copy, ...f.campaigns.slice(i + 1)], overrides, omitted: [...f.omitted, ...extra] });
  };
  const remove = (i: number) => {
    const key = f.campaigns[i].key;
    set({ campaigns: f.campaigns.filter((_, k) => k !== i), omitted: f.omitted.filter((x) => !x.startsWith(`${key}::`)),
      overrides: Object.fromEntries(Object.entries(f.overrides).filter(([k]) => !k.startsWith(`${key}::`))) });
  };

  if (err && !opt) return <div className="max-w-5xl mx-auto p-4 md:p-8 text-red-300">{err}</div>;
  if (!opt) return <div className="max-w-5xl mx-auto p-4 md:p-8 text-hint">Загружаю…</div>;

  const creativesCount = f.adsets.reduce((s, a) => s + a.creatives.length, 0);
  const rows = input.campaigns;
  const checks: [string, boolean, string][] = [
    ["Кабинеты", accountIds.length > 0, "выбери хотя бы один живой кабинет"],
    ["Общий пиксель и Facebook Page", Boolean(f.pixelId && pixels.some((p) => p.id === f.pixelId) && (f.pageId || rows.every((r) => r.pageId))), "пиксель, общий для всех кабинетов, и FP"],
    ["Расписание по кабинетам", Boolean(f.date) && rows.every((r) => accountIds.every((a) => /^\d\d:\d\d$/.test(r.startAtByAccount?.[a] || "00:00"))), "дата и время старта ЧЧ:ММ"],
    ["Креативы", creativesCount > 0, "добавь креативы в адсеты"],
    ["Настройки кампаний", rows.length > 0 && rows.every((r) => r.geo && r.actor && r.funnel && r.marker && r.lander && (r.pageId || f.pageId) && Number(String(r.budgetUsd || f.budget).replace(",", ".")) > 0),
      f.oneToOne ? `${f.campaigns.length} сетов · ${rows.length} кампаний 1‑1‑1` : "заполни GEO, лицо, воронку, маркер, лендинг, FP и бюджет"],
    ["MVP-ссылки", rows.every((r) => r.landingUrl), "нет ссылки Torro под GEO и лицо"],
  ];
  const ready = checks.filter((c) => c[1]).length;

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        {/* min-w: на телефоне кнопки уходят строкой ниже, а не сжимают текст в столбик. */}
        <div className="flex-1 min-w-[16rem]">
          <h1 className="page-title">Автозалив</h1>
          <p className="text-sm text-hint mt-1">Кампании, адсеты и объявления в Meta по неймингу команды. Креативы — только те, что ты сам загрузил в Медиатеку, в Meta уходит исходник без сжатия. Форма сохраняется черновиком в этом браузере.</p>
        </div>
        {/* Сохранённые сборки (Decision 092) — на сервере: открыть с любого устройства. */}
        <div className="flex flex-wrap gap-2 items-center">
          <button type="button" onClick={saveDraft} className={`btn border-violet-700/50 text-violet-200`}><Icon name="save" />Сохранить сборку</button>
          <select value="" onChange={(e) => openDraft(e.target.value)} onFocus={loadDrafts} className="field">
            <option value="">Сохранённые сборки{drafts.length ? ` · ${drafts.length}` : ""}</option>
            {drafts.map((d) => <option key={d.id} value={d.id}>{d.name} · {new Date(d.updated_at).toLocaleDateString("ru-RU")}</option>)}
          </select>
          {drafts.length > 0 && <button type="button" title="Удалить сборку" onClick={deleteDraft} className={`btn border-red-900/40 text-red-300`}>✕</button>}
        </div>
      </div>

      <UploadApp />

      <div data-tour="au-base" className={card}>
        <div className="flex items-center gap-2 mb-3">
          <h2 className={`${h2} mb-0`}>01 · Кабинеты и основа</h2>
          <button type="button" disabled={refreshing} onClick={refreshAccounts} className={`btn border-violet-700/50 text-violet-200 ml-auto`}>
            {refreshing ? "Обновляю…" : "↻ Обновить кабинеты"}
          </button>
        </div>
        {opt.accounts.length === 0 ? (
          <p className="text-sm text-zinc-400 mb-4">Живых кабинетов нет. Здесь только ACTIVE без ограничений — бан, unsettled и пропавшие не показываются. Ключ Meta — в Настройках → Интеграции.</p>
        ) : (
          <div className="grid sm:grid-cols-3 gap-2 mb-4">
            {opt.accounts.map((a) => (
              <label key={a.id} className={`flex items-center gap-2 border rounded-xl px-3 py-2 text-sm text-zinc-200 cursor-pointer ${accountIds.includes(a.id) ? "border-violet-600/60 bg-violet-900/10" : "border-line"}`}>
                <input type="checkbox" checked={accountIds.includes(a.id)} onChange={() => toggleAccount(a.id)} className="accent-violet-500" />
                <span className="truncate">{a.name}</span>
                {typeof details[a.id] === "string" && <span className="ml-auto text-[10px] text-red-300 truncate" title={details[a.id] as string}>ошибка</span>}
              </label>
            ))}
          </div>
        )}
        <div className="grid sm:grid-cols-3 gap-2">
          <select value={f.pixelId} onChange={(e) => set({ pixelId: e.target.value })} className="field">
            <option value="">{accountIds.length ? (pixels.length ? "Общий пиксель" : "Нет общего пикселя у кабинетов") : "Сначала кабинеты"}</option>
            {pixels.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.id}</option>)}
          </select>
          <select value={f.pageId} onChange={(e) => set({ pageId: e.target.value })} className="field">
            <option value="">Facebook Page по умолчанию</option>
            {pages.map(([id, name]) => <option key={id} value={id}>{name} · {id}</option>)}
          </select>
          <label className="flex items-center gap-2 text-xs text-hint">Дата <DatePicker value={f.date} min={mskDay()} onChange={(date) => set({ date })} /></label>
          <label className="flex items-center gap-2 text-xs text-hint">Нумерация с <input type="number" min={1} value={f.campaignNumber} onChange={(e) => set({ campaignNumber: Number(e.target.value) })} className={`field w-24`} /></label>
          <label className="flex items-center gap-2 text-xs text-hint">Бюджет по умолчанию, $ <input inputMode="decimal" value={f.budget} onChange={(e) => set({ budget: e.target.value })} className={`field w-24`} /></label>
          <div className="flex items-center gap-4 text-sm text-zinc-300">
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.oneToOne} onChange={(e) => set({ oneToOne: e.target.checked })} className="accent-violet-500" />1‑1‑1</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.paused} onChange={(e) => set({ paused: e.target.checked })} className="accent-violet-500" />на паузе</label>
          </div>
        </div>
        <p className="text-[11px] text-hint mt-2">Каждая кампания создаётся в каждом выбранном кабинете. 1‑1‑1 — вместо кампаний сеты: по кампании на каждый креатив с одним адсетом, лишние убираются в сете. Без «на паузе» всё создаётся ACTIVE и сразу крутится.</p>
      </div>

      <div data-tour="au-adsets" className={card}>
        <div className="flex items-center gap-2 mb-3">
          <h2 className={`${h2} mb-0`}>Креативы · общий набор</h2>
          <button type="button" onClick={() => setUploading(true)} className={`btn border-violet-700/50 text-violet-200 ml-auto`}><Icon name="upload" />Загрузить новые в Медиатеку</button>
        </div>
        <div className="space-y-3">
          {f.adsets.map((a, i) => (
            <div key={a.id} className="border border-line rounded-xl p-3">
              <div className="flex flex-wrap gap-2 items-center mb-2">
                <span className="text-xs text-hint">Общий адсет {i + 1} · клонируется в кампании</span>
                <select value={a.target} onChange={(e) => editAdset(i, { target: e.target.value })} className="field"><option>BROAD</option><option>INT</option><option>RETARGET</option></select>
                {a.target === "RETARGET" && <input placeholder="ID Custom Audience" value={a.customAudienceId ?? ""} onChange={(e) => editAdset(i, { customAudienceId: e.target.value.trim() })} className="field" />}
                <input placeholder="Метка (TEST1)" value={a.label ?? ""} onChange={(e) => editAdset(i, { label: e.target.value })} className={`field w-36`} />
                <button type="button" onClick={() => set({ adsets: f.adsets.filter((_, k) => k !== i) })} disabled={f.adsets.length === 1} className={`btn border-red-900/40 text-red-300 ml-auto`}>Убрать</button>
              </div>
              {a.creatives.length > 0 && (
                <div className="space-y-1 mb-2">
                  {a.creatives.map((c, ci) => (
                    <div key={`${c.key}-${ci}`} className="flex items-center gap-2">
                      <input value={c.code} onChange={(e) => editAdset(i, { creatives: a.creatives.map((x, k) => (k === ci ? { ...x, code: e.target.value } : x)) })}
                             className={`field flex-1 py-1 text-xs font-mono`} title="Код креатива — имя объявления" />
                      {/* ＋ — то же объявление ещё раз (как у Артёма). В 1‑1‑1 нельзя: кампания сета — по креативу. */}
                      {!f.oneToOne && <button type="button" title="Ещё одно такое же объявление" onClick={() => editAdset(i, { creatives: [...a.creatives.slice(0, ci + 1), { ...c }, ...a.creatives.slice(ci + 1)] })} className={`btn border-line text-zinc-300 py-1`}>＋</button>}
                      <button type="button" onClick={() => editAdset(i, { creatives: a.creatives.filter((_, k) => k !== ci) })} className={`btn border-red-900/40 text-red-300 py-1`}>−</button>
                    </div>
                  ))}
                </div>
              )}
              <button type="button" onClick={() => setPickerFor(i)} className={`btn border-violet-700/50 text-violet-200`}>▦ Креативы из медиатеки</button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => set({ adsets: [...f.adsets, newAdset()] })} className={`btn border-violet-700/50 text-violet-200 mt-3`}>＋ Адсет</button>
        <p className="text-[11px] text-hint mt-2">Набор уходит в каждую кампанию; у имён по неймингу хвост гео пересоберётся под страну кампании, старые имена уйдут как есть.</p>
      </div>

      <div className={card}>
        <h2 className={h2}>Текст</h2>
        <div className="grid sm:grid-cols-2 gap-2">
          <input placeholder="Заголовок" value={f.text.headline} onChange={(e) => set({ text: { ...f.text, headline: e.target.value } })} className="field" />
          <select value={f.text.cta} onChange={(e) => set({ text: { ...f.text, cta: e.target.value } })} className="field">{CTAS.map((v) => <option key={v} value={v}>{CTA_LABEL[v] ?? v}</option>)}</select>
          <textarea placeholder="Основной текст" value={f.text.primaryText} onChange={(e) => set({ text: { ...f.text, primaryText: e.target.value } })} className={`field sm:col-span-2 min-h-20`} />
          <input placeholder="Описание" value={f.text.description} onChange={(e) => set({ text: { ...f.text, description: e.target.value } })} className={`field sm:col-span-2`} />
        </div>
      </div>

      <div data-tour="au-campaigns" className={card}>
        <h2 className={h2}>02 · {f.oneToOne ? "Сеты 1‑1‑1" : "Кампании"}</h2>
        <div className="space-y-3">
          {f.campaigns.map((c, i) => {
            const children = f.oneToOne ? expandSet(c, i + 1, f.adsets, omitted, f.overrides) : [];
            const total = f.adsets.reduce((s, a) => s + a.creatives.length, 0);
            return (
              <div key={c.key} className="border border-line rounded-xl p-3">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <b className="text-sm text-zinc-100">
                    {f.oneToOne ? `СЕТ ${i + 1} · ${c.geo} · ${children.length} креативов → ${children.length * Math.max(1, accountIds.length)} кампаний` : `Кампания ${i + 1} · ${c.geo} · ${c.actor}`}
                  </b>
                  <button type="button" onClick={() => duplicate(i)} className={`btn border-violet-700/50 text-violet-200 ml-auto`}>{f.oneToOne ? "Дублировать весь сет" : "Дублировать"}</button>
                  <button type="button" onClick={() => remove(i)} disabled={f.campaigns.length === 1} className={`btn border-red-900/40 text-red-300`}>{f.oneToOne ? "Удалить сет" : "Удалить"}</button>
                </div>
                <CampaignFields value={c} onChange={(p) => editCampaign(i, p)} accounts={selected} adsets={f.adsets} landings={landings} pages={pages} oneToOne={f.oneToOne} />
                {!f.oneToOne && (
                  <div className="mt-2 text-[11px] text-hint space-y-0.5">
                    {f.adsets.map((a, ai) => <p key={a.id}>Адсет {ai + 1}: <span className="font-mono text-zinc-400">{a.creatives.map((x) => safeCode(x.code, c.geo)).join(", ") || "—"}</span></p>)}
                  </div>
                )}
                {f.oneToOne && (
                  <details className="mt-3">
                    <summary className="text-sm text-violet-200 cursor-pointer">Кампании сета ({children.length}{total > children.length ? ` из ${total}` : ""}) — раскрыть, поправить, убрать лишние</summary>
                    <div className="mt-2 space-y-1.5">
                      {children.map((ch) => (
                        <details key={ch.key} className="border border-line rounded-lg px-3 py-2">
                          <summary className="text-xs text-zinc-300 cursor-pointer flex items-center gap-2">
                            <span className="font-mono">{safeCode(ch.code, ch.row.geo)}</span>
                            <span className="text-hint">адсет {ch.adsetIndex + 1}</span>
                            {ch.overridden && <span className="text-amber-400">свои настройки</span>}
                            <button type="button" onClick={(e) => { e.preventDefault(); set({ omitted: [...f.omitted, ch.key] }); }} className="ml-auto text-red-300 hover:text-red-200">Убрать из сета</button>
                          </summary>
                          <p className="text-[11px] text-hint mt-2 mb-1">Индивидуальные настройки этой кампании — остальное берётся у сета.</p>
                          <CampaignFields value={ch.row} accounts={selected} adsets={[f.adsets[ch.adsetIndex]]} landings={landings} pages={pages} oneToOne
                            onChange={(p) => {
                              const { adsetNames, ...rest } = p;
                              const prev = f.overrides[ch.key] ?? {};
                              set({ overrides: { ...f.overrides, [ch.key]: { ...prev, ...rest, ...(adsetNames ? { adsetName: adsetNames[0] } : {}) } } });
                            }} />
                          {ch.overridden && (
                            <button type="button" onClick={() => { const o = { ...f.overrides }; delete o[ch.key]; set({ overrides: o }); }} className="text-[11px] text-violet-300 mt-1">Сбросить к настройкам сета</button>
                          )}
                        </details>
                      ))}
                      {total > children.length && (
                        <button type="button" onClick={() => set({ omitted: f.omitted.filter((x) => !x.startsWith(`${c.key}::`)) })} className="text-xs text-violet-300">Вернуть убранные ({total - children.length})</button>
                      )}
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </div>
        <button type="button" onClick={() => set({ campaigns: [...f.campaigns, newCampaign()] })} className={`btn border-violet-700/50 text-violet-200 mt-3`}>{f.oneToOne ? "＋ Новый сет" : "＋ Кампания"}</button>
        <p className="text-[11px] text-hint mt-2">Имя по умолчанию: CAB####_ДД.ММ_ВОРОНКА_МАРКЕР_GEO_ЛЕНДИНГ_ЛИЦО_N. Свой шаблон — токены {"{{CAB}} {{DATE}} {{GEO}} {{FACE}} {{FUNNEL}} {{MARKER}} {{LANDER}} {{N}} {{SET}} {{CREATIVE}} {{ADSET_N}}"}. N растёт у повторов одного GEO. К ссылке допишется трекинг: твой id Torro, пиксель и макросы.</p>
      </div>

      <div data-tour="au-check" className={card}>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 mb-4">
          <p className="sm:col-span-2 text-sm text-zinc-300">{ready === checks.length ? "Готово к проверке" : "Пока не готово"} · {ready} из {checks.length}</p>
          {checks.map(([name, ok, hint]) => (
            <p key={name} className={`text-xs ${ok ? "text-green-400" : "text-hint"}`}>{ok ? "✓" : "·"} {name}{ok && name !== "Настройки кампаний" ? "" : ` — ${hint}`}</p>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <button type="button" disabled={busy} onClick={() => post("preview")} className={`btn border-violet-700/50 text-violet-200 py-2.5`}>Проверить сборку</button>
          <button type="button" disabled={busy || !fresh} onClick={() => { if (window.confirm(`Создать ${fresh!.summary.campaigns} кампаний, ${fresh!.summary.adsets} адсетов и ${fresh!.summary.ads} объявлений${f.paused ? " на паузе" : " и сразу запустить"}?`)) post("launch"); }} className="btn btn-primary">
            {f.paused ? "Создать на паузе" : "Создать и запустить"}
          </button>
          {busy && <span className="text-xs text-hint">Секунду…</span>}
          {plan && !fresh && <span className="text-xs text-amber-400">Параметры изменены — проверь сборку заново</span>}
        </div>
        {err && <div className="mt-3 rounded-xl px-4 py-3 text-sm border bg-red-950/40 border-red-700/30 text-red-300">{err}</div>}
        {fresh && (
          <div className="mt-3 text-sm">
            <p className="text-zinc-300 mb-2">
              Сборка в порядке: {fresh.summary.campaigns} кампаний{fresh.summary.sets ? ` в ${fresh.summary.sets} сетах` : ""} · {fresh.summary.adsets} адсетов · {fresh.summary.ads} объявлений · кабинетов {fresh.summary.accounts}
              · бюджет кампании (CBO) · bid cap: {fresh.summary.bidCaps} из {fresh.summary.campaigns} · {f.paused ? "PAUSED" : "ACTIVE"} · Multi-advertiser выключен
            </p>
            <div className="max-h-80 overflow-y-auto space-y-2">
              {fresh.campaigns.map((c, i) => (
                <div key={i} className="border border-line rounded-lg px-3 py-2">
                  <p className="text-zinc-100 font-mono text-xs">{c.name} · ${c.budgetUsd}/день{c.bidCapUsd !== null ? ` · bid cap $${c.bidCapUsd}` : ""} · старт {c.startLocal.replace("T", " ")}</p>
                  {c.adsets.map((a, k) => (
                    <p key={k} className="text-zinc-400 font-mono text-[11px] pl-3">↳ {a.name}: {a.ads.map((d) => d.name).join(", ")}</p>
                  ))}
                  <p className="text-hint text-[10px] pl-3 break-all">{c.landingUrl}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div data-tour="au-jobs" className={card}>
        <h2 className={h2}>Заливы</h2>
        {jobs.length === 0 ? <p className="text-sm text-hint">Пока не было.</p> : (
          <div className="divide-y divide-line">
            {jobs.map((j) => (
              <div key={j.id} className="py-2.5 flex flex-wrap items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-200">{new Date(j.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · {j.summary.campaigns} кампаний · {j.summary.ads} объявлений
                    <span className="text-hint"> · создано {j.done.campaigns}/{j.summary.campaigns} кампаний, {j.done.ads}/{j.summary.ads} объявлений</span></p>
                  <p className="text-[11px] text-hint truncate">{j.names.slice(0, 3).join(", ")}{j.names.length > 3 ? ` +${j.names.length - 3}` : ""}</p>
                  {j.stage && <p className="text-[11px] text-zinc-400 mt-0.5">{j.stage}</p>}
                  {j.error && <p className="text-[11px] text-red-300 mt-0.5">{j.error}</p>}
                </div>
                <span className="text-[11px] px-2 py-1 rounded-full border border-line text-zinc-300 shrink-0">{STATUS[j.status] ?? j.status}</span>
                {["creating", "created", "failed"].includes(j.status) && j.done.campaigns > 0 && (
                  <button type="button" onClick={() => cancel(j.id)} className={`btn border-red-900/40 text-red-300 shrink-0`}>Отменить и удалить</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {pickerFor !== null && f.adsets[pickerFor] && (
        <LibraryPicker items={opt.creatives} added={new Set(f.adsets[pickerFor].creatives.map((c) => c.key))} onClose={() => setPickerFor(null)}
                       defaultFace={f.campaigns[0]?.actor === "RICKY" ? "RICKY" : "ROMAN"}
                       onFace={(key, face) => setOpt((o) => (o ? { ...o, creatives: o.creatives.map((c) => (c.key === key ? { ...c, face } : c)) } : o))}
                       onRename={(key, newKey, code) => {
                         setOpt((o) => (o ? { ...o, creatives: o.creatives.map((c) => (c.key === key ? { ...c, key: newKey, code } : c)) } : o));
                         set({ adsets: f.adsets.map((a) => ({ ...a, creatives: a.creatives.map((c) => (c.key === key ? { ...c, key: newKey, code } : c)) })) });
                       }}
                       onDelete={(key) => {
                         setOpt((o) => (o ? { ...o, creatives: o.creatives.filter((c) => c.key !== key) } : o));
                         set({ adsets: f.adsets.map((a) => ({ ...a, creatives: a.creatives.filter((c) => c.key !== key) })) });
                       }}
                       onAdd={(picked) => { editAdset(pickerFor, { creatives: [...f.adsets[pickerFor].creatives, ...picked.map(({ key, code, kind }) => ({ key, code, kind }))] }); setPickerFor(null); }} />
      )}
      {uploading && <CreativeUploadModal onClose={() => setUploading(false)} onUploaded={() => { loadOptions(); }} />}
    </div>
  );
}

const safeCode = (code: string, geo: string) => { try { return codeForGeo(code, geo); } catch { return code; } };

// Поля кампании — одни и те же у обычной кампании, сета и кампании внутри сета.
function CampaignFields({ value: c, onChange, accounts, adsets, landings, pages, oneToOne }: {
  value: Fields; onChange: (p: Fields) => void; accounts: Account[]; adsets: SharedAdset[];
  landings: Landing[]; pages: [string, string][]; oneToOne: boolean;
}) {
  const choices = landingChoices(landings, c.geo ?? "", c.actor ?? "");
  const lander = FUNNEL_LANDERS[c.funnel ?? "TG"] ?? [];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <select value={c.geo} onChange={(e) => onChange({ geo: e.target.value, landingUrl: "" })} className="field">{GEOS.map((g) => <option key={g}>{g}</option>)}</select>
        <select value={c.actor} onChange={(e) => onChange({ actor: e.target.value, landingUrl: "" })} className="field">{ACTORS.map((a) => <option key={a}>{a}</option>)}</select>
        <select value={c.funnel} onChange={(e) => onChange({ funnel: e.target.value, lander: FUNNEL_LANDERS[e.target.value][0] })} className="field"><option>TG</option><option>WA</option></select>
        <select value={c.marker} onChange={(e) => onChange({ marker: e.target.value })} className="field">{MARKERS.map((m) => <option key={m}>{m}</option>)}</select>
        <select value={c.lander} onChange={(e) => onChange({ lander: e.target.value })} className="field">{lander.map((l) => <option key={l}>{l}</option>)}</select>
        <select value={c.landingUrl || choices[0]?.url || ""} onChange={(e) => onChange({ landingUrl: e.target.value })} className="field" title="Последние пять ссылок Torro под GEO и лицо">
          {choices.length === 0 && <option value="">Нет ссылки MVP</option>}
          {choices.map((l) => <option key={l.id} value={l.url}>{l.name}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-center">
        <select value={c.pageId ?? ""} onChange={(e) => onChange({ pageId: e.target.value })} className="field">
          <option value="">FP по умолчанию</option>
          {pages.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <input inputMode="decimal" placeholder="Бюджет $ (по умолч.)" value={String(c.budgetUsd ?? "")} onChange={(e) => onChange({ budgetUsd: e.target.value })} className="field" />
        <label className="flex items-center gap-2 text-sm text-zinc-300"><input type="checkbox" checked={Boolean(c.bidCapEnabled)} onChange={(e) => onChange({ bidCapEnabled: e.target.checked })} className="accent-violet-500" />Bid cap</label>
        <input inputMode="decimal" placeholder="Bid cap, $" disabled={!c.bidCapEnabled} value={String(c.bidCapUsd ?? "")} onChange={(e) => onChange({ bidCapUsd: e.target.value })} className={`field disabled:opacity-40`} />
      </div>
      {accounts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {accounts.map((a) => (
            <label key={a.id} className="flex items-center gap-1.5 text-[11px] text-hint">
              Старт {a.name.slice(0, 18)}{a.timezone ? ` (${a.timezone})` : ""}
              <input type="time" value={c.startAtByAccount?.[a.id] ?? "00:00"} onChange={(e) => onChange({ startAtByAccount: { ...c.startAtByAccount, [a.id]: e.target.value } })} className={`field py-1`} />
            </label>
          ))}
          <span className="text-[11px] text-hint self-center">— время кабинета</span>
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-2">
        <input placeholder={oneToOne ? "Шаблон названий кампаний (необязательно)" : "Своё имя кампании (необязательно)"} value={c.campaignName ?? ""} onChange={(e) => onChange({ campaignName: e.target.value })} className={`field font-mono text-xs`} />
        {adsets.map((a, ai) => (
          <input key={a.id} placeholder={`Имя адсета ${adsets.length > 1 ? ai + 1 : ""}: {{GEO}}_${a.target}_{{ADSET_N}}`} value={c.adsetNames?.[ai] ?? ""}
                 onChange={(e) => { const names = [...(c.adsetNames ?? [])]; names[ai] = e.target.value; onChange({ adsetNames: names }); }} className={`field font-mono text-xs`} />
        ))}
      </div>
    </div>
  );
}
