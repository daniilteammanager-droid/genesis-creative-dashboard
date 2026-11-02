"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { depth, dirOf, kids, mapOf, progress, STATUS, type Status, type Task, type Where } from "@/lib/tasks/tree";
import { mskDay } from "@/lib/day";
import { dayLabel } from "@/lib/calendar";
import { StatusDot } from "./parts";

// Доска: те же задачи колонками. По направлениям — колонки = направления одной карты,
// карточку можно переложить в другую колонку или выше в своей. По статусу — задачи всех
// карт холста; перетаскивание меняет статус, порядок — с холста.
// Перетаскивание на pointer-событиях, а не HTML5 drag: тот на телефоне не работает. Мышью —
// с места, пальцем — долгим нажатием (иначе свайп по колонке не прокрутил бы её).

export interface KanbanProps {
  list: Task[];
  by: "dir" | "status";
  mapId: string | null;
  sel: string | null;
  editing: string | null;
  hideDone: boolean;
  title: (t: Task) => ReactNode;
  who: (id: string) => string;
  mine: string | null;                     // «Только мои» — id того, чьи задачи показывать
  onSelect: (id: string, open?: boolean) => void;
  onCycle: (id: string) => void;
  onAdd: (parent: string) => void;
  onMove: (id: string, target: string, w: Where) => void;
  onStatus: (id: string, s: Status) => void;
}

type Target = { id: string; w: Where } | { status: Status } | null;
interface Press { id: string; x: number; y: number; touch: boolean; on: boolean; timer?: ReturnType<typeof setTimeout> }

const sameTarget = (a: Target, b: Target) =>
  a === b || (!!a && !!b && ("status" in a ? "status" in b && a.status === b.status : "id" in b && a.id === b.id && a.w === b.w));

