"use client";

import { useEffect, useMemo, useState } from "react";
import { chip } from "@/components/ui";
import type { Topup } from "@/lib/topups/requests";
import { filterTopups, paidTotals, stage, STAGES, type Stage, type TopupFilter } from "@/lib/topups/view";

// Заявки на пополнение (Decision 072): форма и список. Заявка уходит Top-Up
// ботом в платёжный чат, статус и хэш возвращаются сюда.

const card = "card p-5 sm:p-6";

const TIMES = [
  { minutes: 0, label: "Без срока" }, { minutes: 15, label: "15 минут" }, { minutes: 30, label: "30 минут" },
  { minutes: 60, label: "1 час" }, { minutes: 120, label: "2 часа" }, { minutes: 360, label: "6 часов" }, { minutes: 1440, label: "Сутки" },
];
const BADGE: Record<Stage, string> = {
  pending: "border-amber-700/40 text-amber-300", work: "border-blue-700/50 text-blue-300", search: "border-violet-700/50 text-violet-300",
  paid: "border-green-700/40 text-green-300", rejected: "border-red-800/40 text-red-300", expired: "border-zinc-700 text-zinc-400",
};
const LABEL = Object.fromEntries(STAGES.map((s) => [s.key, s.label])) as Record<Stage, string>;
// Как выглядит адрес сети — подсказка в поле.
const ADDRESS: Record<string, string> = { TRC20: "T…", ERC20: "0x…", BEP20: "0x…", BTC: "bc1… / 1… / 3…", TON: "UQ… / EQ…" };
const NO_FILTER: TopupFilter = { q: "", stages: [], authors: [], kinds: [], targets: [] };
const flip = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const money = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 9 });
const stamp = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });

// Что с заявкой сейчас — словами, со временем и тем, кто закрыл.
function detail(r: Topup): string {
  const by = r.closed_by ? ` · ${r.closed_by}` : "";
  if (r.status === "paid") return `Оплачено ${r.paid_at ? stamp(r.paid_at) : ""}${by}${r.paid_amount ? ` · пришло ${money(r.paid_amount)} ${r.asset}` : ""}`;
  if (r.status === "rejected") return `Отклонено${by}`;
  if (r.status === "expired") return `Время на оплату вышло${r.expires_at ? ` ${stamp(r.expires_at)}` : ""}`;
  if (r.searching_since) return `Отмечено оплаченным ${stamp(r.searching_since)}${by} — ищем перевод в блокчейне`;
  if (r.taken_by) return `В работе · ${r.taken_by}${r.taken_at ? ` с ${stamp(r.taken_at)}` : ""} — платит, остальные не трогают`;
  return r.expires_at ? `Ждёт оплаты до ${stamp(r.expires_at)}` : "Ждёт оплаты, без срока";
}

interface View { admin: boolean; chat: { title: string | null } | null; topups: Topup[] }

