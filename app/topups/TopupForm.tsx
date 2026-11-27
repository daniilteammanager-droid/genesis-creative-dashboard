"use client";

import { useMemo, useState } from "react";
import { chip, seg } from "@/components/ui";
import Select from "@/components/Select";
import type { Topup } from "@/lib/topups/requests";
import { exact, type Asset } from "@/lib/topups/chain";
import { findTarget, OTHER, suggestTemplate, targetsOf, type Category, type Template } from "@/lib/topups/config";
import { continueList } from "@/lib/topups/comment";
import { feeCalc, feeTag, type Fee } from "@/lib/topups/fee";

// Форма новой заявки с шаблонами и закреплёнными кошельками (Decision 131). Шаблон только заполняет форму —
// отправляет человек кнопкой. Кошелёк «куда» подставляет монету, сеть и адрес из настроек; «Другой адрес» — вручную,
// если владелец не поставил «только эти кошельки». Комиссия «из суммы» / «сверху» (Decision 132) — из настроек «куда»,
// меняется для одной заявки; форма сразу считает, сколько переводим и сколько зайдёт (feeCalc — тот же, что у сервера).

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
  const [feeMode, setFeeMode] = useState<"none" | Fee["mode"]>("none");
  const [feePct, setFeePct] = useState("");

  const spot = findTarget(categories, kind, target);
  const wallets = spot?.wallets ?? [];
  const wallet = wallets.find((w) => w.name === walletName) ?? wallets[0];
  const useWallet = Boolean(wallet) && !other;
  const suggest = useMemo(() => (noSuggest ? null : suggestTemplate(own, templates)), [own, templates, noSuggest]);
  const asset = useWallet ? wallet!.asset : coin;
  const feeNow: Fee | null = feeMode === "none" ? null : { mode: feeMode, pct: num(feePct) || 0 };
  const calc = feeCalc(feeNow, num(amount) || 0, num(fee) || 0);
  const feeNote = spot?.fee || feeMode !== "none"
    ? (spot?.fee?.mode === (feeNow?.mode ?? undefined) && spot?.fee?.pct === feeNow?.pct ? "из настроек «куда»" : "изменено для этой заявки") : "";
  const targetTag = (k: string, t: string) => {
    const x = findTarget(categories, k, t);
    return [x?.wallets.length ? "кошелёк" : "", feeTag(x?.fee)].filter(Boolean).join(" · ");
  };

  const pickTarget = (t: string, k = kind) => {
    const x = findTarget(categories, k, t);
    setTarget(t);
    setWalletName(x?.wallets[0]?.name ?? "");
    setOther(false);
    setFeeMode(x?.fee?.mode ?? "none"); setFeePct(x?.fee ? String(x.fee.pct) : "");
  };
  // Монета задаёт сети: у монеты одна сеть — встаёт сама, иначе выбирать заново.
  const pickCoin = (c: string) => { setCoin(c); setNet(pairs[c]?.length === 1 ? pairs[c][0] : ""); };

  function fill(t: Template) {
    setTplId(t.id); setKind(t.kind); pickTarget(t.target, t.kind);
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
    address: useWallet ? null : address || null, amount: amount.trim() ? num(amount) : null, fee: feeMode === "none" && fee.trim() ? num(fee) : 0,
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
        body: JSON.stringify({ kind, target, ...(feeMode === "none" ? { amount: num(amount), fee: fee.trim() === "" ? null : num(fee) }
          : feeMode === "top" ? { budget: num(amount), feeMode, feePct: num(feePct) } : { amount: num(amount), feeMode, feePct: num(feePct) }),
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
  const ready = target && num(amount) > 0 && (feeMode === "none" ? fee.trim() !== "" : num(feePct) > 0 && num(feePct) < 100)
    && minutes >= 0 && comment.trim() && (useWallet || (net && address));

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

      <form data-tour="topups-form" onSubmit={submit} className="card p-5 sm:p-6 grid gap-3 sm:grid-cols-2">
        <h2 className="text-base font-semibold sm:col-span-2">Новая заявка</h2>
        <div className="flex flex-col gap-1.5 min-w-0">
          <span className="label">Категория</span>
          <Select label="Категория" placeholder="Категория" value={kind}
                  options={categories.map((c) => ({ value: c.name, label: c.name, sub: `${c.targets.length + 1} «куда»` }))}
                  onChange={(k) => { setKind(k); setTarget(""); setWalletName(""); setOther(false); setTplId(""); setFeeMode("none"); }} />
        </div>
        <div className="flex flex-col gap-1.5 min-w-0">
          <span className="label">Куда именно</span>
          <Select label="Куда именно" placeholder="Куда именно" value={target} disabled={!kind}
                  options={targetsOf(categories, kind).map((t) => ({ value: t, label: t, sub: targetTag(kind, t) }))}
                  onChange={(t) => { pickTarget(t); setTplId(""); }} />
        </div>

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
            <div className="flex flex-col gap-1.5 min-w-0">
              <span className="label">Монета</span>
              <Select label="Монета" placeholder="Монета" value={coin} onChange={pickCoin}
                      options={Object.keys(pairs).map((c) => ({ value: c, label: c, sub: pairs[c].join(" · ") }))} />
            </div>
            <div className="flex flex-col gap-1.5 min-w-0">
              <span className="label">Сеть</span>
              <Select label="Сеть" placeholder="Сеть" value={net} onChange={setNet} disabled={!coin}
                      options={Object.entries(networks).map(([n, l]) => ({ value: n, label: l, disabled: !pairs[coin]?.includes(n) }))} />
            </div>
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="label">Адрес получателя</span>
              <input placeholder={net ? ADDRESS[net] : "Сначала монета и сеть"} value={address} onChange={(e) => setAddress(e.target.value.trim())} className="field w-full font-mono" />
            </label>
          </>
        )}
        {other && wallets.length > 0 && (
          <div className="sm:col-span-2 rounded-xl border border-amber-700/50 bg-amber-900/15 px-3.5 py-2.5 text-sm text-amber-200 flex flex-wrap items-center gap-3">
            <span className="flex-1 min-w-[220px]">Адрес не из настроек — проверь его дважды. В чате у заявки будет «вручную, не из настроек».</span>
            <button type="button" className="btn btn-sm" onClick={() => setOther(false)}>Вернуть кошелёк</button>
          </div>
        )}

        <div className="sm:col-span-2 rounded-xl border border-line bg-raised p-3.5 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="label">Комиссия</span>
            <div className="seg" role="group" aria-label="Вид комиссии">
              <button type="button" {...seg(feeMode === "none")} onClick={() => setFeeMode("none")}>Нет</button>
              <button type="button" {...seg(feeMode === "deduct")} onClick={() => { setFeeMode("deduct"); if (!feePct) setFeePct("4.5"); }}>Из суммы</button>
              <button type="button" {...seg(feeMode === "top")} onClick={() => { setFeeMode("top"); if (!feePct) setFeePct("8"); }}>Сверху</button>
            </div>
            {feeMode !== "none" && (
              <label className="flex items-center gap-1.5">
                <input inputMode="decimal" value={feePct} onChange={(e) => setFeePct(e.target.value)} className="field !w-20 text-right" aria-label="Процент комиссии" />
                <span className="text-sm">%</span>
              </label>
            )}
            {feeNote && <span className="text-xs text-hint">{feeNote}</span>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 min-w-0">
              <span className="label">{feeMode === "top" ? `Нужно на бюджет${asset ? `, ${asset}` : ""}` : feeMode === "deduct" ? `Переводим${asset ? `, ${asset}` : ""}` : `Сумма${asset ? `, ${asset}` : ""} — точно до знака`}</span>
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="field w-full text-base font-semibold" />
            </label>
            {feeMode === "none" ? (
              <label className="flex flex-col gap-1.5 min-w-0">
                <span className="label">Комиссия суммой (нет — 0)</span>
                <input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} className="field w-full" />
              </label>
            ) : (
              <div className="flex flex-col gap-1.5 min-w-0">
                <span className="label">{feeMode === "top" ? "Переводим" : "Зайдёт"}</span>
                <div className="rounded-xl border border-violet-600 bg-violet-900/20 px-3.5 py-2 min-h-[2.75rem]">
                  <p className="text-base font-semibold tabular-nums">{money(feeMode === "top" ? calc.amount : calc.net)} {asset}</p>
                  <p className="text-xs text-hint">комиссия {money(calc.fee)} · {feeTag(feeNow!)}</p>
                </div>
              </div>
            )}
          </div>
          {num(amount) > 0 && feeMode !== "none" && (
            <p className="text-xs text-hint">
              {feeMode === "top"
                ? `В чат уйдёт и искаться будет «Переводим» — ${money(calc.amount)}. На бюджет — ${money(calc.net)}.`
                : `В чат уйдёт и искаться будет ${money(calc.amount)}. Платёжка снимет ${feeTag(feeNow!).split(" ")[0]}, зайдёт ${money(calc.net)}.`}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="label">Время на оплату</span>
          <Select label="Время на оплату" placeholder="Время на оплату" value={minutes < 0 ? "" : String(minutes)} onChange={(v) => setMinutes(Number(v))}
                  options={TIMES.map((t) => ({ value: String(t.minutes), label: t.label }))} />
        </div>
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="label">Комментарий</span>
          <textarea placeholder={"Нечего добавить — «-»\nСписок: «- пункт» и Enter — следующий пункт сам. Ссылки станут кликабельными."}
                    value={comment} rows={3} onChange={(e) => setComment(e.target.value)} onKeyDown={listEnter}
                    className="field w-full resize-y min-h-24" />
        </label>
        <div className="sm:col-span-2 flex flex-wrap gap-2.5">
          <button type="submit" disabled={busy || !ready} className="btn btn-primary flex-[1_1_240px]">
            {busy ? "Отправляю…" : calc.amount > 0 ? `Отправить заявку · ${money(calc.amount)} ${asset}` : "Отправить заявку"}
          </button>
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