export default function Kanban(p: KanbanProps) {
  const [drag, setDrag] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const [target, setTarget] = useState<Target>(null);
  const press = useRef<Press | null>(null);
  const targetRef = useRef<Target>(null);
  const clickGuard = useRef(false);
  const live = useRef(p);
  useEffect(() => { live.current = p; });
  const today = mskDay();

  // Куда ляжет карточка под пальцем: карточка — выше или ниже неё, пустое место колонки — в конец.
  const aim = (x: number, y: number, id: string) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const c = el?.closest<HTMLElement>("[data-card]"), col = el?.closest<HTMLElement>("[data-col], [data-status]");
    let t: Target = null;
    if (live.current.by === "status") t = col?.dataset.status ? { status: col.dataset.status as Status } : null;
    else if (c && c.dataset.card !== id) { const r = c.getBoundingClientRect(); t = { id: c.dataset.card!, w: y - r.top < r.height / 2 ? "before" : "after" }; }
    else if (col?.dataset.col && !c) t = { id: col.dataset.col, w: "inside" };
    if (!sameTarget(t, targetRef.current)) { targetRef.current = t; setTarget(t); }
  };

  useEffect(() => {
    const start = (pr: Press) => { pr.on = true; setDrag(pr.id); setGhost({ x: pr.x, y: pr.y }); navigator.vibrate?.(15); };
    const move = (e: PointerEvent) => {
      const pr = press.current; if (!pr) return;
      const far = Math.hypot(e.clientX - pr.x, e.clientY - pr.y);
      if (!pr.on) {
        if (pr.touch) { if (far > 8) { clearTimeout(pr.timer); press.current = null; } return; } // свайп — прокрутка
        if (far < 5) return;
        start(pr);
      }
      setGhost({ x: e.clientX, y: e.clientY });
      aim(e.clientX, e.clientY, pr.id);
    };
    const up = () => {
      const pr = press.current; press.current = null;
      if (!pr) return;
      clearTimeout(pr.timer);
      if (!pr.on) return;
      clickGuard.current = true; setTimeout(() => { clickGuard.current = false; }, 0);
      const t = targetRef.current;
      targetRef.current = null; setTarget(null); setDrag(null); setGhost(null);
      if (!t) return;
      if ("status" in t) live.current.onStatus(pr.id, t.status); else live.current.onMove(pr.id, t.id, t.w);
    };
    // Пока тащим пальцем, страница не прокручивается.
    const touch = (e: TouchEvent) => { if (press.current?.on) e.preventDefault(); };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", up);
    addEventListener("touchmove", touch, { passive: false });
    return () => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", up);
      removeEventListener("pointercancel", up); removeEventListener("touchmove", touch);
    };
  }, []);

  const card = (t: Task, crumb?: string) => {
    const sub = kids(p.list, t.id).filter((x) => x.status), done = sub.filter((x) => x.status === "done").length;
    const late = t.due && t.due < today && t.status !== "done";
    const mark = target && "id" in target && target.id === t.id ? target.w : null;
    return (
      <div
        key={t.id} data-card={t.id}
        onPointerDown={(e) => {
          if (e.button !== 0 || t.id === p.editing || (e.target as HTMLElement).closest("button, input")) return;
          const pr: Press = { id: t.id, x: e.clientX, y: e.clientY, touch: e.pointerType !== "mouse", on: false };
          // Пальцем — после 300 мс без движения: карточка «прилипает», дальше тащится.
          if (pr.touch) pr.timer = setTimeout(() => { if (press.current === pr) { pr.on = true; setDrag(pr.id); setGhost({ x: pr.x, y: pr.y }); navigator.vibrate?.(15); } }, 300);
          press.current = pr;
        }}
        onContextMenu={(e) => { if (press.current) e.preventDefault(); }}
        onClick={() => { if (!clickGuard.current) p.onSelect(t.id, true); }}
        className={`relative flex flex-col gap-1.5 px-3 py-2.5 rounded-xl bg-card border border-line hover:border-violet-600 cursor-grab select-none [-webkit-touch-callout:none]
          ${t.id === p.sel ? "ring-2 ring-violet-400" : ""} ${drag === t.id ? "opacity-40" : ""}`}
      >
        {mark && <span className={`absolute left-0 right-0 h-[3px] rounded bg-violet-300 ${mark === "before" ? "-top-[6px]" : "-bottom-[6px]"}`} />}
        <div className="flex items-start gap-2">
          <span className="mt-[3px]">{t.status && <StatusDot status={t.status} onClick={() => p.onCycle(t.id)} />}</span>
          <span className={`flex-1 min-w-0 text-[13px] flex ${t.status === "done" ? "line-through text-hint" : ""}`}>{p.title(t)}</span>
        </div>
        <div className="flex flex-wrap gap-1.5 pl-[22px] text-[11px] text-hint empty:hidden">
          {crumb && <span>{crumb}</span>}
          {t.assignee && <span className="px-1.5 rounded-full border border-violet-500/40 text-violet-200">{p.who(t.assignee)}</span>}
          {t.status === "doing" && p.by === "dir" && <span className="px-1.5 rounded-full border border-amber-500/40 text-amber-400">в работе</span>}
          {sub.length > 0 && <span className="px-1.5 rounded-full border border-line">{done}/{sub.length} подзадач</span>}
          {t.due && <span className={`px-1.5 rounded-full border ${late ? "border-red-400/40 text-red-400" : "border-line"}`}>{late ? "просрочено · " : "до "}{dayLabel(t.due)}</span>}
        </div>
      </div>
    );
  };

  const column = (key: string, data: { "data-col"?: string; "data-status"?: string }, head: ReactNode, body: ReactNode, foot?: ReactNode, on?: boolean) => (
    <section key={key} {...data} className={`flex flex-col min-h-0 rounded-2xl bg-panel border ${on ? "border-violet-400" : "border-line"}`}>
      <div className="flex items-center gap-2 px-3.5 pt-3 pb-1.5 font-semibold text-sm">{head}</div>
      <div className="flex-1 overflow-y-auto px-2 pb-2 pt-1.5 flex flex-col gap-2">{body}</div>
      {foot}
    </section>
  );

  let cols: ReactNode[];
  if (p.by === "dir") {
    const dirs = p.mapId ? kids(p.list, p.mapId) : [];
    cols = dirs.map((d) => {
      const list = kids(p.list, d.id).filter((t) => !(p.hideDone && t.status === "done") && (!p.mine || t.assignee === p.mine));
      const on = !!target && "id" in target && target.id === d.id;
      return column(d.id, { "data-col": d.id },
        <><i className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: d.color ?? undefined }} /><span className="min-w-0 flex-1 flex">{p.title(d)}</span><span className="text-[11px] text-hint font-normal tabular-nums">{progress(p.list, d.id)}</span></>,
        list.length ? list.map((t) => card(t)) : <p className="text-xs text-hint px-1.5 py-2">Перетащи задачу сюда</p>,
        <button type="button" onClick={() => p.onAdd(d.id)} className="btn btn-sm mx-2 mb-2 border-dashed bg-transparent">+ Задача</button>,
        on,
      );
    });
    if (!p.mapId) cols.push(<p key="empty" className="text-sm text-hint p-2">Карт пока нет. Нажми «+ Карта» — карта появится на холсте, её направления станут колонками.</p>);
    else cols.push(
      <section key="new" className="rounded-2xl border border-dashed border-line p-2 h-fit">
        <button type="button" onClick={() => p.onAdd(p.mapId!)} className="btn btn-sm w-full bg-transparent">+ Направление</button>
      </section>,
    );
  } else {
    cols = STATUS.filter(([s]) => !(p.hideDone && s === "done")).map(([s, name]) => {
      const list = p.list.filter((t) => t.status === s && depth(p.list, t) >= 2 && (!p.mine || t.assignee === p.mine));
      const on = !!target && "status" in target && target.status === s;
      const dot = s === "done" ? "bg-green-500" : s === "doing" ? "bg-amber-500" : "bg-zinc-500";
      return column(s, { "data-status": s },
        <><i className={`w-2.5 h-2.5 rounded-full ${dot}`} />{name}<span className="ml-auto text-[11px] text-hint font-normal tabular-nums">{list.length}</span></>,
        list.length ? list.map((t) => card(t, `${mapOf(p.list, t).title} › ${dirOf(p.list, t).title}`)) : <p className="text-xs text-hint px-1.5 py-2">Пусто</p>,
        undefined, on,
      );
    });
  }

  const held = drag ? p.list.find((t) => t.id === drag) : undefined;
  return (
    <div className="flex-1 min-h-0 overflow-x-auto rounded-2xl border border-line bg-card">
      <div className="grid grid-flow-col auto-cols-[minmax(260px,1fr)] gap-3 p-3 h-full">{cols}</div>
      {held && ghost && (
        <div className="fixed z-50 pointer-events-none w-60 px-3 py-2.5 rounded-xl bg-raised border border-violet-500 text-[13px] text-white shadow-2xl shadow-black/60 rotate-2"
             style={{ left: ghost.x - 24, top: ghost.y - 18 }}>
          {held.title || "Без названия"}
        </div>
      )}
    </div>
  );
}
