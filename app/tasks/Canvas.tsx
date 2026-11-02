"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { dirOf, kids, layout, progress, under, zone, NH, NW, type Task, type Where } from "@/lib/tasks/tree";
import { StatusDot, Who } from "./parts";

// Холст как в Miro: карты где угодно, фон тянет холст, ⌘/Ctrl + колёсико — масштаб.
// Узел тянется куда угодно, ветка едет с ним: отпустил на другом узле — встаёт рядом
// или внутрь, на пустом месте — остаётся там (Tasks решает, что с этим делать).

export interface CanvasProps {
  list: Task[];
  sel: string | null;
  editing: string | null;
  collapsed: Set<string>;
  hideDone: boolean;
  fitSignal: number;                       // поменялся — вписать все карты в экран
  title: (t: Task) => ReactNode;           // название или поле ввода
  who: (id: string) => string;             // имя ответственного
  onSelect: (id: string | null, open?: boolean) => void;
  onCycle: (id: string) => void;
  onToggle: (id: string) => void;
  onAdd: (id: string) => void;
  onRename: (id: string) => void;
  onCreateMap: (at: { x: number; y: number }) => void;
  onShift: (id: string, x: number, y: number) => void; // карта — x, y; узел — dx, dy
  onDrop: (id: string, target: { id: string; w: Where } | null) => void;
  onTidy: () => void;
}

interface Grab { sx: number; sy: number; px: number; py: number; id: string | null; ox: number; oy: number; moved: boolean }

