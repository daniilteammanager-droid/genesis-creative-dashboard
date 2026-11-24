"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Подсказка по наведению и фокусу (Отчёты: реджекты, ROMI всё время). Рисуется поверх страницы, поэтому
// таблица с прокруткой её не обрезает; у нижнего края экрана открывается вверх, при прокрутке закрывается.
export function HoverTip({ tip, label, className, children }: { tip: ReactNode; label: string; className?: string; children: ReactNode }) {
  const [at, setAt] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  useEffect(() => {
    if (!at) return;
    const off = () => setAt(null);
    addEventListener("scroll", off, true);
    return () => removeEventListener("scroll", off, true);
  }, [at]);
  const show = (e: { currentTarget: HTMLElement }) => {
    const r = e.currentTarget.getBoundingClientRect(), left = Math.max(8, Math.min(r.left, innerWidth - 300));
    setAt(r.bottom > innerHeight - 240 ? { left, bottom: innerHeight - r.top + 4 } : { left, top: r.bottom + 4 });
  };
  return (
    <>
      <button type="button" aria-label={label} className={className} onClick={(e) => e.stopPropagation()}
              onMouseEnter={show} onMouseLeave={() => setAt(null)} onFocus={show} onBlur={() => setAt(null)}>{children}</button>
      {at && createPortal(
        <div role="tooltip" style={at} className="fixed z-50 w-72 rounded-xl border border-line-strong bg-raised p-3 text-xs leading-relaxed text-zinc-200 shadow-xl space-y-1.5">{tip}</div>,
        document.body,
      )}
    </>
  );
}
