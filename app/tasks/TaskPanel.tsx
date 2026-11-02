"use client";

import { useState } from "react";
import { DatePicker } from "@/components/DatePicker";
import { branchTasks, COLORS, depth, dirOf, kids, mapOf, STATUS, type Task } from "@/lib/tasks/tree";
import { seg } from "@/components/ui";
import { StatusDot } from "./parts";
import type { Person } from "@/lib/tasks/store";

// Карточка задачи справа: открывается по «⋯» (на доске — по клику), а не при создании —
// задачи закидываются быстро, настраиваются потом.

export interface PanelProps {
  list: Task[];
  task: Task;
  members: Person[] | null;                // участники общего холста; null — личный, ответственного нет
  onChange: (ch: Partial<Task>) => void;
  onCycle: (id: string) => void;
  onGo: (id: string) => void;
  onAddSub: (title: string) => void;
  onDelete: () => void;
  onClose: () => void;
}

export default function TaskPanel({ list, task: t, members, onChange, onCycle, onGo, onAddSub, onDelete, onClose }: PanelProps) {
  const [arm, setArm] = useState(false);
  const d = depth(list, t), sub = kids(list, t.id), inBranch = branchTasks(list, t.id).length;
  const where = d === 0 ? "Карта" : d === 1 ? `Направление · ${mapOf(list, t).title}` : `${mapOf(list, t).title} › ${dirOf(list, t).title}`;
  return (
    <aside className="fixed inset-y-0 right-0 z-40 w-[360px] max-w-full overflow-y-auto bg-card border-l border-line-strong p-5 flex flex-col gap-4 shadow-2xl shadow-black/50" aria-label="Задача">
      <div className="flex items-center justify-between gap-2">
        <span className="label truncate">{where}</span>
        <button type="button" onClick={onClose} title="Закрыть (Esc)" className="w-8 h-8 rounded-lg text-hint hover:text-white hover:bg-white/5">✕</button>
      </div>
      <input key={t.id} className="field" defaultValue={t.title} aria-label="Название"
             onChange={(e) => onChange({ title: e.target.value })}
             onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />

      {t.status && (
        <>
          <div className="flex flex-col gap-2">
            <span className="label">Статус</span>
            <div className="seg">{STATUS.map(([s, n]) => <button key={s} type="button" {...seg(t.status === s)} onClick={() => onChange({ status: s })}>{n}</button>)}</div>
          </div>
          {members && (
            <div className="flex flex-col gap-2">
              <label className="label" htmlFor="task-assignee">Ответственный</label>
              <select id="task-assignee" className="field" value={t.assignee ?? ""} onChange={(e) => onChange({ assignee: e.target.value || null })}>
                <option value="">Никто</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                {t.assignee && !members.some((m) => m.id === t.assignee) && <option value={t.assignee}>Бывший участник</option>}
              </select>
              <p className="text-[11px] text-hint">Ответственному придёт в Telegram, а в 10:00 МСК в день срока — напоминание.</p>
            </div>
          )}
          <div className="flex flex-col gap-2">
            <span className="label">Срок</span>
            <div className="flex items-center gap-3">
              <DatePicker value={t.due ?? ""} onChange={(v) => onChange({ due: v })} />
              {t.due && <button type="button" onClick={() => onChange({ due: null })} className="text-xs text-hint hover:text-white">Убрать</button>}
            </div>
          </div>
        </>
      )}

      {d === 1 && (
        <div className="flex flex-col gap-2">
          <span className="label">Цвет</span>
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button key={c} type="button" aria-label="Цвет" aria-pressed={t.color === c} onClick={() => onChange({ color: c })}
                      className={`w-6 h-6 rounded-full ${t.color === c ? "ring-2 ring-white ring-offset-2 ring-offset-card" : ""}`} style={{ background: c }} />
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="label">{d === 0 ? "Направления" : "Подзадачи"}</span>
        {sub.map((s) => (
          <div key={s.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-raised text-[13px]">
            {s.status && <StatusDot status={s.status} onClick={() => onCycle(s.id)} />}
            <button type="button" onClick={() => onGo(s.id)} className={`flex-1 text-left ${s.status === "done" ? "line-through text-hint" : ""}`}>{s.title || "Без названия"}</button>
          </div>
        ))}
        <input className="field" placeholder={`+ ${d === 0 ? "Направление" : "Подзадача"} и Enter`} aria-label="Новая подзадача"
               onKeyDown={(e) => {
                 const v = e.currentTarget.value.trim();
                 if (e.key !== "Enter" || e.nativeEvent.isComposing || !v) return;
                 onAddSub(v); e.currentTarget.value = "";
               }} />
      </div>

      <p className="text-xs text-hint leading-relaxed">
        На холсте: <b className="text-zinc-300">Tab</b> — подзадача, <b className="text-zinc-300">Enter</b> — задача рядом,
        <b className="text-zinc-300"> F2</b> или двойной клик — переименовать, <b className="text-zinc-300">Esc</b> — закрыть.
        Задачу тащи куда угодно: на верх или низ другой — рядом, в середину — внутрь.
      </p>

      <button type="button" onClick={() => (arm ? onDelete() : setArm(true))}
              className="btn mt-auto !border-red-400/40 !text-red-400">
        {arm ? `Точно удалить${inBranch ? ` вместе с ${inBranch} задачами` : ""}?` : d === 0 ? "Удалить карту" : "Удалить"}
      </button>
    </aside>
  );
}
