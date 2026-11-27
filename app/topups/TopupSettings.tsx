"use client";

import { useMemo, useState } from "react";
import type { Topup } from "@/lib/topups/requests";
import { PAIRS, type Asset, type Network } from "@/lib/topups/chain";
import { newId, OTHER, walletHints, type Category, type Hint, type Target, type Wallet } from "@/lib/topups/config";

// Настройки «Пополнений» — только владельцу (Decision 131; роль проверяет и /api/topups/settings). Категории, «куда»,
// порядок, закреплённые кошельки и «только эти кошельки». Правки копятся в черновике, «Сохранить» — всё разом.

const clone = (c: Category[]): Category[] => JSON.parse(JSON.stringify(c));
const short = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);
const swap = <T,>(list: T[], i: number, d: number) => {
  const j = i + d;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
};

function Arrows({ onUp, onDown, what }: { onUp: () => void; onDown: () => void; what: string }) {
  const icon = (d: string) => (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
  );
  return (
    <>
      <button type="button" className="btn btn-sm !px-2" aria-label={`${what} выше`} onClick={onUp}>{icon("M18 15l-6-6-6 6")}</button>
      <button type="button" className="btn btn-sm !px-2" aria-label={`${what} ниже`} onClick={onDown}>{icon("M6 9l6 6 6-6")}</button>
    </>
  );
}

