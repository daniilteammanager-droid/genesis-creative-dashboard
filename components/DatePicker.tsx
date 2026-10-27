"use client";

import { useEffect, useRef, useState } from "react";
import { MONTHS, WEEKDAYS, monthGrid, rangeLabel, dayLabel, shiftMonth, ymOf } from "@/lib/calendar";
import { mskDay } from "@/lib/day";

// Календарь Genesis вместо системного <input type="date">: кнопка с
// периодом, по клику — месяцы с выбором диапазона. На ПК — два месяца под кнопкой, на
// телефоне — один, шторкой снизу. Даты — ГГГГ-ММ-ДД, «сегодня» — по Москве.

interface Common { min?: string; max?: string; className?: string }

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open, close]);
  return ref;
}

// У правого края окна календарь открывается влево от кнопки, а не за экран.
const side = (el: HTMLElement | null, width: number) =>
  el && el.getBoundingClientRect().left + width > window.innerWidth - 12 ? "sm:right-0" : "sm:left-0";

const Icon = () => (
  <svg viewBox="0 0 20 20" className="w-4 h-4 shrink-0 text-violet-300" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <rect x="3" y="4.5" width="14" height="12" rx="2.5" /><path d="M3 8.5h14M7 2.8v3.4M13 2.8v3.4" strokeLinecap="round" />
  </svg>
);

const trigger = "inline-flex items-center gap-2 bg-[#0d0b14] border border-violet-900/40 hover:border-violet-600/60 rounded-xl px-3 py-2 text-sm text-white transition whitespace-nowrap";
const panel = "z-[80] bg-[#111118] border border-violet-800/50 rounded-2xl shadow-2xl shadow-violet-950/60 p-3 " +
  "fixed inset-x-3 bottom-3 sm:absolute sm:inset-x-auto sm:bottom-auto sm:top-full sm:mt-2";

function Month({ y, m, cell, onPick, onHover, nav }: {
  y: number; m: number; cell: (iso: string) => string; onPick: (iso: string) => void; onHover?: (iso: string | null) => void;
  nav?: { prev?: () => void; next?: () => void; prevPhoneOnly?: boolean };
}) {
  return (
    <div className="w-full sm:w-[252px]">
      <div className="flex items-center justify-between mb-2 px-1">
        <button type="button" onClick={nav?.prev} className={`w-8 h-8 rounded-lg text-zinc-400 hover:bg-violet-900/30 hover:text-white ${nav?.prev ? (nav.prevPhoneOnly ? "sm:invisible" : "") : "invisible"}`} aria-label="Предыдущий месяц">‹</button>
        <span className="text-sm font-semibold text-white capitalize">{MONTHS[m]} {y}</span>
        <button type="button" onClick={nav?.next} className={`w-8 h-8 rounded-lg text-zinc-400 hover:bg-violet-900/30 hover:text-white ${nav?.next ? "" : "invisible"}`} aria-label="Следующий месяц">›</button>
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center" onMouseLeave={() => onHover?.(null)}>
        {WEEKDAYS.map((w, i) => <span key={w} className={`text-[11px] uppercase pb-1 ${i > 4 ? "text-violet-400/70" : "text-zinc-600"}`}>{w}</span>)}
        {monthGrid(y, m).map((d) => (
          <button key={d.iso} type="button" onClick={() => onPick(d.iso)} onMouseEnter={() => onHover?.(d.iso)}
                  className={`h-9 text-sm transition ${d.inMonth ? "" : "opacity-35"} ${cell(d.iso)}`}>{d.day}</button>
        ))}
      </div>
    </div>
  );
}

