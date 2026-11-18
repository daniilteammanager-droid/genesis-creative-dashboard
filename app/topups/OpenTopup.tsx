"use client";

import { useState } from "react";
import type { Topup } from "@/lib/topups/requests";
import { exact } from "@/lib/topups/chain";
import { openActions, stage, STAGES, type Stage } from "@/lib/topups/view";

// Открытая заявка у владельца (Decision 126): сумма и адрес с копированием, QR, кто платит и кнопки — те же, что
// в платёжном чате. Нажатие идёт в те же функции, что у бота, поэтому чат и страница совпадают.

export type Op = "take" | "release" | "paid" | "reject" | "hash";

export const BADGE: Record<Stage, string> = {
  pending: "border-amber-700/40 text-amber-300", work: "border-blue-700/50 text-blue-300", search: "border-violet-700/50 text-violet-300",
  paid: "border-green-700/40 text-green-300", rejected: "border-red-800/40 text-red-300", expired: "border-zinc-700 text-zinc-400",
};
export const LABEL = Object.fromEntries(STAGES.map((s) => [s.key, s.label])) as Record<Stage, string>;
export const money = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 9 });
export const stamp = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
const time = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });

function deadline(r: Topup): string {
  if (!r.expires_at) return "Без срока";
  const left = Math.ceil((Date.parse(r.expires_at) - Date.now()) / 60_000);
  if (left <= 0) return `Срок вышел в ${time(r.expires_at)} МСК`;
  return `Оплатить до ${time(r.expires_at)} МСК — осталось ${left < 60 ? `${left} мин` : `${Math.floor(left / 60)} ч ${left % 60} мин`}`;
}

// Что сейчас с заявкой — строкой над кнопками; у новой ничего: кнопки говорят сами.
function now(r: Topup, me: string): { text: string; tone: string } | null {
  const st = stage(r);
  const at = (iso: string | null) => (iso ? ` с ${time(iso)}` : "");
  if (st === "work" && r.taken_by === me) {
    return { text: `Платишь ты${at(r.taken_at)}. В чате остальные видят «Платит ${me}» — не переведут.`, tone: "border-blue-700/50 bg-blue-900/15 text-blue-200" };
  }
  if (st === "work") return { text: `Платит ${r.taken_by}${at(r.taken_at)} — не переводи, спроси его.`, tone: "border-amber-700/50 bg-amber-900/15 text-amber-200" };
  if (st === "search") {
    return { text: `${r.closed_by ?? "Кто-то"} отметил оплату${r.searching_since ? ` в ${time(r.searching_since)}` : ""} — ищем перевод в блокчейне каждую минуту.`,
      tone: "border-violet-700/50 bg-violet-900/15 text-violet-200" };
  }
  return null;
}

export default function OpenTopup({ r, me, busy, onAct }: {
  r: Topup; me: string; busy: boolean; onAct: (op: Op, hash?: string) => void;
}) {
  const [qr, setQr] = useState(false);
  const [ask, setAsk] = useState(false);
  const [hash, setHash] = useState("");
  const [copied, setCopied] = useState<"amount" | "address" | null>(null);
  const a = openActions(r, me);
  const st = stage(r);
  const line = now(r, me);
  const copy = (what: "amount" | "address", text: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(what); setTimeout(() => setCopied(null), 1500); }).catch(() => undefined);
  };
  // TON и BTC — QR с суммой (ton://, bitcoin:), остальные сети — только адрес (lib/topups/qr.ts).
  const qrHasAmount = r.network === "TON" || r.network === "BTC";
  // Сумма так, как её вводят в кошелёк: точка, до последнего знака монеты.
  const amount = exact(r.amount, r.asset);

  return (
    <article className="rounded-2xl border border-line bg-raised p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-zinc-200">
          <span className="text-hint">#{r.number}</span> {r.kind}{r.target && ` · ${r.target}`}
          <span className="text-hint"> · от {r.author}, {stamp(r.created_at)}</span>
        </p>
        <span className={`btn btn-sm shrink-0 ${BADGE[st]}`}>{LABEL[st]}</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-panel p-3 space-y-1.5 min-w-0">
          <p className="label">Сумма — точно до знака</p>
          <p className="text-xl font-bold font-mono">{amount} {r.asset}</p>
          <p className="text-xs text-hint">Сеть {r.network}{r.fee > 0 && ` · комиссия ${money(r.fee)}, в перевод не входит`}</p>
          <button type="button" className="btn btn-sm" onClick={() => copy("amount", amount)}>
            {copied === "amount" ? "Скопировано" : "Копировать сумму"}
          </button>
        </div>
        <div className="rounded-xl border border-line bg-panel p-3 space-y-1.5 min-w-0">
          <p className="label">Адрес получателя</p>
          <p className="font-mono text-sm break-all text-zinc-200">{r.address}</p>
          <p className="text-xs text-hint">{deadline(r)}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm" onClick={() => copy("address", r.address)}>
              {copied === "address" ? "Скопировано" : "Копировать адрес"}
            </button>
            <button type="button" className="btn btn-sm" aria-expanded={qr} onClick={() => setQr((v) => !v)}>
              {qr ? "Скрыть QR" : "QR для оплаты"}
            </button>
          </div>
        </div>
      </div>

      {qr && (
        <div className="flex flex-wrap items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/topups?qr=${r.id}`} width={176} height={176} alt={`QR для оплаты заявки #${r.number}`} className="rounded-lg" />
          <p className="text-xs text-hint max-w-xs">
            {qrHasAmount ? "Кошелёк подставит адрес, сумму и монету." : `Кошелёк подставит адрес. Сумму — точно: ${amount}.`} Тот же QR, что в чате.
          </p>
        </div>
      )}

      {line && <p className={`rounded-xl border px-3 py-2 text-sm ${line.tone}`}>{line.text}</p>}

      {a.hash && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); onAct("hash", hash); }}>
          <label htmlFor={`hash-${r.id}`} className="label basis-full">Не находится — хэш или ссылка на транзакцию</label>
          <input id={`hash-${r.id}`} value={hash} onChange={(e) => setHash(e.target.value.trim())} className="field flex-1 min-w-[240px] font-mono"
                 placeholder="хэш или https://tronscan.org/#/transaction/…" />
          <button type="submit" className="btn" disabled={busy || hash.length < 10}>Закрыть хэшем</button>
        </form>
      )}

      {ask && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-800/50 bg-red-950/30 px-3 py-2 text-sm text-red-200">
          <span>Отклонить #{r.number}? Автор увидит «Отклонено», в чате кнопки уйдут.</span>
          <span className="flex gap-2">
            <button type="button" className="btn btn-sm border-red-800/50 text-red-300" disabled={busy} onClick={() => { setAsk(false); onAct("reject"); }}>Да, отклонить</button>
            <button type="button" className="btn btn-sm" onClick={() => setAsk(false)}>Нет</button>
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {a.take && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onAct("take")}>Беру в работу</button>}
        {a.paid && (
          <button type="button" className="btn border-green-700/50 text-green-300 hover:bg-green-900/20" disabled={busy} onClick={() => onAct("paid")}>
            Оплачено
          </button>
        )}
        {a.release && <button type="button" className="btn" disabled={busy} onClick={() => onAct("release")}>Снять с себя</button>}
        <span className="flex-1" />
        {a.reject && !ask && (
          <button type="button" className="btn border-red-800/50 text-red-300" disabled={busy} onClick={() => setAsk(true)}>Отклонить</button>
        )}
      </div>
      {r.comment && <p className="text-xs text-hint">Комментарий: {r.comment}</p>}
    </article>
  );
}
