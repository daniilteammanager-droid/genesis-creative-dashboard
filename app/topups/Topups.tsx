"use client";

import { useEffect, useMemo, useState } from "react";
import type { Topup } from "@/lib/topups/requests";

// Заявки на пополнение (Decision 072): форма и список. Заявка уходит Top-Up
// ботом в платёжный чат, статус и хэш возвращаются сюда.

const card = "card p-5 sm:p-6";

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
const money = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 9 });
const stamp = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });

// Что с заявкой сейчас — словами, со временем и тем, кто закрыл.
function detail(r: Topup): string {
  const by = r.closed_by ? ` · ${r.closed_by}` : "";
  if (r.status === "paid") return `Оплачено ${r.paid_at ? stamp(r.paid_at) : ""}${by}${r.paid_amount ? ` · пришло ${money(r.paid_amount)} ${r.asset}` : ""}`;
  if (r.status === "rejected") return `Отклонено${by}`;
  if (r.status === "expired") return `Время на оплату вышло${r.expires_at ? ` ${stamp(r.expires_at)}` : ""}`;
  if (r.searching_since) return `Отмечено оплаченным ${stamp(r.searching_since)}${by} — ищем перевод в блокчейне`;
  return r.expires_at ? `Ждёт оплаты до ${stamp(r.expires_at)}` : "Ждёт оплаты, без срока";
}

interface View { admin: boolean; chat: { title: string | null } | null; topups: Topup[] }
type Net = { network: string; asset: string; label: string };

export default function Topups({ categories, networks }: { categories: Record<string, string[]>; networks: Net[] }) {
  const [view, setView] = useState<View | null>(null);
  // Ничего не выбрано заранее: сеть или «куда» по умолчанию — путь к оплате не туда.
  const [kind, setKind] = useState("");
  const [target, setTarget] = useState("");
  const [net, setNet] = useState(-1);
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState("");
  const [address, setAddress] = useState("");
  const [minutes, setMinutes] = useState(-1);
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
        body: JSON.stringify({ kind, target, amount: Number(amount.replace(",", ".")), fee: fee.trim() === "" ? null : Number(fee.replace(",", ".")),
          network: n?.network, asset: n?.asset, address, minutes: minutes < 0 ? null : minutes, comment }),
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

  const rows = useMemo(() => (view?.topups ?? []).filter((r) => filter === "all" || r.status === filter), [view, filter]);
  const paidTotal = useMemo(() => {
    const by = new Map<string, number>();
    for (const r of rows) if (r.status === "paid") by.set(r.asset, (by.get(r.asset) ?? 0) + r.amount);
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
        <select value={net} onChange={(e) => setNet(Number(e.target.value))} className="field w-full">
          <option value={-1} disabled>Сеть и монета</option>
          {networks.map((n, i) => <option key={n.label} value={i}>{n.label}</option>)}
        </select>
        <input inputMode="decimal" placeholder={`Сумма${net >= 0 ? `, ${networks[net].asset}` : ""}`} value={amount} onChange={(e) => setAmount(e.target.value)} className="field w-full" />
        <input inputMode="decimal" placeholder="Комиссия (нет — 0)" value={fee} onChange={(e) => setFee(e.target.value)} className="field w-full" />
        <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="field w-full">
          <option value={-1} disabled>Время на оплату</option>
          {TIMES.map((t) => <option key={t.minutes} value={t.minutes}>Время на оплату: {t.label}</option>)}
        </select>
        <input placeholder="Адрес получателя" value={address} onChange={(e) => setAddress(e.target.value.trim())} className={`field w-full sm:col-span-2 font-mono`} />
        <input placeholder="Комментарий (нечего добавить — «-»)" value={comment}
               onChange={(e) => setComment(e.target.value)} className={`field w-full sm:col-span-2`} />
        <button type="submit" disabled={busy || !target || net < 0 || !amount || fee.trim() === "" || !address || minutes < 0 || !comment.trim()}
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
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {(["all", "pending", "paid", "rejected", "expired"] as const).map((s) => (
            <button key={s} type="button" onClick={() => setFilter(s)}
                    className={`btn btn-sm ${filter === s ? "border-violet-500 text-white bg-violet-900/30" : "border-line text-zinc-400"}`}>
              {s === "all" ? "Все" : STATUS[s].label}
            </button>
          ))}
          {paidTotal && <span className="text-xs text-hint ml-auto">Оплачено: {paidTotal}</span>}
        </div>
        {view === null ? <p className="text-sm text-hint">Загружаю…</p> : rows.length === 0 ? (
          <p className="text-sm text-hint">Заявок нет.</p>
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
                      <a href={TX[r.network] + r.tx_hash} target="_blank" rel="noreferrer" className="text-violet-300 hover:underline">Транзакция ↗</a>
                      <span className="text-hint"> · {r.tx_hash}</span>
                    </p>
                  )}
                </div>
                <span className={`btn btn-sm shrink-0 ${STATUS[r.status].cls}`}>
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
