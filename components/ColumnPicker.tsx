"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

// Выбор столбцов таблицы, как у Артёма: галочка — показать, ↑ ↓ — порядок. Live Manager и Отчёты.

// Свой порядок — по списку order; столбцов, которых в нём нет (новых), — в конце, в исходном порядке.
export function orderCols<T extends { label: string }>(all: T[], order: string[]): T[] {
  const at = (l: string) => { const i = order.indexOf(l); return i < 0 ? 999 + all.findIndex((c) => c.label === l) : i; };
  return [...all].sort((a, b) => at(a.label) - at(b.label));
}
// Столбец на одну позицию выше или ниже; на краю — null.
export function shiftCol(labels: string[], label: string, d: -1 | 1): string[] | null {
  const list = [...labels], i = list.indexOf(label), j = i + d;
  if (i < 0 || j < 0 || j >= list.length) return null;
  [list[i], list[j]] = [list[j], list[i]];
  return list;
}

// children — строка над списком (наборы столбцов Live Manager).
export function ColumnPicker({ labels, hidden, onToggle, onMove, children }: {
  labels: string[]; hidden: Set<string>; onToggle: (label: string) => void; onMove: (label: string, d: -1 | 1) => void; children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className={`btn border-line text-zinc-300 hover:bg-violet-900/20`}>☷ Столбцы</button>
      {open && (
        <div className="absolute z-30 mt-1 w-56 max-h-80 overflow-y-auto bg-card border border-line rounded-xl p-2 shadow-xl">
          {children && <div className="flex items-center gap-1 px-1 pb-2 mb-1 border-b border-line">{children}</div>}
          {labels.map((l, i) => (
            <div key={l} className="flex items-center gap-1 px-2 py-1 text-sm text-zinc-300 hover:bg-violet-900/15 rounded">
              <label className="flex flex-1 items-center gap-2 cursor-pointer min-w-0">
                <input type="checkbox" checked={!hidden.has(l)} onChange={() => onToggle(l)} className="accent-violet-500" /><span className="truncate">{l}</span>
              </label>
              <button type="button" disabled={i === 0} onClick={() => onMove(l, -1)} className="text-hint hover:text-white disabled:opacity-20 px-0.5" aria-label="Выше">↑</button>
              <button type="button" disabled={i === labels.length - 1} onClick={() => onMove(l, 1)} className="text-hint hover:text-white disabled:opacity-20 px-0.5" aria-label="Ниже">↓</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Свои столбцы в этом браузере: скрытые и порядок под ключом key. Читаются после первой
// отрисовки — сервер их не знает, иначе разметка разойдётся при гидратации.
type Prefs = { hidden: string[]; order: string[] };
const NONE: Prefs = { hidden: [], order: [] };
export function useColumns<T extends { label: string }>(key: string, all: T[]) {
  const [prefs, setPrefs] = useState<Prefs>(NONE);
  useEffect(() => {
    try { setPrefs({ ...NONE, ...(JSON.parse(localStorage.getItem(key) ?? "{}") as Partial<Prefs>) }); } catch { /* приватное окно */ }
  }, [key]);
  const save = (f: (p: Prefs) => Prefs) => setPrefs((p) => {
    const next = f(p);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* приватное окно — без запоминания */ }
    return next;
  });
  const ordered = useMemo(() => orderCols(all, prefs.order), [all, prefs.order]);
  const hidden = useMemo(() => new Set(prefs.hidden), [prefs.hidden]);
  return {
    ordered, hidden, visible: ordered.filter((c) => !hidden.has(c.label)),
    toggle: (l: string) => save((p) => ({ ...p, hidden: p.hidden.includes(l) ? p.hidden.filter((x) => x !== l) : [...p.hidden, l] })),
    move: (l: string, d: -1 | 1) => save((p) => ({ ...p, order: shiftCol(ordered.map((c) => c.label), l, d) ?? p.order })),
  };
}
