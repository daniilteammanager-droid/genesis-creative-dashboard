"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { chip, seg } from "@/components/ui";
import { DateRange } from "@/components/DatePicker";
import { useProfile } from "@/components/Shell";
import { mskDay } from "@/lib/day";
import type { Topup } from "@/lib/topups/requests";
import { filterTopups, stage, STAGES, type Stage, type TopupFilter } from "@/lib/topups/view";
import { DEFAULT, targetsOf, type Category, type Template } from "@/lib/topups/config";
import { inRange, MAIN, PERIODS, totalsOf, type Range } from "@/lib/topups/analytics";
import OpenTopup, { BADGE, LABEL, money, stamp, type Op } from "./OpenTopup";
import TopupForm from "./TopupForm";
import TopupAnalytics from "./TopupAnalytics";
import TopupSettings from "./TopupSettings";

// Заявки на пополнение (Decision 072): форма и список. Заявка уходит Top-Up ботом в платёжный чат, статус и хэш
// возвращаются сюда. Владелец работает с открытыми заявками прямо здесь — те же кнопки, что в чате (Decision 126).
// Вкладки (Decision 131): «Заявки», «Аналитика», «Настройки» — последняя только владельцу.

const card = "card p-5 sm:p-6";
const NO_FILTER: TopupFilter = { q: "", stages: [], authors: [], kinds: [], targets: [] };
const ALL: Range = { since: "", until: "" };
const flip = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");

// Что с заявкой сейчас — словами, со временем и тем, кто закрыл.
function detail(r: Topup): string {
  const by = r.closed_by ? ` · ${r.closed_by}` : "";
  if (r.status === "paid") return `Оплачено ${r.paid_at ? stamp(r.paid_at) : ""}${by || " · перевод найден сам"}${r.paid_amount ? ` · пришло ${money(r.paid_amount)} ${r.asset}` : ""}`;
  if (r.status === "rejected") return `Отклонено${by}`;
  if (r.status === "expired") return `Время на оплату вышло${r.expires_at ? ` ${stamp(r.expires_at)}` : ""}`;
  if (r.searching_since) return `Отмечено оплаченным ${stamp(r.searching_since)}${by} — ищем перевод в блокчейне`;
  if (r.taken_by) return `В работе · ${r.taken_by}${r.taken_at ? ` с ${stamp(r.taken_at)}` : ""} — платит, остальные не трогают`;
  return r.expires_at ? `Ждёт оплаты до ${stamp(r.expires_at)}` : "Ждёт оплаты, без срока";
}
const source = (r: Topup) => (r.wallet ? ` · кошелёк «${r.wallet}»` : r.manual_address ? " · адрес вручную" : "");

interface View {
  admin: boolean; me?: string; meId?: string; chat: { title: string | null } | null; topups: Topup[];
  categories?: Category[]; templates?: Template[];
}
type Tab = "list" | "analytics" | "settings";
// Что сказать после своего нажатия: чат меняется тем же вызовом.
const DONE: Record<Op, string> = {
  take: "Заявка твоя — в чате уже «Платит …», остальные не переведут.", release: "Снова ждёт оплаты — и здесь, и в чате.",
  paid: "Ищем перевод в блокчейне — в чате тоже «ищу перевод».", reject: "Отклонена. В чате кнопки ушли.", hash: "Закрыта хэшем.",
};

