"use client";

import { useMemo, useState } from "react";
import { chip } from "@/components/ui";
import type { Topup } from "@/lib/topups/requests";
import { exact, type Asset } from "@/lib/topups/chain";
import { findTarget, OTHER, suggestTemplate, targetsOf, type Category, type Template } from "@/lib/topups/config";
import { continueList } from "@/lib/topups/comment";

// Форма новой заявки с шаблонами и закреплёнными кошельками (Decision 131). Шаблон только заполняет форму —
// отправляет человек кнопкой. Кошелёк «куда» подставляет монету, сеть и адрес из настроек; «Другой адрес» — вручную,
// если владелец не поставил «только эти кошельки».

const TIMES = [
  { minutes: 0, label: "Без срока" }, { minutes: 15, label: "15 минут" }, { minutes: 30, label: "30 минут" },
  { minutes: 60, label: "1 час" }, { minutes: 120, label: "2 часа" }, { minutes: 360, label: "6 часов" }, { minutes: 1440, label: "Сутки" },
];
const timeLabel = (m: number | null) => TIMES.find((t) => t.minutes === m)?.label.toLowerCase();
// Как выглядит адрес сети — подсказка в поле.
const ADDRESS: Record<string, string> = { TRC20: "T…", ERC20: "0x…", BEP20: "0x…", BTC: "bc1… / 1… / 3…", TON: "UQ… / EQ…" };
const money = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 9 });
const num = (s: string) => Number(s.replace(",", "."));

