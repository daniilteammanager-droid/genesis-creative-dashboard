"use client";

import { useEffect, useId, useRef, useState } from "react";

// Выпадающий список Genesis вместо системного <select> (27.11.2026, Даниил: «хотел красивые выпадающие списки, сейчас
// стандартные»). Кнопка как поле, список — тёмная панель под ней (или над, если снизу не влезает), выбранное — с галочкой,
// справа у пункта — подпись. Клавиатура: стрелки, Enter, Escape. Закрывается кликом мимо.

export interface Option { value: string; label: string; sub?: string; disabled?: boolean }

const Check = () => (
  <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4.5 10.5l3.5 3.5 7.5-8" />
  </svg>
);

export default function Select({ value, onChange, options, placeholder = "Выбери", label, sub, disabled, className = "" }: {
  value: string; onChange: (v: string) => void; options: Option[]; placeholder?: string; label?: string;
  sub?: string; disabled?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [up, setUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const current = options.find((o) => o.value === value);
  const shownSub = sub ?? current?.sub;

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [open]);
  useEffect(() => {
    if (open && active >= 0) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);

  const show = () => {
    if (disabled) return;
    const r = ref.current?.getBoundingClientRect();
    setUp(Boolean(r && window.innerHeight - r.bottom < 300 && r.top > 300));
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const pick = (o: Option) => { if (o.disabled) return; onChange(o.value); setOpen(false); };
  const step = (d: number) => {
    let i = active;
    for (let k = 0; k < options.length; k++) { i = (i + d + options.length) % options.length; if (!options[i].disabled) break; }
    setActive(i);
  };
  const key = (e: React.KeyboardEvent) => {
    if (!open) { if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); show(); } return; }
    if (e.key === "Escape" || e.key === "Tab") { setOpen(false); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); step(e.key === "ArrowDown" ? 1 : -1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (options[active]) pick(options[active]); }
  };

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button type="button" disabled={disabled} aria-label={label} aria-haspopup="listbox" aria-expanded={open}
              aria-controls={`${id}-list`} aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
              onClick={() => (open ? setOpen(false) : show())} onKeyDown={key}
              className={`field w-full flex items-center gap-2 text-left cursor-pointer disabled:cursor-not-allowed ${open ? "!border-violet-500 ring-2 ring-violet-500/25" : ""}`}>
        <span className={`flex-1 min-w-0 truncate ${current ? "" : "text-hint"}`}>{current?.label ?? placeholder}</span>
        {shownSub && <span className="text-xs text-violet-300 shrink-0 truncate max-w-[45%]">{shownSub}</span>}
        <svg viewBox="0 0 20 20" className={`w-4 h-4 shrink-0 text-hint transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 7.5l5 5 5-5" />
        </svg>
      </button>
      {open && (
        <div id={`${id}-list`} role="listbox" aria-label={label}
             className={`absolute left-0 right-0 z-50 max-h-80 overflow-auto rounded-xl border border-violet-600/50 bg-raised p-1.5 shadow-2xl ${up ? "bottom-full mb-1.5" : "top-full mt-1.5"}`}>
          {options.map((o, i) => {
            const on = o.value === value;
            return (
              <div key={o.value} id={`${id}-${i}`} role="option" aria-selected={on} aria-disabled={o.disabled || undefined}
                   onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o)} onMouseEnter={() => setActive(i)}
                   className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm
                     ${o.disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"} ${i === active && !o.disabled ? "bg-violet-900/40" : ""}
                     ${on ? "font-semibold text-zinc-100" : "text-zinc-300"}`}>
                <span className="w-4 shrink-0 text-violet-300">{on && <Check />}</span>
                <span className="flex-1 min-w-0 truncate">{o.label}</span>
                {o.sub && <span className={`text-xs shrink-0 ${on ? "text-violet-300" : "text-hint"}`}>{o.sub}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
