"use client";

import { useState } from "react";
import type { Board, Person } from "@/lib/tasks/store";

// Общий холст: название и кто его видит. Менять может только создатель, участник — выйти.

export default function BoardDialog({ board, people, me, onClose, onSaved }: {
  board: Board | null;              // null — новый
  people: Person[];
  me: string;
  onClose: () => void;
  onSaved: (id: string | null) => void; // id нового, null — холст удалён или покинут
}) {
  const own = !board || board.owner === me;
  const [title, setTitle] = useState(board?.title ?? "");
  const [members, setMembers] = useState<Set<string>>(new Set(board?.members ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [arm, setArm] = useState(false);
  const others = people.filter((p) => p.id !== me);
  const ownerName = board && people.find((p) => p.id === board.owner)?.name;

  const call = async (action: string, extra: object = {}) => {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/tasks/boards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id: board?.id, ...extra }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Ошибка");
      onSaved(action === "create" ? j.id : action === "update" ? board!.id : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div role="dialog" aria-label="Общий холст" onClick={(e) => e.stopPropagation()} className="card w-full max-w-md p-5 flex flex-col gap-4 max-h-[90dvh] overflow-y-auto">
        <div>
          <h2 className="text-lg font-semibold text-white">{board ? board.title : "Новый общий холст"}</h2>
          <p className="text-xs text-hint mt-1">Видят только создатель{ownerName && !own ? ` (${ownerName})` : ""} и те, кого он добавил. Остальные не знают, что холст есть.</p>
        </div>
        {own ? (
          <>
            <input className="field" placeholder="Название, например «Запуск Мексики»" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} autoFocus />
            <div className="flex flex-col gap-1">
              <span className="label">Кто видит</span>
              {others.map((p) => (
                <label key={p.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-raised text-sm text-zinc-200 cursor-pointer">
                  <input type="checkbox" checked={members.has(p.id)} onChange={(e) => {
                    const next = new Set(members); if (e.target.checked) next.add(p.id); else next.delete(p.id); setMembers(next);
                  }} />
                  {p.name}
                </label>
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-1 text-sm text-zinc-200">
            <span className="label">Кто видит</span>
            {[board!.owner, ...board!.members].map((id) => <span key={id}>{people.find((p) => p.id === id)?.name ?? "Бывший участник"}{id === board!.owner ? " — создатель" : ""}</span>)}
          </div>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex flex-wrap gap-2 justify-end">
          {board && (own
            ? <button type="button" disabled={busy} onClick={() => (arm ? call("delete") : setArm(true))} className="btn mr-auto !border-red-400/40 !text-red-400">{arm ? "Точно удалить со всеми задачами?" : "Удалить холст"}</button>
            : <button type="button" disabled={busy} onClick={() => call("leave")} className="btn mr-auto">Выйти из холста</button>)}
          <button type="button" onClick={onClose} className="btn">Закрыть</button>
          {own && <button type="button" disabled={busy || !title.trim()} onClick={() => call(board ? "update" : "create", { title, members: [...members] })} className="btn btn-primary">{board ? "Сохранить" : "Создать"}</button>}
        </div>
      </div>
    </div>
  );
}