// Ряд чипов фильтра с подписью слева.
function Chips({ label, items, on, toggle }: { label: string; items: { key: string; label: string }[]; on: string[]; toggle: (k: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="label w-20 shrink-0">{label}</span>
      {items.map((i) => <button key={i.key} type="button" {...chip(on.includes(i.key))} onClick={() => toggle(i.key)}>{i.label}</button>)}
    </div>
  );
}

export default function Topups({ categories, pairs, networks }: {
  categories: Record<string, string[]>; pairs: Record<string, string[]>; networks: Record<string, string>;
}) {
  const [view, setView] = useState<View | null>(null);
  // Ничего не выбрано заранее: сеть или «куда» по умолчанию — путь к оплате не туда.
  const [kind, setKind] = useState("");
  const [target, setTarget] = useState("");
  const [coin, setCoin] = useState("");
  const [net, setNet] = useState("");
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState("");
  const [address, setAddress] = useState("");
  const [minutes, setMinutes] = useState(-1);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [f, setF] = useState<TopupFilter>(NO_FILTER);

  const load = () => fetch("/api/topups").then((r) => r.json()).then((d) => d.topups && setView(d)).catch(() => undefined);
  useEffect(() => {
    load();
    // Статус меняется в боте — подтягиваем, пока страница открыта.
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/topups", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, target, amount: Number(amount.replace(",", ".")), fee: fee.trim() === "" ? null : Number(fee.replace(",", ".")),
          network: net, asset: coin, address, minutes: minutes < 0 ? null : minutes, comment }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.topups) throw new Error(d?.error ?? "Не получилось — попробуй ещё раз");
      setView(d);
      setMsg({ ok: true, text: "Заявка ушла на оплату. Статус, хэш и ссылка на транзакцию появятся здесь в списке" });
      setAmount(""); setFee(""); setAddress(""); setComment(""); setMinutes(-1);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Сеть не ответила" });
    } finally {
      setBusy(false);
    }
  }

  async function bind() {
    const d = await fetch("/api/topups?bind=1").then((r) => r.json()).catch(() => null);
    if (d?.link) window.open(d.link, "_blank");
    else setMsg({ ok: false, text: d?.error ?? "Не получилось взять ссылку" });
  }

  const all = useMemo(() => view?.topups ?? [], [view]);
  const rows = useMemo(() => filterTopups(all, f), [all, f]);
  const paidTotal = useMemo(() => paidTotals(rows), [rows]);
  const authors = useMemo(() => [...new Set(all.map((r) => r.author ?? "—"))].sort().map((a) => ({ key: a, label: a })), [all]);
  const targets = f.kinds.flatMap((k) => (categories[k] ?? []).map((t) => ({ key: t, label: t })));
  const filtered = f.q.trim() !== "" || f.stages.length + f.authors.length + f.kinds.length + f.targets.length > 0;
  // Монета задаёт сети: у монеты одна сеть — встаёт сама, иначе выбирать заново.
  const pickCoin = (c: string) => { setCoin(c); setNet(pairs[c]?.length === 1 ? pairs[c][0] : ""); };
  const toggleKind = (k: string) => setF((p) => {
    const kinds = flip(p.kinds, k);
    return { ...p, kinds, targets: p.targets.filter((t) => kinds.some((x) => categories[x]?.includes(t))) };
  });

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-5">
      <h1 className="page-title">Пополнения</h1>

      {view?.admin && (
        <div className={`${card} flex items-center gap-3 flex-wrap`}>
          <p className="text-sm text-zinc-300 flex-1 min-w-[200px]">
            {view.chat ? <>Платёжный чат: <b>{view.chat.title ?? "без названия"}</b></> : "Платёжный чат не привязан — заявки некуда отправлять."}
          </p>
          <button type="button" onClick={bind} className={`btn btn-sm border-violet-700/50 text-violet-200 hover:bg-violet-900/20`}>
            {view.chat ? "Привязать другой чат" : "Привязать чат"}
          </button>
        </div>
      )}

      <form data-tour="topups-form" onSubmit={submit} className={`${card} grid gap-2.5 sm:grid-cols-2`}>
        <select value={kind} onChange={(e) => { setKind(e.target.value); setTarget(""); }} className="field w-full">
          <option value="" disabled>Категория</option>
          {Object.keys(categories).map((k) => <option key={k}>{k}</option>)}
        </select>
        <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={!kind} className={`field w-full disabled:opacity-50`}>
          <option value="" disabled>Куда именно</option>
          {(categories[kind] ?? []).map((t) => <option key={t}>{t}</option>)}
        </select>
        <select value={coin} onChange={(e) => pickCoin(e.target.value)} className="field w-full" aria-label="Монета">
          <option value="" disabled>Монета</option>
          {Object.keys(pairs).map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={net} onChange={(e) => setNet(e.target.value)} disabled={!coin} className="field w-full disabled:opacity-50" aria-label="Сеть">
          <option value="" disabled>Сеть</option>
          {Object.entries(networks).map(([n, label]) => <option key={n} value={n} disabled={!pairs[coin]?.includes(n)}>{label}</option>)}
        </select>
        <input inputMode="decimal" placeholder={`Сумма${coin ? `, ${coin}` : ""}`} value={amount} onChange={(e) => setAmount(e.target.value)} className="field w-full" />
        <input inputMode="decimal" placeholder="Комиссия (нет — 0)" value={fee} onChange={(e) => setFee(e.target.value)} className="field w-full" />
        <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="field w-full sm:col-span-2">
          <option value={-1} disabled>Время на оплату</option>
          {TIMES.map((t) => <option key={t.minutes} value={t.minutes}>Время на оплату: {t.label}</option>)}
        </select>
        <input placeholder={`Адрес получателя${net ? ` (${ADDRESS[net]})` : ""}`} value={address} onChange={(e) => setAddress(e.target.value.trim())} className={`field w-full sm:col-span-2 font-mono`} />
        <input placeholder="Комментарий (нечего добавить — «-»)" value={comment}
               onChange={(e) => setComment(e.target.value)} className={`field w-full sm:col-span-2`} />
        <button type="submit" disabled={busy || !target || !net || !amount || fee.trim() === "" || !address || minutes < 0 || !comment.trim()}
                className="btn btn-primary sm:col-span-2">
          {busy ? "Отправляю…" : "Отправить заявку"}
        </button>
        {msg && (
          <div className={`sm:col-span-2 rounded-xl px-4 py-3 text-sm border ${
            msg.ok ? "bg-green-950/30 border-green-700/30 text-green-300" : "bg-red-950/40 border-red-700/30 text-red-300"
          }`}>{msg.text}</div>
        )}
      </form>

      <div data-tour="topups-list" className={card}>
        <div className="space-y-2.5 mb-3">
          <input type="search" value={f.q} onChange={(e) => { const q = e.target.value; setF((p) => ({ ...p, q })); }} className="field w-full"
                 placeholder="Поиск: номер, сумма, адрес, хэш, комментарий, кто создал" aria-label="Поиск заявок" />
          <Chips label="Статус" items={STAGES} on={f.stages} toggle={(k) => setF((p) => ({ ...p, stages: flip(p.stages, k as Stage) }))} />
          {view?.admin && authors.length > 1 && (
            <Chips label="Баер" items={authors} on={f.authors} toggle={(k) => setF((p) => ({ ...p, authors: flip(p.authors, k) }))} />
          )}
          <Chips label="Категория" items={Object.keys(categories).map((k) => ({ key: k, label: k }))} on={f.kinds} toggle={toggleKind} />
          {targets.length > 0 && <Chips label="Куда" items={targets} on={f.targets} toggle={(k) => setF((p) => ({ ...p, targets: flip(p.targets, k) }))} />}
          <div className="flex items-center gap-3 flex-wrap text-xs">
            {filtered && <span className="text-hint">Найдено: {rows.length} из {all.length}</span>}
            {filtered && <button type="button" onClick={() => setF(NO_FILTER)} className="btn btn-sm">Сбросить</button>}
            {paidTotal && <span className="text-hint ml-auto">Оплачено: {paidTotal}</span>}
          </div>
        </div>
        {view === null ? <p className="text-sm text-hint">Загружаю…</p> : rows.length === 0 ? (
          <p className="text-sm text-hint">{all.length ? "Ничего не нашлось — поменяй поиск или фильтры." : "Заявок нет."}</p>
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
                    {view.admin && `${r.author} · `}{stamp(r.created_at)} · {r.address}{r.comment && ` · ${r.comment}`}
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
    </div>
  );
}
