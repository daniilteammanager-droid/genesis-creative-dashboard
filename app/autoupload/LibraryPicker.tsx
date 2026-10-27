"use client";

import { useMemo, useState } from "react";
import type { LibraryItem } from "@/lib/autoupload/options";
import type { Face } from "@/lib/creatives/faces";

type Tab = Face | "NONE";
const TABS: [Tab, string][] = [["ROMAN", "Роман"], ["RICKY", "Рики"], ["NONE", "Без лица"]];

// Выбор креативов в адсет — как библиотека в Genesis Manager Артёма: вкладки по лицу,
// поиск, папки «подход → версия», внутри превью с галочками, уже добавленные помечены.
// Загруженным до лиц (Decision 086) лицо ставится прямо здесь.

const APPROACH: Record<string, string> = { storytell: "Storytell", checklist: "Checklist", balance: "Balance", signal: "Signal", qa: "QA", edit: "Edit", live: "Live", lifestyle: "Lifestyle", "": "Без подхода" };
const approachLabel = (a: string) => APPROACH[a] ?? a.toUpperCase();
const versionLabel = (v: string) => v || "Без версии";
const size = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} МБ` : `${Math.round(b / 1024)} КБ`);

function groups(items: LibraryItem[], by: (c: LibraryItem) => string) {
  const m = new Map<string, number>();
  for (const c of items) m.set(by(c), (m.get(by(c)) ?? 0) + 1);
  return [...m];
}

// onRename / onDelete — правка кода и удаление файла прямо отсюда, как «✎ Код» у Артёма
// (через Медиатеку: переименование ведёт превью и оригинал следом).
export default function LibraryPicker({ items, added, defaultFace, onAdd, onFace, onRename, onDelete, onClose }: {
  items: LibraryItem[]; added: Set<string>; defaultFace: Face;
  onAdd: (picked: LibraryItem[]) => void; onFace: (key: string, face: Face) => void;
  onRename: (key: string, newKey: string, code: string) => void; onDelete: (key: string) => void; onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>(defaultFace);
  const [q, setQ] = useState("");
  const [approach, setApproach] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const ofTab = (t: Tab) => items.filter((c) => (c.face ?? "NONE") === t);
  const found = useMemo(() => {
    const s = q.trim().toLowerCase();
    const inTab = items.filter((c) => (c.face ?? "NONE") === tab);
    return s ? inTab.filter((c) => c.code.includes(s)) : inTab;
  }, [items, q, tab]);
  const [faceErr, setFaceErr] = useState<string | null>(null);
  async function assign(key: string, face: Face) {
    setFaceErr(null);
    const r = await fetch("/api/media/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "face", key, face }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) setFaceErr(d.error ?? "Не получилось");
    else onFace(key, face);
  }
  async function manage(op: "rename" | "delete", c: LibraryItem) {
    setFaceErr(null);
    const ext = c.key.match(/\.[^./]+$/)?.[0] ?? "";
    let newName: string | undefined;
    if (op === "rename") {
      const code = window.prompt("Новый код креатива (имя объявления):", c.code)?.trim();
      if (!code || code === c.code) return;
      newName = code + ext;
    } else if (!window.confirm(`Удалить «${c.code}» из Медиатеки насовсем? Превью и оригинал удалятся вместе с ним.`)) return;
    const r = await fetch("/api/media/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op, key: c.key, newName }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setFaceErr(d.error ?? "Не получилось");
    if (op === "rename") onRename(c.key, d.key, newName!.replace(/\.[^.]+$/, "").toLowerCase()); else onDelete(c.key);
  }
  const inApproach = approach === null ? [] : found.filter((c) => c.approach === approach);
  const rows = version === null ? [] : inApproach.filter((c) => c.version === version);

  const folder = "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-violet-900/30 hover:border-violet-600/50 text-left";
  const toggle = (key: string) => setPicked((p) => { const n = new Set(p); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#111118] border border-violet-900/40 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-violet-900/30 space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-white font-semibold">Моя медиатека</h3>
            <span className="text-xs text-zinc-500">
              {approach === null ? "Все подходы" : version === null ? approachLabel(approach) : `${approachLabel(approach)} · ${versionLabel(version)}`}
            </span>
            <button type="button" onClick={onClose} className="ml-auto text-zinc-400 hover:text-white">✕</button>
          </div>
          <div className="flex gap-1">
            {TABS.filter(([t]) => t !== "NONE" || ofTab("NONE").length > 0).map(([t, label]) => (
              <button key={t} type="button" onClick={() => { setTab(t); setApproach(null); setVersion(null); setPicked(new Set()); }}
                      className={`px-3 py-1.5 rounded-lg text-sm border ${tab === t ? "border-violet-500 bg-violet-900/30 text-white" : "border-violet-900/40 text-zinc-400"}`}>
                {label} <span className="text-zinc-500">{ofTab(t).length}</span>
              </button>
            ))}
          </div>
          <input autoFocus placeholder={`Найти по коду — всего ${items.length}`} value={q} onChange={(e) => setQ(e.target.value)}
                 className="w-full bg-[#0d0b14] border border-violet-900/40 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-600/50 text-white" />
          {approach !== null && (
            <button type="button" onClick={() => (version === null ? setApproach(null) : setVersion(null))} className="text-xs text-violet-300">
              ← {version === null ? "Все подходы" : "Версии"}
            </button>
          )}
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-2">
          {faceErr && <p className="text-xs text-red-300">{faceErr}</p>}
          {tab === "NONE" && <p className="text-xs text-zinc-500">Загружены до выбора лица — поставь лицо, и креатив переедет во вкладку.</p>}
          {items.length === 0 ? (
            <p className="text-sm text-zinc-400">Ты пока ничего не загрузил. Загрузи креативы в Медиатеку (Креативы → Медиатека) — они появятся здесь.</p>
          ) : found.length === 0 && !q ? (
            <p className="text-sm text-zinc-400">У этого лица пока нет креативов.</p>
          ) : approach === null ? (
            groups(found, (c) => c.approach).sort((a, b) => a[0].localeCompare(b[0])).map(([a, n]) => (
              <button key={a} type="button" onClick={() => setApproach(a)} className={folder}>
                <span className="text-violet-400">▰</span><span className="flex-1"><b className="text-zinc-100 text-sm">{approachLabel(a)}</b><small className="block text-zinc-500">{n} файлов</small></span><span className="text-zinc-500">›</span>
              </button>
            ))
          ) : version === null ? (
            groups(inApproach, (c) => c.version).sort((a, b) => (Number(b[0].slice(1)) || 0) - (Number(a[0].slice(1)) || 0)).map(([v, n]) => (
              <button key={v} type="button" onClick={() => setVersion(v)} className={folder}>
                <span className="text-violet-400">▰</span><span className="flex-1"><b className="text-zinc-100 text-sm">{versionLabel(v)}</b><small className="block text-zinc-500">{n} файлов</small></span><span className="text-zinc-500">›</span>
              </button>
            ))
          ) : (
            rows.map((c) => (
              <label key={c.key} className={`flex items-center gap-3 px-3 py-2 rounded-xl border cursor-pointer ${picked.has(c.key) ? "border-violet-600/60 bg-violet-900/10" : "border-violet-900/30"}`}>
                <input type="checkbox" checked={picked.has(c.key)} onChange={() => toggle(c.key)} className="accent-violet-500" />
                {c.thumb
                  ? <img src={c.thumb} alt="" loading="lazy" className="w-10 h-16 object-cover rounded-md bg-black" />
                  : <span className="w-10 h-16 rounded-md bg-black/40 flex items-center justify-center text-zinc-500">{c.kind === "video" ? "▶" : "▣"}</span>}
                <span className="flex-1 min-w-0"><b className="block text-sm text-zinc-100 truncate">{c.code}</b><small className="text-zinc-500">{c.kind === "video" ? "видео" : "картинка"} · {size(c.bytes)}</small></span>
                {added.has(c.key) && <em className="text-[11px] text-zinc-500">Уже добавлено</em>}
                <button type="button" title="Поменять код" onClick={(e) => { e.preventDefault(); manage("rename", c); }} className="text-[11px] px-2 py-1 rounded-lg border border-violet-900/40 text-zinc-400 hover:text-white">✎ Код</button>
                <button type="button" title="Удалить из Медиатеки" onClick={(e) => { e.preventDefault(); manage("delete", c); }} className="text-[11px] px-2 py-1 rounded-lg border border-red-900/40 text-red-300">✕</button>
                {tab === "NONE" && (["ROMAN", "RICKY"] as const).map((f) => (
                  <button key={f} type="button" onClick={(e) => { e.preventDefault(); assign(c.key, f); }}
                          className="text-[11px] px-2 py-1 rounded-lg border border-violet-700/50 text-violet-200">{f === "ROMAN" ? "Роман" : "Рики"}</button>
                ))}
              </label>
            ))
          )}
        </div>

        <div className="p-4 border-t border-violet-900/30 flex items-center gap-3">
          <span className="text-xs text-zinc-500">{picked.size ? `${picked.size} выбрано` : "Отметь креативы в папке версии"}</span>
          <button type="button" disabled={!picked.size} onClick={() => onAdd(items.filter((c) => picked.has(c.key) && !added.has(c.key)))}
                  className="ml-auto px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-600 to-violet-500 text-white disabled:opacity-50">Добавить в адсет</button>
        </div>
      </div>
    </div>
  );
}
