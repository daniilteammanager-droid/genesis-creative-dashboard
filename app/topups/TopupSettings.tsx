"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Topup } from "@/lib/topups/requests";
import { PAIRS, type Asset, type Network } from "@/lib/topups/chain";
import { newId, OTHER, walletHints, type Category, type Hint, type Target, type Wallet } from "@/lib/topups/config";

// Настройки «Пополнений» — только владельцу (Decision 131; роль проверяет и /api/topups/settings). Категории, «куда»,
// порядок, закреплённые кошельки и «только эти кошельки». «Куда» настраивается прямо под своей строкой, порядок —
// перетаскиванием за шесть точек (или стрелками с клавиатуры на них). Правки копятся в черновике, «Сохранить» — всё разом.

const clone = (c: Category[]): Category[] => JSON.parse(JSON.stringify(c));
const short = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);
const move = <T,>(list: T[], from: number, to: number) => { const [x] = list.splice(from, 1); list.splice(to, 0, x); };

// Перетаскивание за ручку (pointer-события: мышь и палец, без HTML5 drag). Строка поднимается и едет за указателем,
// соседи плавно расступаются туда, куда она встанет; порядок меняется один раз — когда отпустили. У края экрана
// страница прокручивается сама. Строки — дети списка с data-row; их места запоминаются в начале перетаскивания.
interface Drag { list: string; from: number; over: number; dy: number; size: number }
function useSort(onDrop: (list: string, from: number, to: number) => void) {
  const [drag, setDrag] = useState<Drag | null>(null);
  function start(e: React.PointerEvent, list: string, index: number, box: HTMLElement | null) {
    if (!box || e.button !== 0) return;
    e.preventDefault();
    const rows = [...box.children].filter((r) => (r as HTMLElement).dataset.row !== undefined) as HTMLElement[];
    const tops = rows.map((r) => r.getBoundingClientRect().top + window.scrollY);
    const sizes = rows.map((r) => r.getBoundingClientRect().height);
    const y0 = e.clientY, s0 = window.scrollY;
    let last = e.clientY, over = index, raf = 0;
    const update = () => {
      const dy = last - y0 + (window.scrollY - s0);
      const center = tops[index] + sizes[index] / 2 + dy;
      over = tops.reduce((n, t, i) => (i !== index && t + sizes[i] / 2 < center ? n + 1 : n), 0);
      setDrag({ list, from: index, over, dy, size: sizes[index] });
    };
    const tick = () => {
      const edge = 80;
      const v = last < edge ? -(edge - last) / 5 : last > window.innerHeight - edge ? (last - window.innerHeight + edge) / 5 : 0;
      if (v) { window.scrollBy(0, v); update(); }
      raf = requestAnimationFrame(tick);
    };
    const moved = (ev: PointerEvent) => { last = ev.clientY; update(); };
    const done = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", moved); window.removeEventListener("pointerup", done); window.removeEventListener("pointercancel", done);
      document.body.style.userSelect = "";
      setDrag(null);
      if (over !== index) onDrop(list, index, over);
    };
    window.addEventListener("pointermove", moved); window.addEventListener("pointerup", done); window.addEventListener("pointercancel", done);
    document.body.style.userSelect = "none";
    raf = requestAnimationFrame(tick);
    setDrag({ list, from: index, over: index, dy: 0, size: sizes[index] });
  }
  // Сдвиг строки i: перетаскиваемая — за указателем, соседи между старым и новым местом — на её высоту.
  function style(list: string, i: number): React.CSSProperties | undefined {
    if (!drag || drag.list !== list) return undefined;
    if (i === drag.from) return { transform: `translateY(${drag.dy}px)`, position: "relative", zIndex: 20 };
    const shift = drag.from < drag.over && i > drag.from && i <= drag.over ? -drag.size
      : drag.from > drag.over && i >= drag.over && i < drag.from ? drag.size : 0;
    return { transform: `translateY(${shift}px)`, transition: "transform 160ms ease" };
  }
  const lifted = (list: string, i: number) => drag?.list === list && drag.from === i;
  return { start, style, lifted, active: Boolean(drag) };
}