export default function TopupForm({ categories, pairs, networks, templates, own, onCreated, onTemplates }: {
  categories: Category[]; pairs: Record<string, string[]>; networks: Record<string, string>; templates: Template[];
  own: Topup[]; onCreated: (view: unknown) => void; onTemplates: (t: Template[]) => void;
}) {
  // Ничего не выбрано заранее: сеть или «куда» по умолчанию — путь к оплате не туда.
  const [kind, setKind] = useState("");
  const [target, setTarget] = useState("");
  const [walletName, setWalletName] = useState("");
  const [other, setOther] = useState(false);
  const [coin, setCoin] = useState("");
  const [net, setNet] = useState("");
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState("");
  const [address, setAddress] = useState("");
  const [minutes, setMinutes] = useState(-1);
  const [comment, setComment] = useState("");
  const [tplId, setTplId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [noSuggest, setNoSuggest] = useState(false);

  const spot = findTarget(categories, kind, target);
  const wallets = spot?.wallets ?? [];
  const wallet = wallets.find((w) => w.name === walletName) ?? wallets[0];
  const useWallet = Boolean(wallet) && !other;
  const suggest = useMemo(() => (noSuggest ? null : suggestTemplate(own, templates)), [own, templates, noSuggest]);
  const asset = useWallet ? wallet!.asset : coin;

  const pickTarget = (t: string, k = kind) => {
    setTarget(t);
    setWalletName(findTarget(categories, k, t)?.wallets[0]?.name ?? "");
    setOther(false);
  };
  // Монета задаёт сети: у монеты одна сеть — встаёт сама, иначе выбирать заново.
  const pickCoin = (c: string) => { setCoin(c); setNet(pairs[c]?.length === 1 ? pairs[c][0] : ""); };

  function fill(t: Template) {
    setTplId(t.id); setKind(t.kind); setTarget(t.target);
    const w = t.wallet ? findTarget(categories, t.kind, t.target)?.wallets.find((x) => x.name === t.wallet) : undefined;
    setWalletName(w?.name ?? findTarget(categories, t.kind, t.target)?.wallets[0]?.name ?? "");
    setOther(!w && Boolean(t.address));
    setCoin(t.asset ?? ""); setNet(t.network ?? ""); setAddress(t.address ?? "");
    setAmount(t.amount === null ? "" : String(t.amount)); setFee(String(t.fee ?? 0));
    setMinutes(t.minutes ?? -1); setComment(t.comment ?? "");
    setMsg({ ok: true, text: t.amount === null ? "Форма заполнена из шаблона — впиши сумму и отправь." : "Форма заполнена из шаблона. Проверь и отправь." });
  }

  async function templateCall(body: unknown, done: string) {
    try {
      const res = await fetch("/api/topups/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.templates) throw new Error(d?.error ?? "Не получилось — попробуй ещё раз");
      onTemplates(d.templates);
      setMsg({ ok: true, text: done });
      return true;
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Сеть не ответила" });
      return false;
    }
  }
  const saveTemplate = () => templateCall({ op: "save", template: {
    kind, target, wallet: useWallet ? wallet!.name : null, asset: useWallet ? null : coin || null, network: useWallet ? null : net || null,
    address: useWallet ? null : address || null, amount: amount.trim() ? num(amount) : null, fee: fee.trim() ? num(fee) : 0,
    minutes: minutes < 0 ? null : minutes, comment: comment.trim() || null,
  } }, "Шаблон сохранён — он наверху. Нажмёшь — форма заполнится.");
  const removeTemplate = () => templateCall({ op: "delete", id: tplId }, "Шаблон убран.").then((ok) => ok && setTplId(""));
  async function acceptSuggest() {
    if (!suggest) return;
    const w = findTarget(categories, suggest.kind, suggest.target)?.wallets.find((x) => x.address === suggest.address && x.asset === suggest.asset);
    await templateCall({ op: "save", template: {
      kind: suggest.kind, target: suggest.target, wallet: w?.name ?? null, asset: w ? null : suggest.asset, network: w ? null : suggest.network,
      address: w ? null : suggest.address, amount: suggest.amount, fee: 0, minutes: null, comment: null,
    } }, "Шаблон сохранён — он наверху.");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/topups", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, target, amount: num(amount), fee: fee.trim() === "" ? null : num(fee),
          wallet: useWallet ? wallet!.name : null, network: useWallet ? undefined : net, asset: useWallet ? undefined : coin,
          address: useWallet ? undefined : address, minutes: minutes < 0 ? null : minutes, comment }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.topups) throw new Error(d?.error ?? "Не получилось — попробуй ещё раз");
      onCreated(d);
      setMsg({ ok: true, text: "Заявка ушла на оплату. Статус, хэш и ссылка на транзакцию появятся здесь в списке" });
      setAmount(""); setFee(""); setAddress(""); setComment(""); setMinutes(-1); setTplId("");
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Сеть не ответила" });
    } finally {
      setBusy(false);
    }
  }

  // Enter в комментарии продолжает список «- » / «1. »; пустой пункт — конец списка (continueList в lib/topups/comment.ts).
  function listEnter(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    const el = e.currentTarget;
    if (el.selectionStart !== el.selectionEnd) return;
    const next = continueList(el.value, el.selectionStart);
    if (!next) return;
    e.preventDefault();
    setComment(next.value);
    requestAnimationFrame(() => el.setSelectionRange(next.caret, next.caret));
  }

  const tplName = (t: Template) => (t.target === OTHER ? `${t.kind} · ${OTHER}` : t.target);
  const tplSub = (t: Template) => {
    const a = t.wallet ? findTarget(categories, t.kind, t.target)?.wallets.find((w) => w.name === t.wallet)?.asset : t.asset;
    return [t.amount === null ? "сумма каждый раз" : `${money(t.amount)} ${a ?? ""}`.trim(), timeLabel(t.minutes)].filter(Boolean).join(" · ");
  };
  const ready = target && amount && fee.trim() !== "" && minutes >= 0 && comment.trim() && (useWallet || (net && address));

  return (
    <>
      {(templates.length > 0 || suggest) && (
        <section className="card p-5 sm:p-6 space-y-3" aria-label="Шаблоны">
          <div>
            <h2 className="text-base font-semibold">Шаблоны</h2>
            <p className="text-xs text-hint mt-1">Твои частые заявки. Нажал — форма заполнилась, проверил и отправил. Шаблоны видишь только ты.</p>
          </div>
          {templates.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {templates.map((t) => (
                <button key={t.id} type="button" {...chip(t.id === tplId)} onClick={() => fill(t)}>
                  {tplName(t)} <span className="text-hint ml-1">{tplSub(t)}</span>
                </button>
              ))}
            </div>
          )}
          {suggest && (
            <div className="rounded-xl border border-line bg-raised px-4 py-3 flex flex-wrap items-center gap-3">
              <p className="text-sm text-zinc-300 flex-1 min-w-[220px]">
                За месяц ты {suggest.n} {[2, 3, 4].includes(suggest.n % 10) && ![12, 13, 14].includes(suggest.n % 100) ? "раза" : "раз"} отправлял <b>{suggest.kind} · {suggest.target} · {exact(suggest.amount, suggest.asset)} {suggest.asset}</b>. Сохранить шаблоном?
              </p>
              <button type="button" className="btn btn-sm" onClick={acceptSuggest}>Сохранить</button>
              <button type="button" className="btn btn-sm" onClick={() => setNoSuggest(true)}>Не надо</button>
            </div>
          )}
        </section>
      )}

      <form data-tour="topups-form" onSubmit={submit} className="card p-5 sm:p-6 grid gap-2.5 sm:grid-cols-2">
        <select value={kind} onChange={(e) => { setKind(e.target.value); setTarget(""); setWalletName(""); setOther(false); setTplId(""); }} className="field w-full" aria-label="Категория">
          <option value="" disabled>Категория</option>
          {categories.map((c) => <option key={c.id}>{c.name}</option>)}
        </select>
        <select value={target} onChange={(e) => { pickTarget(e.target.value); setTplId(""); }} disabled={!kind} className="field w-full disabled:opacity-50" aria-label="Куда именно">
          <option value="" disabled>Куда именно</option>
          {targetsOf(categories, kind).map((t) => (
            <option key={t} value={t}>{findTarget(categories, kind, t)?.wallets.length ? `${t} — кошелёк из настроек` : t}</option>
          ))}
        </select>

        {useWallet && (
          <div className="sm:col-span-2 rounded-xl border border-violet-600 bg-raised p-3.5 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="label">Кошелёк из настроек</span>
              <span className="flex-1" />
              {!spot?.only && <button type="button" className="btn btn-sm" onClick={() => { setOther(true); setAddress(""); }}>Другой адрес</button>}
            </div>
            {wallets.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {wallets.map((w) => (
                  <button key={w.name} type="button" {...chip(w.name === wallet!.name)} onClick={() => setWalletName(w.name)}>
                    {w.name} <span className="text-hint ml-1">{w.asset} · {w.network}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <p className="text-sm font-semibold">{wallet!.asset} · {networks[wallet!.network] ?? wallet!.network}</p>
              <p className="font-mono text-sm text-zinc-200 break-all">{wallet!.address}</p>
            </div>
            <p className="text-xs text-hint">Монета, сеть и адрес — из настроек, руками не вводятся.</p>
          </div>
        )}

        {!useWallet && (
          <>
            <select value={coin} onChange={(e) => pickCoin(e.target.value)} className="field w-full" aria-label="Монета">
              <option value="" disabled>Монета</option>
              {Object.keys(pairs).map((c) => <option key={c}>{c}</option>)}
            </select>
            <select value={net} onChange={(e) => setNet(e.target.value)} disabled={!coin} className="field w-full disabled:opacity-50" aria-label="Сеть">
              <option value="" disabled>Сеть</option>
              {Object.entries(networks).map(([n, label]) => <option key={n} value={n} disabled={!pairs[coin]?.includes(n)}>{label}</option>)}
            </select>
            <input placeholder={`Адрес получателя${net ? ` (${ADDRESS[net]})` : ""}`} value={address} onChange={(e) => setAddress(e.target.value.trim())}
                   className="field w-full sm:col-span-2 font-mono" aria-label="Адрес получателя" />
          </>
        )}
        {other && wallets.length > 0 && (
          <div className="sm:col-span-2 rounded-xl border border-amber-700/50 bg-amber-900/15 px-3.5 py-2.5 text-sm text-amber-200 flex flex-wrap items-center gap-3">
            <span className="flex-1 min-w-[220px]">Адрес не из настроек — проверь его дважды. В чате у заявки будет «вручную, не из настроек».</span>
            <button type="button" className="btn btn-sm" onClick={() => setOther(false)}>Вернуть кошелёк</button>
          </div>
        )}

        <input inputMode="decimal" placeholder={`Сумма${asset ? `, ${asset as Asset}` : ""}`} value={amount} onChange={(e) => setAmount(e.target.value)} className="field w-full" aria-label="Сумма" />
        <input inputMode="decimal" placeholder="Комиссия (нет — 0)" value={fee} onChange={(e) => setFee(e.target.value)} className="field w-full" aria-label="Комиссия" />
        <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="field w-full sm:col-span-2" aria-label="Время на оплату">
          <option value={-1} disabled>Время на оплату</option>
          {TIMES.map((t) => <option key={t.minutes} value={t.minutes}>Время на оплату: {t.label}</option>)}
        </select>
        <textarea placeholder={"Комментарий (нечего добавить — «-»)\nСписок: «- пункт» и Enter — следующий пункт сам. Ссылки станут кликабельными."}
                  value={comment} rows={3} onChange={(e) => setComment(e.target.value)} onKeyDown={listEnter}
                  className="field w-full sm:col-span-2 resize-y min-h-24" aria-label="Комментарий" />
        <div className="sm:col-span-2 flex flex-wrap gap-2.5">
          <button type="submit" disabled={busy || !ready} className="btn btn-primary flex-[1_1_240px]">{busy ? "Отправляю…" : "Отправить заявку"}</button>
          <button type="button" className="btn" disabled={!target} onClick={saveTemplate}>Сохранить как шаблон</button>
          {tplId && <button type="button" className="btn" onClick={removeTemplate}>Убрать шаблон</button>}
        </div>
        {msg && (
          <div className={`sm:col-span-2 rounded-xl px-4 py-3 text-sm border ${
            msg.ok ? "bg-green-950/30 border-green-700/30 text-green-300" : "bg-red-950/40 border-red-700/30 text-red-300"
          }`}>{msg.text}</div>
        )}
      </form>
    </>
  );
}