export default function Canvas(p: CanvasProps) {
  const stage = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ px: 40, py: 40, z: 1 });
  const [lifted, setLifted] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; w: Where } | null>(null);
  const grab = useRef<Grab | null>(null);
  const dropRef = useRef(drop);
  const clickGuard = useRef(false);
  const { pos, edges } = useMemo(() => layout(p.list, { collapsed: p.collapsed, hideDone: p.hideDone }), [p.list, p.collapsed, p.hideDone]);
  // Свежие props и вид для обработчиков на window — они вешаются один раз.
  const live = useRef({ p, view, pos });
  useLayoutEffect(() => { live.current = { p, view, pos }; });

  // Вписать все карты: по сигналу (открыли холст) и кнопкой.
  const fit = () => {
    const el = stage.current, ps = Object.values(live.current.pos);
    if (!el) return;
    if (!ps.length) return setView({ px: 40, py: 40, z: 1 });
    const x0 = Math.min(...ps.map((q) => q.x)), y0 = Math.min(...ps.map((q) => q.cy - NH / 2));
    const x1 = Math.max(...ps.map((q) => q.x + NW + 30)), y1 = Math.max(...ps.map((q) => q.cy + NH / 2));
    const r = el.getBoundingClientRect();
    const z = clamp(Math.min((r.width - 80) / (x1 - x0), (r.height - 80) / (y1 - y0)), 0.25, 1);
    setView({ z, px: (r.width - (x1 - x0) * z) / 2 - x0 * z, py: (r.height - (y1 - y0) * z) / 2 - y0 * z });
  };
  useEffect(fit, [p.fitSignal]);

  const zoomAt = (f: number, mx: number, my: number) => setView((v) => {
    const z = clamp(v.z * f, 0.25, 2);
    return { z, px: mx - (mx - v.px) * z / v.z, py: my - (my - v.py) * z / v.z };
  });

  // Колёсико: с ⌘/Ctrl (и щипок трекпада) — масштаб у курсора, без — двигает холст.
  useEffect(() => {
    const el = stage.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      else setView((v) => ({ ...v, px: v.px - e.deltaX, py: v.py - e.deltaY }));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const g = grab.current; if (!g) return;
      const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
      if (!g.moved && Math.hypot(dx, dy) < 4) return;
      const { p, view } = live.current;
      if (!g.moved) { g.moved = true; setLifted(g.id); }
      if (!g.id) return setView((v) => ({ ...v, px: g.px + dx, py: g.py + dy }));
      p.onShift(g.id, Math.round(g.ox + dx / view.z), Math.round(g.oy + dy / view.z));
      // Куда ляжет: узел под курсором (поднятая ветка мышь пропускает).
      const hit = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-node]");
      const t = hit?.dataset.node;
      const r = hit?.getBoundingClientRect();
      const w = t && r ? zone(p.list, g.id, t, (e.clientY - r.top) / r.height) : null;
      const next = t && w ? { id: t, w } : null;
      if (next?.id !== dropRef.current?.id || next?.w !== dropRef.current?.w) { dropRef.current = next; setDrop(next); }
    };
    const up = () => {
      const g = grab.current; grab.current = null;
      if (!g?.moved) return;
      clickGuard.current = true; setTimeout(() => { clickGuard.current = false; }, 0);
      setLifted(null);
      if (g.id) live.current.p.onDrop(g.id, dropRef.current);
      dropRef.current = null; setDrop(null);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    return () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
  }, []);

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button, input")) return;
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-node]")?.dataset.node ?? null;
    const t = id ? p.list.find((x) => x.id === id) : undefined;
    grab.current = {
      sx: e.clientX, sy: e.clientY, px: view.px, py: view.py, id, moved: false,
      ox: t ? (t.parent ? t.dx ?? 0 : t.x ?? 0) : 0, oy: t ? (t.parent ? t.dy ?? 0 : t.y ?? 0) : 0,
    };
  };

  const nodes = useMemo(() => p.list.filter((t) => pos[t.id]).map((t) => {
    const q = pos[t.id], d = q.d, n = kids(p.list, t.id).filter((k) => !(p.hideDone && k.status === "done")).length;
    const isDrop = drop?.id === t.id;
    const look = d === 0 ? "bg-gradient-to-r from-violet-700 to-violet-500 border-transparent font-semibold text-white cursor-move"
      : d === 1 ? "font-semibold cursor-grab" : "bg-raised border-line-strong hover:border-violet-600 cursor-grab";
    return (
      <div
        key={t.id} data-node={t.id}
        onClick={(e) => { e.stopPropagation(); if (!clickGuard.current) p.onSelect(t.id); }}
        onDoubleClick={(e) => { e.stopPropagation(); p.onRename(t.id); }}
        className={`group absolute flex items-center gap-2 pl-2.5 pr-2 rounded-[10px] border text-[13px] select-none ${look}
          ${t.id === p.sel ? "ring-2 ring-violet-400" : ""} ${isDrop && drop.w === "inside" ? "ring-2 ring-violet-300" : ""}
          ${lifted && under(p.list, t.id, lifted) ? "pointer-events-none opacity-85 shadow-xl shadow-black/50" : ""}`}
        style={{
          left: q.x, top: q.cy - NH / 2, width: NW, height: NH,
          ...(d === 1 && t.color ? { background: `color-mix(in srgb, ${t.color} 16%, var(--card))`, borderColor: `color-mix(in srgb, ${t.color} 60%, transparent)` } : {}),
        }}
      >
        {isDrop && drop.w !== "inside" && <span className={`absolute left-0 right-0 h-[3px] rounded bg-violet-300 ${drop.w === "before" ? "-top-[7px]" : "-bottom-[7px]"}`} />}
        {t.status && <StatusDot status={t.status} onClick={() => p.onCycle(t.id)} />}
        {p.title(t)}
        {t.assignee && <Who name={p.who(t.assignee)} />}
        {t.id !== p.editing && (
          <button type="button" title="Настройки" onClick={(e) => { e.stopPropagation(); p.onSelect(t.id, true); }}
                  className={`flex-none w-5 h-5 rounded-md text-hint hover:text-white hover:bg-white/10 ${t.id === p.sel ? "" : "opacity-0 group-hover:opacity-100"}`}>⋯</button>
        )}
        {d === 1 && <span className="text-[11px] text-hint tabular-nums">{progress(p.list, t.id)}</span>}
        {n > 0 && d > 0 && (
          <button type="button" title={p.collapsed.has(t.id) ? "Развернуть" : "Свернуть"} onClick={(e) => { e.stopPropagation(); p.onToggle(t.id); }}
                  className="text-[11px] text-hint hover:text-white px-1 rounded tabular-nums">{p.collapsed.has(t.id) ? `▸ ${n}` : "◂"}</button>
        )}
        <button type="button" title={`${d === 0 ? "Направление" : "Подзадача"} (Tab)`} onClick={(e) => { e.stopPropagation(); p.onAdd(t.id); }}
                className={`absolute -right-7 top-[7px] w-[22px] h-[22px] rounded-full bg-violet-600 text-white leading-[22px] text-[15px] ${t.id === p.sel ? "" : "opacity-0 group-hover:opacity-100"}`}>+</button>
      </div>
    );
  }), [p, pos, drop, lifted]);

  const lines = useMemo(() => edges.map(([a, b]) => {
    const s = pos[a], e = pos[b], x1 = s.x + NW, x2 = e.x, mx = (x1 + x2) / 2;
    const color = dirOf(p.list, p.list.find((t) => t.id === b)!).color ?? "var(--brand)";
    return <path key={b} d={`M${x1} ${s.cy} C${mx} ${s.cy} ${mx} ${e.cy} ${x2} ${e.cy}`} fill="none" stroke={color} strokeOpacity={0.55} strokeWidth={1.6} />;
  }), [edges, pos, p.list]);

  const empty = !p.list.length;
  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={stage} data-tour="tasks-canvas"
        onPointerDown={down}
        onClick={() => { if (!clickGuard.current) p.onSelect(null); }}
        onDoubleClick={(e) => {
          const r = stage.current!.getBoundingClientRect();
          p.onCreateMap({ x: Math.round((e.clientX - r.left - view.px) / view.z), y: Math.round((e.clientY - r.top - view.py) / view.z - NH / 2) });
        }}
        className={`absolute inset-0 overflow-hidden rounded-2xl border border-line bg-panel touch-none cursor-grab active:cursor-grabbing`}
        style={{
          backgroundImage: "radial-gradient(circle, var(--line-strong) 1.2px, transparent 1.3px)",
          backgroundSize: `${24 * view.z}px ${24 * view.z}px`, backgroundPosition: `${view.px}px ${view.py}px`,
        }}
      >
        <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.px}px, ${view.py}px) scale(${view.z})` }}>
          <svg width={1} height={1} className="absolute left-0 top-0 overflow-visible pointer-events-none">{lines}</svg>
          {nodes}
        </div>
        {empty && (
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <p className="text-sm text-hint text-center max-w-xs">Холст пуст. Двойной клик по пустому месту — первая карта, дальше Enter и Tab.</p>
          </div>
        )}
      </div>
      <div className="absolute right-3 bottom-3 flex items-center gap-0.5 p-[3px] rounded-xl bg-card border border-line-strong text-xs tabular-nums">
        <button type="button" className="min-w-7 h-7 rounded-lg text-zinc-300 hover:bg-white/5 hover:text-white" title="Отдалить" onClick={() => zoomCenter(1 / 1.2)}>−</button>
        <span className="min-w-10 text-center text-hint">{Math.round(view.z * 100)}%</span>
        <button type="button" className="min-w-7 h-7 rounded-lg text-zinc-300 hover:bg-white/5 hover:text-white" title="Приблизить" onClick={() => zoomCenter(1.2)}>+</button>
        <button type="button" className="h-7 px-2 rounded-lg text-zinc-300 hover:bg-white/5 hover:text-white" onClick={fit}>Все карты</button>
        <button type="button" className="h-7 px-2 rounded-lg text-zinc-300 hover:bg-white/5 hover:text-white" title="Вернуть задачи на места по порядку" onClick={p.onTidy}>Выровнять</button>
      </div>
    </div>
  );

  function zoomCenter(f: number) {
    const r = stage.current!.getBoundingClientRect();
    zoomAt(f, r.width / 2, r.height / 2);
  }
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
