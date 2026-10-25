"use client";

import { useEffect, useMemo, useState } from "react";
import type { Topup } from "@/lib/topups/requests";

// Заявки на пополнение (Decision 072): форма и список. Заявка уходит Top-Up
// ботом в платёжный чат, статус и хэш возвращаются сюда.

const field =
  "w-full bg-[#0d0b14] border border-violet-900/40 rounded-xl px-4 py-3 outline-none " +
  "focus:border-violet-600/50 transition placeholder:text-zinc-600 text-white text-sm";
const card = "bg-[#111118] border border-violet-900/30 rounded-2xl p-5 sm:p-6";
const pill = "text-[11px] px-2.5 py-1 rounded-full border transition";

const TIMES = [
  { minutes: 0, label: "Без срока" }, { minutes: 15, label: "15 минут" }, { minutes: 30, label: "30 минут" },
  { minutes: 60, label: "1 час" }, { minutes: 120, label: "2 часа" }, { minutes: 360, label: "6 часов" }, { minutes: 1440, label: "Сутки" },
];
const STATUS: Record<Topup["status"], { label: string; cls: string }> = {
  pending: { label: "Ждёт оплаты", cls: "border-amber-700/40 text-amber-300" },
  paid: { label: "Оплачено", cls: "border-green-700/40 text-green-300" },
  rejected: { label: "Отклонено", cls: "border-red-800/40 text-red-300" },
  expired: { label: "Время вышло", cls: "border-zinc-700 text-zinc-400" },
};
const TX: Record<string, string> = {
  TRC20: "https://tronscan.org/#/transaction/", TON: "https://tonviewer.com/transaction/",
  BEP20: "https://bscscan.com/tx/", ERC20: "https://etherscan.io/tx/",
};
const money = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 6 });
const stamp = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });

interface View { admin: boolean; chat: { title: string | null } | null; topups: Topup[] }
type Net = { network: string; asset: string; label: string };

export default function Topups({ kinds, networks }: { kinds: string[]; networks: Net[] }) {
  const [view, setView] = useState<View | null>(null);
  const [kind, setKind] = useState(kinds[0]);
  const [net, setNet] = useState(0);
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState("");
  const [address, setAddress] = useState("");
  const [minutes, setMinutes] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState<Topup["status"] | "all">("all");

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
      const n = networks[net];
      const res = await fetch("/api/topups", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, amount: Number(amount.replace(",", ".")), fee: Number(fee.replace(",", ".") || 0),
          network: n.network, asset: n.asset, address, minutes: minutes || null, comment }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.topups) throw new Error(d?.error ?? "Не получилось — попробуй ещё раз");
      setView(d);
      setMsg({ ok: true, text: "Заявка ушла в платёжный чат. Ответ придёт сюда и в Telegram (уведомление «Пополнения»)" });
      setAmount(""); setFee(""); setAddress(""); setComment("");
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

  const rows = useMemo(() => (view?.topups ?? []).filter((r) => filter === "all" || r.status === filter), [view, filter]);
  const paidTotal = useMemo(() => {
    const by = new Map<string, number>();
    for (const r of rows) if (r.status === "paid") by.set(r.asset, (by.get(r.asset) ?? 0) + r.amount + r.fee);
    return [...by].map(([a, s]) => `${money(s)} ${a}`).join(" · ");
  }, [rows]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      <h1 className="text-2xl font-semibold text-white">Пополнения</h1>

      {view?.admin && (
        <div className={`${card} flex items-center gap-3 flex-wrap`}>
          <p className="text-sm text-zinc-300 flex-1 min-w-[200px]">
            {view.chat ? <>Платёжный чат: <b>{view.chat.title ?? "без названия"}</b></> : "Платёжный чат не привязан — заявки некуда отправлять."}
          </p>
          <button type="button" onClick={bind} className={`${pill} border-violet-700/50 text-violet-200 hover:bg-violet-900/20`}>
            {view.chat ? "Привязать другой чат" : "Привязать чат"}
          </button>
        </div>
      )}

      <form onSubmit={submit} className={`${card} grid gap-2.5 sm:grid-cols-2`}>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={field}>
          {kinds.map((k) => <option key={k}>{k}</option>)}
        </select>
        <select value={net} onChange={(e) => setNet(Number(e.target.value))} className={field}>
          {networks.map((n, i) => <option key={n.label} value={i}>{n.label}</option>)}
        </select>
        <input inputMode="decimal" placeholder={`Сумма, ${networks[net].asset}`} value={amount} onChange={(e) => setAmount(e.target.value)} className={field} />
        <input inputMode="decimal" placeholder="Комиссия (агент, платёжка) — необязательно" value={fee} onChange={(e) => setFee(e.target.value)} className={field} />
        <input placeholder="Адрес получателя" value={address} onChange={(e) => setAddress(e.target.value.trim())} className={`${field} sm:col-span-2 font-mono`} />
        <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className={field}>
          {TIMES.map((t) => <option key={t.minutes} value={t.minutes}>Время на оплату: {t.label}</option>)}
        </select>
        <input placeholder="Комментарий — необязательно" value={comment} onChange={(e) => setComment(e.target.value)} className={field} />
        <button type="submit" disabled={busy || !amount || !address}
                className="sm:col-span-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-600 to-violet-500 text-white hover:from-violet-500 hover:to-violet-400 transition disabled:opacity-50">
          {busy ? "Отправляю…" : "Отправить заявку"}
        </button>
        {msg && (
          <div className={`sm:col-span-2 rounded-xl px-4 py-3 text-sm border ${
            msg.ok ? "bg-green-950/30 border-green-700/30 text-green-300" : "bg-red-950/40 border-red-700/30 text-red-300"
          }`}>{msg.text}</div>
        )}
      </form>

      <div className={card}>
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {(["all", "pending", "paid", "rejected", "expired"] as const).map((s) => (
            <button key={s} type="button" onClick={() => setFilter(s)}
                    className={`${pill} ${filter === s ? "border-violet-500 text-white bg-violet-900/30" : "border-violet-900/40 text-zinc-400"}`}>
              {s === "all" ? "Все" : STATUS[s].label}
            </button>
          ))}
          {paidTotal && <span className="text-xs text-zinc-500 ml-auto">Оплачено: {paidTotal}</span>}
        </div>
        {view === null ? <p className="text-sm text-zinc-500">Загружаю…</p> : rows.length === 0 ? (
          <p className="text-sm text-zinc-500">Заявок нет.</p>
        ) : (
          <div className="divide-y divide-violet-900/20">
            {rows.map((r) => (
              <div key={r.id} className="py-3 flex gap-3 flex-wrap items-start">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-200">
                    <span className="text-zinc-500">#{r.number}</span> {r.kind} · <b>{money(r.amount + r.fee)} {r.asset}</b>
                    {r.fee > 0 && <span className="text-zinc-500"> ({money(r.amount)} + {money(r.fee)})</span>}
                    <span className="text-zinc-500"> · {r.network}</span>
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-0.5 break-all">
                    {view.admin && `${r.author} · `}{stamp(r.created_at)} · {r.address}{r.comment && ` · ${r.comment}`}
                  </p>
                  {r.tx_hash && (
                    <a href={TX[r.network] + r.tx_hash} target="_blank" rel="noreferrer" className="text-[11px] text-violet-300 hover:underline break-all">
                      {r.tx_hash}
                    </a>
                  )}
                </div>
                <span className={`${pill} shrink-0 ${STATUS[r.status].cls}`}>
                  {r.status === "pending" && r.searching_since ? "Ищу перевод" : STATUS[r.status].label}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
