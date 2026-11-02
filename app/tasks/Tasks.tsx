"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon, seg, chip, Spinner } from "@/components/ui";
import type { Board, Person } from "@/lib/tasks/store";
import {
  blank, byId, depth, diff, fromRows, insert, kids, layout, move, NEXT, patch, placeFree, removeBranch, roots, rows,
  type Row, type Task,
} from "@/lib/tasks/tree";
import Canvas from "./Canvas";
import Kanban from "./Kanban";
import TaskPanel from "./TaskPanel";
import BoardDialog from "./BoardDialog";
import { TitleInput } from "./parts";

// Задачи: холсты с майнд-картами и доска над теми же задачами. Каждый видит свой личный
// холст и общие, куда его добавили (lib/tasks/store.ts). Правки уходят в базу пачкой
// через полсекунды тишины; общий холст подтягивает чужие правки раз в 20 секунд.

const LAST_BOARD = "tasks:board";

export default function Tasks({ me }: { me: string }) {
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<"ok" | "saving" | string>("ok");

  const [list, setList] = useState<Task[]>([]);
  const listRef = useRef<Task[]>([]);
  const saved = useRef(new Map<string, string>());
  const boardRef = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);

  const [sel, setSel] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const editingRef = useRef<string | null>(null);
  const fresh = useRef<string | null>(null);
  const [panel, setPanel] = useState(false);
  const [view, setView] = useState<"map" | "board">("map");
  const [by, setBy] = useState<"dir" | "status">("dir");
  const [mapPick, setMapPick] = useState<string | null>(null);
  const [hideDone, setHideDone] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [fitSignal, setFitSignal] = useState(0);
  const [dialog, setDialog] = useState<Board | "new" | null>(null);

  /* ─── Сохранение ─── */
  const flush = useCallback(async function run(): Promise<void> {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const board = boardRef.current;
    if (!board) return;
    if (saving.current) { timer.current = setTimeout(run, 300); return; }
    const { insert, patch, changed, remove } = diff(saved.current, listRef.current);
    if (!changed.length && !remove.length) return;
    saving.current = true; setSaveState("saving");
    try {
      const r = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ board, insert, patch, remove }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "Не сохранилось");
      if (boardRef.current === board) {
        for (const row of changed) saved.current.set(row.id, JSON.stringify(row));
        for (const id of remove) saved.current.delete(id);
      }
      setSaveState("ok");
    } catch (e) {
      setSaveState(e instanceof Error ? e.message : "Не сохранилось");
      timer.current = setTimeout(run, 5000); // сеть моргнула — правки не теряем, пробуем ещё
    } finally {
      saving.current = false;
    }
  }, []);

  const change = useCallback((fn: (l: Task[]) => Task[]) => {
    const next = fn(listRef.current);
    if (next === listRef.current) return;
    listRef.current = next; setList(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 500);
  }, [flush]);

  // Ушёл со вкладки — дописать сразу, не дожидаясь таймера.
  useEffect(() => {
    const hide = () => { if (document.visibilityState === "hidden") void flush(); };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, [flush]);

  /* ─── Загрузка ─── */
  const fetchRows = async (board: string): Promise<Row[]> => {
    const r = await fetch(`/api/tasks?board=${board}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Не загрузилось");
    return j.tasks;
  };
  const accept = (rs: Row[]) => {
    const l = fromRows(rs);
    listRef.current = l; setList(l);
    saved.current = new Map(rows(l).map((r) => [r.id, JSON.stringify(r)]));
  };

  // Открыть холст: всё выделенное и свёрнутое — от прошлого холста, сбрасываем.
  const openBoard = useCallback((id: string | null) => {
    boardRef.current = id; setBoardId(id);
    setSel(null); setPanel(false); setEditing(null); editingRef.current = null; setCollapsed(new Set());
    if (!id) return;
    try { localStorage.setItem(LAST_BOARD, id); } catch {}
    setLoading(true);
    fetchRows(id)
      .then((rs) => { if (boardRef.current !== id) return; accept(rs); setLoadError(null); setFitSignal((n) => n + 1); })
      .catch((e) => boardRef.current === id && setLoadError(e.message))
      .finally(() => boardRef.current === id && setLoading(false));
  }, []);

  // Список холстов; pick — какой открыть (новый общий), иначе текущий, прошлый или личный.
  const loadBoards = useCallback((pick?: string | null) =>
    fetch("/api/tasks")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Не загрузилось");
        setBoards(j.boards); setPeople(j.people);
        let last: string | null = null;
        try { last = localStorage.getItem(LAST_BOARD); } catch {}
        const ids = (j.boards as Board[]).map((b) => b.id);
        const want = [pick, boardRef.current, last].find((id) => id && ids.includes(id)) ?? ids[0] ?? null;
        if (want !== boardRef.current) openBoard(want);
      })
      .catch((e) => { setLoadError(e instanceof Error ? e.message : "Не загрузилось"); setLoading(false); }),
  [openBoard]);
  // ?board= — ссылка из Telegram на общий холст.
  useEffect(() => { void loadBoards(new URLSearchParams(location.search).get("board")); }, [loadBoards]);

  // Чужие правки на общем холсте: раз в 20 секунд и при возврате на вкладку — если у меня ничего не висит.
  const shared = boards?.find((b) => b.id === boardId)?.shared ?? false;
  useEffect(() => {
    if (!boardId || !shared) return;
    const pull = async () => {
      const idle = () => !timer.current && !saving.current && !editingRef.current && boardRef.current === boardId;
      if (document.visibilityState !== "visible" || !idle()) return;
      const dirty = () => { const d = diff(saved.current, listRef.current); return d.changed.length + d.remove.length > 0; };
      if (dirty()) return;
      const rs = await fetchRows(boardId).catch(() => null);
      if (rs && idle() && !dirty()) accept(rs);
    };
    const t = setInterval(pull, 20000);
    addEventListener("focus", pull);
    return () => { clearInterval(t); removeEventListener("focus", pull); };
  }, [boardId, shared]);

  const switchBoard = async (id: string) => { if (id === boardRef.current) return; await flush(); openBoard(id); };

  /* ─── Быстрый ввод ─── */
  const create = (parent: string | null, after?: string | null, at?: { x: number; y: number }) => {
    const l = listRef.current, p = byId(l, parent);
    const t = blank(l, crypto.randomUUID(), parent, at);
    change((x) => insert(x, t, after));
    if (parent) setCollapsed((c) => { if (!c.has(parent)) return c; const n = new Set(c); n.delete(parent); return n; });
    const d = p ? depth(l, p) + 1 : 0;
    if (d === 0) setView("map");
    if (d === 1 && view === "board") { setBy("dir"); setMapPick(parent); }
    fresh.current = t.id; editingRef.current = t.id; setEditing(t.id); setSel(t.id);
  };

  // Закрыть поле ввода. Пустое имя у новой задачи — задачи нет, у старой — остаётся прежнее.
  const commit = (id: string, value: string): Task | null => {
    if (editingRef.current !== id) return null;
    editingRef.current = null; setEditing(null);
    const l = listRef.current, t = byId(l, id);
    if (!t) return null;
    const v = value.trim();
    if (!v && fresh.current === id && !kids(l, id).length) {
      fresh.current = null;
      change((x) => x.filter((y) => y.id !== id));
      setSel(t.parent);
      return null;
    }
    fresh.current = null;
    if (v && v !== t.title) change((x) => patch(x, id, { title: v }));
    return t;
  };
  const onEditKey = (id: string, key: "Enter" | "Tab" | "Escape", value: string) => {
    const t = commit(id, value);
    if (!t) return;
    if (key === "Enter") create(t.parent ?? t.id, t.parent ? t.id : null);
    else if (key === "Tab" && view === "map") create(t.id);
  };
  const rename = (id: string) => { fresh.current = null; editingRef.current = id; setEditing(id); setSel(id); };

  const title = (t: Task) => t.id === editing
    ? <TitleInput key={t.id} value={t.title} placeholder={["Карта", "Направление"][depth(list, t)] ?? "Задача"}
                  onKey={(k, v) => onEditKey(t.id, k, v)} onDone={(v) => commit(t.id, v)} />
    : <span className="flex-1 min-w-0 truncate" title={t.title}>{t.title || <span className="text-hint">Без названия</span>}</span>;

  // Клавиши на холсте для выделенной задачи. Обработчик свежий каждый рендер, слушатель — один.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  useLayoutEffect(() => {
    keys.current = (e) => {
      const el = e.target as HTMLElement;
      if (dialog || e.isComposing || el.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "Escape") { if (panel) setPanel(false); else setSel(null); return; }
      const t = byId(listRef.current, sel);
      if (!t || view !== "map") return;
      if (e.key === "F2") { e.preventDefault(); rename(t.id); }
      else if (e.key === "Tab") { e.preventDefault(); create(t.id); }
      else if (e.key === "Enter") { e.preventDefault(); create(t.parent ?? t.id, t.parent ? t.id : null); }
    };
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e);
    addEventListener("keydown", h);
    return () => removeEventListener("keydown", h);
  }, []);

  /* ─── Вид ─── */
  const maps = useMemo(() => roots(list), [list]);
  const mapId = maps.some((m) => m.id === mapPick) ? mapPick : maps[0]?.id ?? null;
  const board = boards?.find((b) => b.id === boardId) ?? null;
  // Кому можно поручить: хозяин и участники общего холста. На личном ответственного нет.
  const members = board?.shared ? people.filter((x) => x.id === board.owner || board.members.includes(x.id)) : null;
  const who = (id: string) => people.find((x) => x.id === id)?.name ?? "Бывший участник";
  const opts = { collapsed, hideDone };
  const selected = panel ? byId(list, sel) : undefined;

  // Новая карта кнопкой — справа от всех, и холст вписывается, чтобы её было видно.
  const newMap = () => {
    const ps = Object.values(layout(listRef.current, opts).pos);
    const x = ps.length ? Math.max(...ps.map((q) => q.x)) + 320 : 0;
    const y = maps.length ? Math.min(...maps.map((m) => m.y ?? 0)) : 0;
    create(null, null, { x, y });
    setFitSignal((n) => n + 1);
  };

  if (loadError && !boards) return <Page><p className="text-sm text-red-400">{loadError}</p></Page>;

  return (
    <Page>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="page-title">Задачи</h1>
        <div className="seg" data-tour="tasks-boards">
          {(boards ?? []).map((b) => (
            <button key={b.id} type="button" {...seg(b.id === boardId)} onClick={() => void switchBoard(b.id)} title={b.shared ? "Общий холст" : "Видишь только ты"}>
              <Icon name={b.shared ? "users" : "lock"} className="w-3.5 h-3.5 mr-1.5" />{b.title}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-sm" onClick={() => setDialog("new")}>+ Общий холст</button>
        {board?.shared && (
          <button type="button" className="btn btn-sm" onClick={() => setDialog(board)}>
            <Icon name="users" className="w-3.5 h-3.5" />{board.members.length + 1} · {board.owner === me ? "Участники" : "Кто видит"}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2" data-tour="tasks-views">
        <div className="seg">
          <button type="button" {...seg(view === "map")} onClick={() => setView("map")}>Холст</button>
          <button type="button" {...seg(view === "board")} onClick={() => setView("board")}>Доска</button>
        </div>
        {view === "board" && (
          <div className="seg">
            <button type="button" {...seg(by === "dir")} onClick={() => setBy("dir")}>По направлениям</button>
            <button type="button" {...seg(by === "status")} onClick={() => setBy("status")}>По статусу</button>
          </div>
        )}
        {view === "board" && by === "dir" && maps.length > 1 && (
          <div className="seg">{maps.map((m) => <button key={m.id} type="button" {...seg(m.id === mapId)} onClick={() => setMapPick(m.id)}>{m.title || "Без названия"}</button>)}</div>
        )}
        <button type="button" {...chip(hideDone)} onClick={() => setHideDone((v) => !v)}>Скрыть сделанные</button>
        {view === "board" && board?.shared && <button type="button" {...chip(onlyMine)} onClick={() => setOnlyMine((v) => !v)}>Только мои</button>}
        <button type="button" className="btn btn-primary btn-sm" onClick={newMap}>+ Карта</button>
      </div>
      {/* Подсказка и «Сохраняю…» в одной строке: отдельной строкой статус дёргал раскладку под пальцем. */}
      <p className="text-xs text-hint -mt-1 flex gap-3">
        <span className="flex-1">{view === "map"
          ? "Выдели задачу: Tab — подзадача, Enter — следующая. Тащи задачу куда угодно, на другую — вложить. ⋯ — настройки. Двойной клик по пустому месту — новая карта."
          : by === "dir" ? "Enter в новой карточке — сразу следующая. Тащи карточку в другую колонку или выше — она важнее."
          : "Задачи всех карт холста. Тащи карточку в другой статус, порядок — с холста."}</span>
        <span className={`flex-none ${saveState === "ok" || saveState === "saving" ? "" : "text-red-400"}`}>
          {saveState === "saving" ? "Сохраняю…" : saveState === "ok" ? "" : `${saveState}. Пробую ещё раз`}
        </span>
      </p>

      {loading && !list.length ? (
        <div className="flex-1 grid place-items-center"><Spinner /></div>
      ) : view === "map" ? (
        <Canvas
          list={list} sel={sel} editing={editing} collapsed={collapsed} hideDone={hideDone} fitSignal={fitSignal} title={title} who={who}
          onSelect={(id, open) => { setSel(id); if (open) setPanel(true); if (!id) setPanel(false); }}
          onCycle={(id) => change((l) => { const t = byId(l, id); return t?.status ? patch(l, id, { status: NEXT[t.status] }) : l; })}
          onToggle={(id) => setCollapsed((c) => { const n = new Set(c); if (!n.delete(id)) n.add(id); return n; })}
          onAdd={(id) => create(id)}
          onRename={rename}
          onCreateMap={(at) => create(null, null, at)}
          onShift={(id, x, y) => change((l) => (byId(l, id)?.parent ? patch(l, id, { dx: x, dy: y }) : patch(l, id, { x, y })))}
          onDrop={(id, target) => {
            if (target) change((l) => move(l, id, target.id, target.w));
            else if (byId(listRef.current, id)?.parent) change((l) => placeFree(l, id, opts));
          }}
          onTidy={() => change((l) => l.map((t) => (t.dx || t.dy ? { ...t, dx: null, dy: null } : t)))}
        />
      ) : (
        <Kanban
          list={list} by={by} mapId={mapId} sel={sel} editing={editing} hideDone={hideDone} title={title} who={who}
          mine={onlyMine && board?.shared ? me : null}
          onSelect={(id, open) => { setSel(id); if (open) setPanel(true); }}
          onCycle={(id) => change((l) => { const t = byId(l, id); return t?.status ? patch(l, id, { status: NEXT[t.status] }) : l; })}
          onAdd={(parent) => create(parent)}
          onMove={(id, target, w) => change((l) => move(l, id, target, w))}
          onStatus={(id, s) => change((l) => patch(l, id, { status: s }))}
        />
      )}

      {selected && (
        <TaskPanel
          key={selected.id} list={list} task={selected} members={members}
          onChange={(ch) => change((l) => patch(l, selected.id, ch))}
          onCycle={(id) => change((l) => { const t = byId(l, id); return t?.status ? patch(l, id, { status: NEXT[t.status] }) : l; })}
          onGo={(id) => setSel(id)}
          onAddSub={(v) => {
            const t = { ...blank(listRef.current, crypto.randomUUID(), selected.id), title: v };
            change((l) => [...l, t]);
            setCollapsed((c) => { const n = new Set(c); n.delete(selected.id); return n; });
          }}
          onDelete={() => { change((l) => removeBranch(l, selected.id)); setSel(null); setPanel(false); }}
          onClose={() => setPanel(false)}
        />
      )}

      {dialog && (
        <BoardDialog
          board={dialog === "new" ? null : dialog} people={people} me={me}
          onClose={() => setDialog(null)}
          onSaved={(id) => {
            setDialog(null);
            if (!id) boardRef.current = null; // удалил или вышел — откроется личный
            void loadBoards(id);
          }}
        />
      )}
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-3 h-[100dvh] p-4 md:p-8">{children}</div>;
}
