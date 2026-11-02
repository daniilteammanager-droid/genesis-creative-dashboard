"use client";

import { useEffect, useRef } from "react";
import { STATUS, type Status } from "@/lib/tasks/tree";

// Кружок статуса: клик — следующий (Надо → В работе → Готово).
export function StatusDot({ status, onClick }: { status: Status; onClick?: () => void }) {
  const look = status === "done" ? "border-green-500 bg-green-500 text-background"
    : status === "doing" ? "border-amber-500 bg-amber-500/30" : "border-zinc-500";
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick?.(); }}
            title={`Статус: ${STATUS.find(([s]) => s === status)?.[1]}`}
            className={`flex-none w-3.5 h-3.5 rounded-full border-2 grid place-items-center ${look}`}>
      {status === "done" && <svg viewBox="0 0 10 10" className="w-2 h-2" aria-hidden><path d="M2 5.2 4.2 7.3 8 3" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>}
    </button>
  );
}

// Название прямо на месте: Enter — следующая рядом, Tab — подзадача, Esc и клик мимо — готово.
export function TitleInput({ value, placeholder, onKey, onDone }: {
  value: string; placeholder: string;
  onKey: (key: "Enter" | "Tab" | "Escape", value: string) => void;
  onDone: (value: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus({ preventScroll: true }); ref.current?.select(); }, []);
  return (
    <input
      ref={ref} defaultValue={value} placeholder={placeholder} aria-label="Название"
      onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || !["Enter", "Tab", "Escape"].includes(e.key)) return;
        e.preventDefault(); e.stopPropagation();
        onKey(e.key as "Enter" | "Tab" | "Escape", e.currentTarget.value);
      }}
      onBlur={(e) => onDone(e.currentTarget.value)}
      className="flex-1 min-w-0 bg-transparent outline-none text-white placeholder:text-hint"
    />
  );
}

// Кружок с первой буквой ответственного.
export function Who({ name }: { name: string }) {
  return (
    <span title={`Ответственный: ${name}`}
          className="flex-none w-5 h-5 rounded-full bg-violet-600/30 border border-violet-500/50 text-[10px] font-semibold text-violet-100 grid place-items-center uppercase">
      {name.trim()[0] ?? "?"}
    </span>
  );
}