// Период: since — until. Первый клик — начало, второй — конец (раньше начала — новое начало).
export function DateRange({ since, until, onChange, min, max = mskDay(), className = "" }: Common & {
  since: string; until: string; onChange: (since: string, until: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState(() => ymOf(until));
  const [align, setAlign] = useState("sm:left-0");
  const close = () => { setOpen(false); setStart(null); setHover(null); };
  const ref = useOutside(open, close);

  const toggle = () => { if (open) close(); else { setView(ymOf(until)); setAlign(side(ref.current, 560)); setOpen(true); } };
  const off = (d: string) => Boolean((min && d < min) || (max && d > max));
  const [a, b] = start ? [start, hover && hover >= start ? hover : start].sort() : [since, until];
  const today = mskDay();
  const cell = (d: string) => {
    if (off(d)) return "text-zinc-700 cursor-not-allowed rounded-lg";
    const edge = d === a || d === b, inside = d > a && d < b;
    return edge
      ? `bg-gradient-to-br from-violet-500 to-violet-700 text-white font-semibold shadow-md shadow-violet-900/50 ${d === a && d === b ? "rounded-lg" : d === a ? "rounded-l-lg" : "rounded-r-lg"}`
      : inside ? "bg-violet-600/20 text-violet-100"
      : `rounded-lg text-zinc-200 hover:bg-violet-900/40 ${d === today ? "ring-1 ring-inset ring-violet-500/70" : ""}`;
  };
  const pick = (d: string) => {
    if (off(d)) return;
    if (!start || d < start) return void setStart(d);
    onChange(start, d);
    close();
  };
  const left = shiftMonth(view.y, view.m, -1);
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button type="button" onClick={toggle} className={trigger} aria-haspopup="dialog" aria-expanded={open}>
        <Icon />{rangeLabel(since, until)}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 bg-black/50 z-[79] sm:hidden" onClick={close} />
          <div role="dialog" aria-label="Выбор периода" className={`${panel} ${align}`}>
            <div className="flex gap-4">
              <div className="hidden sm:block">
                <Month y={left.y} m={left.m} cell={cell} onPick={pick} onHover={setHover} nav={{ prev: () => setView(shiftMonth(view.y, view.m, -1)) }} />
              </div>
              <Month y={view.y} m={view.m} cell={cell} onPick={pick} onHover={setHover}
                     nav={{ prev: () => setView(shiftMonth(view.y, view.m, -1)), next: () => setView(shiftMonth(view.y, view.m, 1)), prevPhoneOnly: true }} />
            </div>
            <p className="text-[11px] text-zinc-500 mt-2 px-1">{start ? `С ${dayLabel(start)} — выбери последний день` : "Выбери первый и последний день периода"}</p>
          </div>
        </>
      )}
    </div>
  );
}

// Один день.
export function DatePicker({ value, onChange, min, max, className = "" }: Common & { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => ymOf(value || mskDay()));
  const [align, setAlign] = useState("sm:left-0");
  const ref = useOutside(open, () => setOpen(false));
  const today = mskDay();
  const off = (d: string) => Boolean((min && d < min) || (max && d > max));
  const cell = (d: string) => off(d) ? "text-zinc-700 cursor-not-allowed rounded-lg"
    : d === value ? "rounded-lg bg-gradient-to-br from-violet-500 to-violet-700 text-white font-semibold shadow-md shadow-violet-900/50"
    : `rounded-lg text-zinc-200 hover:bg-violet-900/40 ${d === today ? "ring-1 ring-inset ring-violet-500/70" : ""}`;
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button type="button" onClick={() => { setView(ymOf(value || today)); setAlign(side(ref.current, 280)); setOpen((v) => !v); }} className={trigger} aria-haspopup="dialog" aria-expanded={open}>
        <Icon />{value ? dayLabel(value) : "Выбрать дату"}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 bg-black/50 z-[79] sm:hidden" onClick={() => setOpen(false)} />
          <div role="dialog" aria-label="Выбор даты" className={`${panel} ${align}`}>
            <Month y={view.y} m={view.m} cell={cell} onPick={(d) => { if (!off(d)) { onChange(d); setOpen(false); } }}
                   nav={{ prev: () => setView(shiftMonth(view.y, view.m, -1)), next: () => setView(shiftMonth(view.y, view.m, 1)) }} />
            <div className="flex justify-between mt-2 px-1">
              <button type="button" onClick={() => { if (!off(today)) { onChange(today); setOpen(false); } }} className="text-xs text-violet-300 hover:text-white">Сегодня</button>
              <button type="button" onClick={() => setOpen(false)} className="text-xs text-zinc-500 hover:text-zinc-300">Закрыть</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