// Ряд чипов фильтра с подписью слева.
function Chips({ label, items, on, toggle }: { label: string; items: { key: string; label: string }[]; on: string[]; toggle: (k: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="label w-20 shrink-0">{label}</span>
      {items.map((i) => <button key={i.key} type="button" {...chip(on.includes(i.key))} onClick={() => toggle(i.key)}>{i.label}</button>)}
    </div>
  );
}

export default function Topups({ pairs, networks }: { pairs: Record<string, string[]>; networks: Record<string, string> }) {
  const [view, setView] = useState<View | null>(null);
  const [tab, setTab] = useState<Tab>("list");
  const [f, setF] = useState<TopupFilter>(NO_FILTER);
  const [range, setRange] = useState<Range>(ALL);
  const [acting, setActing] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [bindMsg, setBindMsg] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const say = (text: string) => {
    clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  };
  const owner = useProfile()?.role === "main";

  const load = () => fetch("/api/topups").then((r) => r.json()).then((d) => d.topups && setView(d)).catch(() => undefined);
  useEffect(() => {
    load();
    // Статус меняется в боте и сам (автопоиск) — подтягиваем, пока вкладка на виду, и сразу при возврате на неё.
    // Владельцу чаще: он платит. Скрытая вкладка не ходит — CPU на Vercel деньги.
    const tick = () => { if (document.visibilityState === "visible") load(); };
    const t = setInterval(tick, owner ? 15_000 : 30_000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", tick); };
  }, [owner]);

  // Действие владельца с заявкой — POST с op, сервер проверяет роль и состояние заявки.
  async function act(id: string, op: Op, hash?: string) {
    setActing(id);
    try {
      const res = await fetch("/api/topups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op, id, hash }) });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.topups) throw new Error(d?.error ?? "Не получилось — попробуй ещё раз");
      setView(d);
      const r = (d.topups as Topup[]).find((x) => x.id === id);
      say(d.note ?? (op === "paid" && r?.status === "paid" ? `Перевод найден — #${r.number} оплачена.` : DONE[op]));
    } catch (e) {
      say(e instanceof Error ? e.message : "Сеть не ответила");
      load();
    } finally {
      setActing(null);
    }
  }

  async function bind() {
    const d = await fetch("/api/topups?bind=1").then((r) => r.json()).catch(() => null);
    if (d?.link) window.open(d.link, "_blank");
    else setBindMsg(d?.error ?? "Не получилось взять ссылку");
  }

  const categories = view?.categories ?? DEFAULT;
  const all = useMemo(() => view?.topups ?? [], [view]);
  const open = useMemo(() => all.filter((r) => r.status === "pending"), [all]);
  const own = useMemo(() => all.filter((r) => r.user_id === view?.meId), [all, view?.meId]);
  // Новая заявка, пока страница открыта, — строкой внизу, чтобы не проглядеть.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!view?.admin) return;
    const fresh = seen.current ? open.filter((r) => !seen.current!.has(r.id)) : [];
    if (fresh.length) say(fresh.map((r) => `Новая заявка #${r.number} · ${r.author} · ${money(r.amount)} ${r.asset}`).join("\n"));
    seen.current = new Set(open.map((r) => r.id));
    window.dispatchEvent(new CustomEvent("topups:open", { detail: open.length }));   // счётчик в панели (Shell)
  }, [open, view?.admin]);
  const rows = useMemo(() => filterTopups(inRange(all, range), f), [all, range, f]);
  const t = useMemo(() => totalsOf(rows), [rows]);
  const authors = useMemo(() => [...new Set(all.map((r) => r.author ?? "—"))].sort().map((a) => ({ key: a, label: a })), [all]);
  const targets = f.kinds.flatMap((k) => targetsOf(categories, k).map((x) => ({ key: x, label: x })));
  const filtered = f.q.trim() !== "" || f.stages.length + f.authors.length + f.kinds.length + f.targets.length > 0 || Boolean(range.since);
  const toggleKind = (k: string) => setF((p) => {
    const kinds = flip(p.kinds, k);
    return { ...p, kinds, targets: p.targets.filter((x) => kinds.some((y) => targetsOf(categories, y).includes(x))) };
  });
  const first = useMemo(() => all.map((r) => mskDay(new Date(r.created_at))).sort()[0] ?? mskDay(), [all]);
  const other = Object.entries(t.other).map(([a, v]) => `${money(v)} ${a}`).join(" · ");

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-5">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="page-title">Пополнения</h1>
        <div className="seg" role="tablist" aria-label="Раздел пополнений">
          <button type="button" {...seg(tab === "list")} onClick={() => setTab("list")}>Заявки</button>
          <button type="button" {...seg(tab === "analytics")} onClick={() => setTab("analytics")}>Аналитика</button>
          {view?.admin && <button type="button" {...seg(tab === "settings")} onClick={() => setTab("settings")}>Настройки</button>}
        </div>
      </div>

      {tab === "analytics" && view && <TopupAnalytics rows={all} admin={view.admin} />}
      {tab === "settings" && view?.admin && (
        <TopupSettings categories={categories} rows={all} onSaved={(c) => setView((v) => (v ? { ...v, categories: c } : v))} />
      )}

      {tab === "list" && (
        <>
          {view?.admin && (
            <div className={`${card} flex items-center gap-3 flex-wrap`}>
              <p className="text-sm text-zinc-300 flex-1 min-w-[200px]">
                {view.chat ? <>Платёжный чат: <b>{view.chat.title ?? "без названия"}</b></> : "Платёжный чат не привязан — заявки некуда отправлять."}
              </p>
              {bindMsg && <p className="text-xs text-red-300">{bindMsg}</p>}
              <button type="button" onClick={bind} className="btn btn-sm border-violet-700/50 text-violet-200 hover:bg-violet-900/20">
                {view.chat ? "Привязать другой чат" : "Привязать чат"}
              </button>
            </div>
          )}

          {view?.admin && (
            <section className={card} aria-label="Открытые заявки">
              <h2 className="text-base font-semibold">Открытые заявки · {open.length}</h2>
              <p className="text-xs text-hint mt-1">
                То же, что в платёжном чате: нажал здесь — сообщение в чате поменялось, нажали в чате — видно здесь. Переводы ищутся
                сами каждую минуту: пришла на адрес точная сумма — заявка закроется без «Оплачено».
              </p>
              <div className="space-y-3 mt-4">
                {open.length === 0 ? <p className="text-sm text-hint">Открытых заявок нет.</p>
                  : open.map((r) => <OpenTopup key={r.id} r={r} me={view.me ?? ""} busy={acting === r.id} onAct={(op, hash) => act(r.id, op, hash)} />)}
              </div>
            </section>
          )}

          <TopupForm categories={categories} pairs={pairs} networks={networks} templates={view?.templates ?? []} own={own}
                     onCreated={(d) => setView(d as View)} onTemplates={(tp) => setView((v) => (v ? { ...v, templates: tp } : v))} />

          <div data-tour="topups-list" className={card}>
            <div className="space-y-2.5 mb-3">
              <div className="flex flex-wrap items-center gap-2">
                <DateRange since={range.since || first} until={range.until || mskDay()} onChange={(since, until) => setRange({ since, until })}
                           active={!PERIODS.some((p) => { const r = p.range(); return r.since === range.since && r.until === range.until; })} />
                <div className="seg">
                  {PERIODS.map((p) => {
                    const r = p.range();
                    return <button key={p.key} type="button" onClick={() => setRange(r)} {...seg(range.since === r.since && range.until === r.until)}>{p.label}</button>;
                  })}
                </div>
              </div>
              <input type="search" value={f.q} onChange={(e) => { const q = e.target.value; setF((p) => ({ ...p, q })); }} className="field w-full"
                     placeholder="Поиск: номер, сумма, адрес, хэш, комментарий, кто создал" aria-label="Поиск заявок" />
              <Chips label="Статус" items={STAGES} on={f.stages} toggle={(k) => setF((p) => ({ ...p, stages: flip(p.stages, k as Stage) }))} />
              {view?.admin && authors.length > 1 && (
                <Chips label="Баер" items={authors} on={f.authors} toggle={(k) => setF((p) => ({ ...p, authors: flip(p.authors, k) }))} />
              )}
              <Chips label="Категория" items={categories.map((c) => ({ key: c.name, label: c.name }))} on={f.kinds} toggle={toggleKind} />
              {targets.length > 0 && <Chips label="Куда" items={targets} on={f.targets} toggle={(k) => setF((p) => ({ ...p, targets: flip(p.targets, k) }))} />}
              <div className="flex items-center gap-3 flex-wrap text-xs">
                {filtered && <span className="text-hint">Найдено: {rows.length} из {all.length}</span>}
                {filtered && <button type="button" onClick={() => { setF(NO_FILTER); setRange(ALL); }} className="btn btn-sm">Сбросить</button>}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl border border-line bg-raised p-3.5 mb-1">
              <div className="min-w-0"><p className="label">Ушло</p><p className="text-xl font-semibold tabular-nums mt-1">{fmt(t.sent)} <span className="text-sm font-medium text-hint">{MAIN}</span></p></div>
              <div className="min-w-0"><p className="label">Оплачено заявок</p><p className="text-xl font-semibold tabular-nums mt-1">{t.paid}</p></div>
              <div className="min-w-0"><p className="label">Комиссии, справкой</p><p className="text-xl font-semibold tabular-nums mt-1">{fmt(t.fee)} <span className="text-sm font-medium text-hint">{MAIN}</span></p></div>
              <div className="min-w-0"><p className="label">Ждут оплаты</p><p className="text-xl font-semibold tabular-nums mt-1">{t.waiting}{t.waitingSum > 0 && <span className="text-sm font-medium text-hint"> · {fmt(t.waitingSum)} {MAIN}</span>}</p></div>
            </div>
            <p className="text-[11px] text-hint mb-2">
              Ушло — сколько пришло на адрес по блокчейну, а не сумма заявки. Период — по дню создания заявки, по Москве. Учтены поиск и фильтры выше.
              {other && ` Другие монеты: ${other}.`}
            </p>

            {view === null ? <p className="text-sm text-hint">Загружаю…</p> : rows.length === 0 ? (
              <p className="text-sm text-hint">{all.length ? "Ничего не нашлось — поменяй период, поиск или фильтры." : "Заявок нет."}</p>
            ) : (
              <div className="divide-y divide-line">
                {rows.map((r) => (
                  <div key={r.id} className="py-3 flex gap-3 flex-wrap items-start">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-200">
                        <span className="text-hint">#{r.number}</span> {r.kind}{r.target && ` · ${r.target}`} · <b>{money(r.amount)} {r.asset}</b>
                        {r.fee > 0 && <span className="text-hint"> · комиссия {money(r.fee)}</span>}
                        <span className="text-hint"> · {r.network}</span>
                      </p>
                      <p className="text-[11px] text-hint mt-0.5 break-all">
                        {view.admin && `${r.author} · `}{stamp(r.created_at)} · {r.address}{source(r)}{r.comment && ` · ${r.comment}`}
                      </p>
                      <p className="text-[11px] text-zinc-400 mt-1">{detail(r)}</p>
                      {r.tx_hash && (
                        <p className="text-[11px] mt-0.5 break-all">
                          <a href={r.tx_url} target="_blank" rel="noreferrer" className="text-violet-300 hover:underline">Транзакция ↗</a>
                          <span className="text-hint"> · {r.tx_hash}</span>
                        </p>
                      )}
                    </div>
                    <span className={`btn btn-sm shrink-0 ${BADGE[stage(r)]}`}>{LABEL[stage(r)]}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {toast && (
        <div role="status" className="fixed right-4 bottom-4 z-40 max-w-sm whitespace-pre-line rounded-2xl border border-violet-600 bg-raised px-4 py-3 text-sm shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