function Grip({ label, on, onPointerDown, onKey }: { label: string; on: boolean; onPointerDown: (e: React.PointerEvent) => void; onKey: (d: number) => void }) {
  return (
    <button type="button" aria-label={`Перетащить ${label}. Стрелки вверх и вниз — переставить`} title="Потяни, чтобы переставить"
            onPointerDown={onPointerDown} onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); onKey(e.key === "ArrowUp" ? -1 : 1); } }}
            className={`shrink-0 w-7 h-9 flex items-center justify-center rounded-md cursor-grab active:cursor-grabbing touch-none
              ${on ? "text-violet-300 bg-violet-900/30" : "text-hint hover:text-zinc-200 hover:bg-raised"}`}>
      <svg viewBox="0 0 10 16" className="w-2.5 h-4" fill="currentColor" aria-hidden="true">
        {[2, 8, 14].flatMap((y) => [2, 8].map((x) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.6" />))}
      </svg>
    </button>
  );
}

export default function TopupSettings({ categories, rows, onSaved }: { categories: Category[]; rows: Topup[]; onSaved: (c: Category[]) => void }) {
  const [draft, setDraft] = useState(() => clone(categories));
  const [open, setOpen] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);   // только что добавленное «куда» — фокус на название
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const catsRef = useRef<HTMLDivElement>(null);
  const lists = useRef(new Map<string, HTMLDivElement>());
  // Отпустили строку — переставить в черновике: категории (список "cats") или «куда» категории (список — её id).
  const sort = useSort((list, from, to) => edit((d) => {
    if (list === "cats") move(d, from, to);
    else { const c = d.find((x) => x.id === list); if (c) move(c.targets, from, to); }
  }));

  const dirty = JSON.stringify(draft) !== JSON.stringify(categories);
  const hints = useMemo(() => walletHints(rows, draft), [rows, draft]);

  // Открытое «куда» — в поле зрения; новое — сразу с курсором в названии.
  useEffect(() => {
    if (!open) return;
    const el = document.getElementById(`target-${open}`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    if (fresh === open) { el?.querySelector<HTMLInputElement>("input")?.select(); setFresh(null); }
  }, [open, fresh]);

  // Любая правка — по копии черновика.
  const edit = (fn: (d: Category[]) => void) => { setDraft((prev) => { const d = clone(prev); fn(d); return d; }); setMsg(null); };
  const onTarget = (id: string, fn: (t: Target) => void) => edit((d) => { const t = d.flatMap((c) => c.targets).find((x) => x.id === id); if (t) fn(t); });
  const onWallet = (id: string, i: number, patch: Partial<Wallet>) => onTarget(id, (t) => {
    const w = { ...t.wallets[i], ...patch };
    if (patch.asset && !PAIRS[w.asset].includes(w.network)) w.network = PAIRS[w.asset][0];
    t.wallets[i] = w;
  });
  const addTarget = (catId: string, name = "Новое «куда»", wallets: Wallet[] = []) => {
    const id = newId();
    edit((d) => { d.find((c) => c.id === catId)?.targets.push({ id, name, wallets }); });
    setOpen(id); setFresh(id);
  };

  function applyHint(h: Hint) {
    const wallet: Wallet = { name: "Основной", asset: h.asset, network: h.network, address: h.address };
    const c = draft.find((x) => x.name === h.kind);
    if (!c) return;
    if (h.make) return addTarget(c.id, "Новое «куда» — назови", [wallet]);
    const t = c.targets.find((x) => x.name === h.target);
    if (!t) return;
    onTarget(t.id, (x) => { x.wallets.push(wallet); });
    setOpen(t.id);
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

  // Редактор «куда» — прямо под его строкой.
  const editor = (cat: Category, t: Target) => (
    <div className="mx-1 mb-2 mt-1 rounded-xl border border-violet-600/60 bg-raised p-3.5 space-y-3">
      <label className="flex flex-col gap-1.5">
        <span className="label">Название в форме</span>
        <input className="field" value={t.name} onChange={(e) => onTarget(t.id, (x) => { x.name = e.target.value; })} />
      </label>
      <p className="text-xs text-hint -mt-1.5">Переименуешь — имя поменяется и в старых заявках и шаблонах, чтобы в аналитике не было двух строк.</p>

      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold flex-1">Закреплённые кошельки</h3>
        <button type="button" className="btn btn-sm" onClick={() => onTarget(t.id, (x) => {
          x.wallets.push({ name: x.wallets.length ? "Запасной" : "Основной", asset: "USDT", network: "TRC20", address: "" });
        })}>+ Кошелёк</button>
      </div>
      {t.wallets.length === 0 && <p className="text-sm text-hint">Кошелька нет — в форме адрес вводят руками.</p>}
      {t.wallets.map((w, i) => (
        <div key={i} className="rounded-xl border border-line bg-panel p-3 grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          <label className="col-span-2 sm:col-span-1 flex flex-col gap-1.5 min-w-0">
            <span className="label">Подпись</span>
            <input className="field" value={w.name} onChange={(e) => onWallet(t.id, i, { name: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1.5 min-w-0">
            <span className="label">Монета</span>
            <select className="field" value={w.asset} onChange={(e) => onWallet(t.id, i, { asset: e.target.value as Asset })}>
              {Object.keys(PAIRS).map((a) => <option key={a}>{a}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 min-w-0">
            <span className="label">Сеть</span>
            <select className="field" value={w.network} onChange={(e) => onWallet(t.id, i, { network: e.target.value as Network })}>
              {PAIRS[w.asset].map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
          <label className="col-span-2 sm:col-span-3 flex flex-col gap-1.5">
            <span className="label">Адрес</span>
            <input className="field font-mono" placeholder="T… / 0x… / UQ…" value={w.address} onChange={(e) => onWallet(t.id, i, { address: e.target.value.trim() })} />
          </label>
          <div className="col-span-2 sm:col-span-3 flex justify-end">
            <button type="button" className="btn btn-sm border-red-800/50 text-red-300" onClick={() => onTarget(t.id, (x) => { x.wallets.splice(i, 1); if (!x.wallets.length) x.only = false; })}>
              Убрать кошелёк
            </button>
          </div>
        </div>
      ))}
      <label className={`flex items-start gap-2.5 text-sm ${t.wallets.length ? "cursor-pointer" : "opacity-50"}`}>
        <input type="checkbox" className="mt-0.5 w-4 h-4 accent-violet-500" disabled={!t.wallets.length}
               checked={Boolean(t.only)} onChange={(e) => onTarget(t.id, (x) => { x.only = e.target.checked; })} />
        <span>Только эти кошельки<br /><span className="text-xs text-hint">В форме нет «Другой адрес»: перевести можно только на кошелёк отсюда.</span></span>
      </label>
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || !dirty} onClick={save}>{busy ? "Сохраняю…" : "Сохранить"}</button>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(null)}>Свернуть</button>
        <span className="flex-1" />
        <button type="button" className="btn btn-sm border-red-800/50 text-red-300"
                onClick={() => { edit((d) => { const c = d.find((x) => x.id === cat.id); if (c) c.targets = c.targets.filter((x) => x.id !== t.id); }); setOpen(null); }}>
          Убрать из формы
        </button>
      </div>
      <p className="text-xs text-hint">Убранное пропадает из формы после «Сохранить». Старые заявки и аналитика остаются как были.</p>
    </div>
  );

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

      <section className="card p-5 sm:p-6" aria-label="Категории и куда">
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-base font-semibold flex-1">Категории и «куда»</h2>
          <button type="button" className="btn btn-sm" onClick={() => edit((d) => { d.push({ id: newId(), name: "Новая категория", targets: [] }); })}>+ Категория</button>
        </div>
        <p className="text-xs text-hint mb-3">Нажми на «куда» — настройки откроются под ним. Порядок — потяни за шесть точек слева.</p>
        <div ref={catsRef}>
          {draft.map((c, ci) => (
            <div key={c.id} data-row="" style={sort.style("cats", ci)}
                 className={`border-t border-line first:border-t-0 py-3 ${sort.lifted("cats", ci) ? "rounded-xl bg-raised px-2 shadow-2xl ring-1 ring-violet-500" : ""}`}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Grip label={`категорию «${c.name}»`} on={sort.lifted("cats", ci)}
                      onPointerDown={(e) => sort.start(e, "cats", ci, catsRef.current)}
                      onKey={(dd) => edit((d) => { if (ci + dd >= 0 && ci + dd < d.length) move(d, ci, ci + dd); })} />
                <input value={c.name} onChange={(e) => edit((d) => { d[ci].name = e.target.value; })} aria-label="Название категории"
                       className="field flex-1 min-w-0 !min-h-9 font-semibold" />
                <button type="button" className="btn btn-sm" onClick={() => addTarget(c.id)}>+ Куда</button>
                {c.targets.length === 0 && (
                  <button type="button" className="btn btn-sm border-red-800/50 text-red-300" onClick={() => edit((d) => { d.splice(ci, 1); })}>Убрать</button>
                )}
              </div>
              <div ref={(el) => { if (el) lists.current.set(c.id, el); else lists.current.delete(c.id); }}>
                {c.targets.map((t, ti) => (
                  <div key={t.id} id={`target-${t.id}`} data-row="" style={sort.style(c.id, ti)}
                       className={sort.lifted(c.id, ti) ? "rounded-xl bg-raised shadow-2xl ring-1 ring-violet-500" : ""}>
                    <div className="flex items-center gap-1">
                      <Grip label={`«${t.name}»`} on={sort.lifted(c.id, ti)}
                            onPointerDown={(e) => sort.start(e, c.id, ti, lists.current.get(c.id) ?? null)}
                            onKey={(dd) => edit((d) => { const l = d[ci].targets; if (ti + dd >= 0 && ti + dd < l.length) move(l, ti, ti + dd); })} />
                      <button type="button" aria-expanded={open === t.id} onClick={() => setOpen(open === t.id ? null : t.id)}
                              className={`flex-1 min-w-0 flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm
                                ${open === t.id ? "border-violet-500 bg-violet-900/20" : "border-transparent hover:bg-raised"}`}>
                        <span className="flex-1 min-w-0 truncate">{t.name || "Без названия"}</span>
                        <span className={`text-xs shrink-0 ${t.wallets.length ? "text-violet-300" : "text-hint"}`}>
                          {t.wallets.length === 0 ? "адрес вручную" : t.wallets.length === 1 ? `${t.wallets[0].network} · ${short(t.wallets[0].address)}` : `${t.wallets.length} кошелька`}
                          {t.only && " · только эти"}
                        </span>
                        <span className="text-hint text-xs" aria-hidden="true">{open === t.id ? "▴" : "▾"}</span>
                      </button>
                    </div>
                    {open === t.id && editor(c, t)}
                  </div>
                ))}
              </div>
              <p className="text-xs text-hint mt-1 pl-9">{OTHER} — всегда последним, его не меняют</p>
            </div>
          ))}
        </div>
      </section>

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