export default function TopupSettings({ categories, rows, onSaved }: { categories: Category[]; rows: Topup[]; onSaved: (c: Category[]) => void }) {
  const [draft, setDraft] = useState(() => clone(categories));
  const [sel, setSel] = useState<string | null>(categories[0]?.targets[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(categories);
  const hints = useMemo(() => walletHints(rows, draft), [rows, draft]);
  const cat = draft.find((c) => c.targets.some((t) => t.id === sel));
  const target = cat?.targets.find((t) => t.id === sel);

  // Любая правка — по копии черновика.
  const edit = (fn: (d: Category[]) => void) => { setDraft((prev) => { const d = clone(prev); fn(d); return d; }); setMsg(null); };
  const onTarget = (fn: (t: Target) => void) => edit((d) => { const t = d.flatMap((c) => c.targets).find((x) => x.id === sel); if (t) fn(t); });
  const onWallet = (i: number, patch: Partial<Wallet>) => onTarget((t) => {
    const w = { ...t.wallets[i], ...patch };
    if (patch.asset && !PAIRS[w.asset].includes(w.network)) w.network = PAIRS[w.asset][0];
    t.wallets[i] = w;
  });

  function applyHint(h: Hint) {
    const wallet: Wallet = { name: "Основной", asset: h.asset, network: h.network, address: h.address };
    const id = newId();
    edit((d) => {
      const c = d.find((x) => x.name === h.kind);
      if (!c) return;
      if (h.make) c.targets.push({ id, name: "Новое «куда» — назови", wallets: [wallet] });
      else c.targets.find((t) => t.name === h.target)?.wallets.push(wallet);
    });
    setSel(h.make ? id : draft.find((c) => c.name === h.kind)?.targets.find((t) => t.name === h.target)?.id ?? sel);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/topups/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ categories: draft }) });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.categories) throw new Error(d?.error ?? "Не получилось — попробуй ещё раз");
      onSaved(d.categories);
      setDraft(clone(d.categories));
      setMsg({ ok: true, text: "Сохранено. Форма заявки уже с новым списком и кошельками." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Сеть не ответила" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-hint">Вкладку видит и меняет только владелец. Остальные получают готовый список в форме заявки.</p>

      {hints.length > 0 && (
        <section className="card p-5 sm:p-6 space-y-2.5" aria-label="Подсказки из истории">
          <h2 className="text-base font-semibold">Частые адреса из истории заявок</h2>
          {hints.map((h) => (
            <div key={`${h.kind}${h.target}${h.address}`} className="rounded-xl border border-line bg-raised px-4 py-3 flex flex-wrap items-center gap-3">
              <p className="text-sm text-zinc-300 flex-1 min-w-[220px]">
                {h.make
                  ? <>{h.kind} · {OTHER} — {h.n} из {h.of} заявок на один адрес. Похоже на отдельное «куда».</>
                  : <>{h.kind} · {h.target} — {h.n} из {h.of} заявок ушли на один адрес.</>}
                {" "}<span className="font-mono text-hint">{h.asset} {h.network} · {short(h.address)}</span>
              </p>
              <button type="button" className="btn btn-sm" onClick={() => applyHint(h)}>{h.make ? "Сделать «куда»" : "Закрепить"}</button>
            </div>
          ))}
        </section>
      )}

      <div className="grid md:grid-cols-2 gap-4 items-start">
        <section className="card p-5 sm:p-6 min-w-0" aria-label="Категории и куда">
          <div className="flex items-center gap-2 mb-2">
            <h2 className="text-base font-semibold flex-1">Категории и «куда»</h2>
            <button type="button" className="btn btn-sm" onClick={() => edit((d) => { d.push({ id: newId(), name: "Новая категория", targets: [] }); })}>+ Категория</button>
          </div>
          {draft.map((c, ci) => (
            <div key={c.id} className="border-t border-line first:border-t-0 pt-3 pb-1.5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <input value={c.name} onChange={(e) => edit((d) => { d[ci].name = e.target.value; })} aria-label="Название категории"
                       className="field flex-1 min-w-0 !min-h-9 font-semibold" />
                <Arrows what="Категорию" onUp={() => edit((d) => swap(d, ci, -1))} onDown={() => edit((d) => swap(d, ci, 1))} />
                <button type="button" className="btn btn-sm" onClick={() => {
                  const id = newId();
                  edit((d) => { d[ci].targets.push({ id, name: "Новое «куда»", wallets: [] }); });
                  setSel(id);
                }}>+ Куда</button>
                {c.targets.length === 0 && (
                  <button type="button" className="btn btn-sm border-red-800/50 text-red-300" onClick={() => edit((d) => { d.splice(ci, 1); })}>Убрать</button>
                )}
              </div>
              {c.targets.map((t, ti) => (
                <div key={t.id} className="flex items-center gap-1">
                  <button type="button" aria-pressed={t.id === sel} onClick={() => setSel(t.id)}
                          className={`flex-1 min-w-0 flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm
                            ${t.id === sel ? "border-violet-500 bg-violet-900/20" : "border-transparent hover:bg-raised"}`}>
                    <span className="flex-1 min-w-0 truncate">{t.name}</span>
                    <span className={`text-xs shrink-0 ${t.wallets.length ? "text-violet-300" : "text-hint"}`}>
                      {t.wallets.length === 0 ? "адрес вручную" : t.wallets.length === 1 ? `${t.wallets[0].network} · ${short(t.wallets[0].address)}` : `${t.wallets.length} кошелька`}
                    </span>
                  </button>
                  <Arrows what="«Куда»" onUp={() => edit((d) => swap(d[ci].targets, ti, -1))} onDown={() => edit((d) => swap(d[ci].targets, ti, 1))} />
                </div>
              ))}
              <p className="text-xs text-hint mt-1 px-2.5">{OTHER} — всегда последним, его не меняют</p>
            </div>
          ))}
        </section>

        <section className="card p-5 sm:p-6 min-w-0 space-y-3.5" aria-label="Редактор «куда»">
          {!target || !cat ? <p className="text-sm text-hint">Выбери «куда» слева.</p> : (
            <>
              <div>
                <p className="label">{cat.name}</p>
                <h2 className="text-lg font-semibold mt-0.5 break-words">{target.name || "Без названия"}</h2>
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="label">Название в форме</span>
                <input className="field" value={target.name} onChange={(e) => onTarget((t) => { t.name = e.target.value; })} />
              </label>
              <p className="text-xs text-hint -mt-2">Переименуешь — имя поменяется и в старых заявках и шаблонах, чтобы в аналитике не было двух строк.</p>

              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold flex-1">Закреплённые кошельки</h3>
                <button type="button" className="btn btn-sm" onClick={() => onTarget((t) => {
                  t.wallets.push({ name: t.wallets.length ? "Запасной" : "Основной", asset: "USDT", network: "TRC20", address: "" });
                })}>+ Кошелёк</button>
              </div>
              {target.wallets.length === 0 && <p className="text-sm text-hint">Кошелька нет — в форме адрес вводят руками.</p>}
              {target.wallets.map((w, i) => (
                <div key={i} className="rounded-xl border border-line bg-raised p-3.5 grid grid-cols-3 gap-2.5">
                  <label className="flex flex-col gap-1.5 min-w-0">
                    <span className="label">Подпись</span>
                    <input className="field" value={w.name} onChange={(e) => onWallet(i, { name: e.target.value })} />
                  </label>
                  <label className="flex flex-col gap-1.5 min-w-0">
                    <span className="label">Монета</span>
                    <select className="field" value={w.asset} onChange={(e) => onWallet(i, { asset: e.target.value as Asset })}>
                      {Object.keys(PAIRS).map((a) => <option key={a}>{a}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1.5 min-w-0">
                    <span className="label">Сеть</span>
                    <select className="field" value={w.network} onChange={(e) => onWallet(i, { network: e.target.value as Network })}>
                      {PAIRS[w.asset].map((n) => <option key={n}>{n}</option>)}
                    </select>
                  </label>
                  <label className="col-span-3 flex flex-col gap-1.5">
                    <span className="label">Адрес</span>
                    <input className="field font-mono" placeholder="T… / 0x… / UQ…" value={w.address} onChange={(e) => onWallet(i, { address: e.target.value.trim() })} />
                  </label>
                  <div className="col-span-3 flex justify-end">
                    <button type="button" className="btn btn-sm border-red-800/50 text-red-300" onClick={() => onTarget((t) => { t.wallets.splice(i, 1); if (!t.wallets.length) t.only = false; })}>
                      Убрать кошелёк
                    </button>
                  </div>
                </div>
              ))}
              <label className={`flex items-start gap-2.5 text-sm ${target.wallets.length ? "cursor-pointer" : "opacity-50"}`}>
                <input type="checkbox" className="mt-0.5 w-4 h-4 accent-violet-500" disabled={!target.wallets.length}
                       checked={Boolean(target.only)} onChange={(e) => onTarget((t) => { t.only = e.target.checked; })} />
                <span>Только эти кошельки<br /><span className="text-xs text-hint">В форме нет «Другой адрес»: перевести можно только на кошелёк отсюда.</span></span>
              </label>
              <div className="border-t border-line pt-3.5">
                <button type="button" className="btn btn-sm border-red-800/50 text-red-300" onClick={() => { edit((d) => { const c = d.find((x) => x.id === cat.id); if (c) c.targets = c.targets.filter((t) => t.id !== sel); }); setSel(null); }}>
                  Убрать «{target.name}» из формы
                </button>
                <p className="text-xs text-hint mt-2">Убранное пропадает из формы после «Сохранить». Старые заявки и аналитика остаются как были.</p>
              </div>
            </>
          )}
        </section>
      </div>

      {(dirty || msg) && (
        <div className="sticky bottom-4 z-30 card p-4 flex flex-wrap items-center gap-3 border-violet-600">
          <p className={`text-sm flex-1 min-w-[200px] ${msg ? (msg.ok ? "text-green-300" : "text-red-300") : "text-zinc-300"}`}>
            {msg ? msg.text : "Есть несохранённые изменения."}
          </p>
          {dirty && <button type="button" className="btn" disabled={busy} onClick={() => { setDraft(clone(categories)); setMsg(null); }}>Отменить изменения</button>}
          {dirty && <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Сохраняю…" : "Сохранить"}</button>}
        </div>
      )}
    </div>
  );
}
