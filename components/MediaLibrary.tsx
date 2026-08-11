"use client";

import { useEffect, useMemo, useState } from "react";
import type { CreativeNote } from "@/lib/supabase";
import type { CreativeRow } from "@/lib/creatives/types";
import { type MediaFile, findMedia, getFileBaseName, isVideo, getApproach } from "@/lib/creatives/media";

// "Медиатека" — modal opened from the Creatives toolbar (next to "Загрузить").
// Shows what's already in R2 vs. what's still missing per CSV creative code
// (with an ignore toggle for known-broken CSV names), plus rename/delete on
// uploaded files and their processing status (thumbnail / RU transcription / ready).

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes, i = -1;
  do { value /= 1024; i++; } while (value >= 1024 && i < units.length - 1);
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`;
}

export default function MediaLibrary({
  rows,
  media,
  notes,
  supabaseAvailable,
  onRefresh,
  onToggleIgnored,
  onClose,
}: {
  rows: CreativeRow[];
  media: MediaFile[];
  notes: Record<string, CreativeNote>;
  supabaseAvailable: boolean;
  onRefresh: () => void;
  onToggleIgnored: (creativeCode: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [showIgnored, setShowIgnored] = useState(false);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const missingAll = useMemo(
    () => rows.filter((r) => !findMedia(r.creative, media)),
    [rows, media]
  );
  const ignoredCount = missingAll.filter((r) => notes[r.creative]?.ignored).length;
  const missing = useMemo(
    () =>
      missingAll
        .filter((r) => (showIgnored ? true : !notes[r.creative]?.ignored))
        .filter((r) => r.creative.toLowerCase().includes(search.toLowerCase())),
    [missingAll, notes, showIgnored, search]
  );

  const files = useMemo(
    () =>
      media
        .filter((f) => f.key.toLowerCase().includes(search.toLowerCase()))
        .sort((a, b) => a.key.localeCompare(b.key)),
    [media, search]
  );

  const stats = useMemo(() => {
    const realFiles = media.filter((f) => !f.key.startsWith("thumbnails/"));
    const totalBytes = realFiles.reduce((sum, f) => sum + (f.size ?? 0), 0);
    const transcribed = realFiles.filter((f) => notes[getFileBaseName(f.key)]?.transcription_ru).length;
    return { count: realFiles.length, totalBytes, transcribed };
  }, [media, notes]);

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-start md:items-center justify-center p-4 md:p-6" onClick={onClose}>
      <div
        className="w-full max-w-[820px] bg-[#0d0b14] border border-violet-900/40 rounded-2xl md:rounded-3xl overflow-hidden my-4 md:my-0 max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-violet-900/20">
          <h2 className="text-lg font-semibold text-white">Медиатека</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-xl leading-none">✕</button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Файлов в R2" value={String(stats.count)} />
            <StatCard label="Занято места" value={formatBytes(stats.totalBytes)} />
            <StatCard label="Транскрибировано" value={`${stats.transcribed} / ${stats.count}`} />
            <StatCard label="Не загружено" value={String(missingAll.length)} colorClass="text-amber-300" />
          </div>

          <input
            type="text"
            placeholder="Поиск по названию..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#111118] border border-violet-900/40 rounded-xl px-4 py-3 outline-none focus:border-violet-600/50 transition placeholder:text-zinc-600"
          />

          {missing.length > 0 && (
            <div className="bg-[#111118] border border-amber-700/30 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-amber-300">
                  Ещё не загружено ({missing.length}{!showIgnored && ignoredCount > 0 ? `, скрыто ${ignoredCount}` : ""})
                </h3>
                {ignoredCount > 0 && (
                  <button
                    onClick={() => setShowIgnored((v) => !v)}
                    className="text-xs text-zinc-500 hover:text-zinc-300 transition"
                  >
                    {showIgnored ? "Скрыть проигнорированные" : "Показать проигнорированные"}
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {missing.map((r) => {
                  const ignored = !!notes[r.creative]?.ignored;
                  return (
                    <span
                      key={r.creative}
                      className={`flex items-center gap-1.5 text-xs pl-2.5 pr-1.5 py-1 rounded-lg border ${
                        ignored
                          ? "bg-zinc-900/40 text-zinc-600 border-zinc-800 line-through"
                          : "bg-amber-900/20 text-amber-300/80 border-amber-700/30"
                      }`}
                    >
                      {r.creative}
                      <button
                        onClick={() => supabaseAvailable && onToggleIgnored(r.creative)}
                        disabled={!supabaseAvailable}
                        title={ignored ? "Вернуть в список" : "Игнорировать (битое название)"}
                        className="text-current opacity-60 hover:opacity-100 transition disabled:opacity-30 leading-none px-0.5"
                      >
                        {ignored ? "↺" : "✕"}
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          <div className="bg-[#111118] border border-violet-900/30 rounded-2xl p-5">
            <h3 className="text-sm font-bold text-zinc-300 mb-4">Загружено ({files.length})</h3>
            <div className="space-y-2">
              {files.map((file) => (
                <FileRow key={file.key} file={file} note={notes[getFileBaseName(file.key)]} onRefresh={onRefresh} />
              ))}
              {files.length === 0 && <p className="text-sm text-zinc-600">Ничего не найдено.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FileRow({ file, note, onRefresh }: { file: MediaFile; note: CreativeNote | undefined; onRefresh: () => void }) {
  const filename = file.key.split("/").pop() ?? file.key;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(filename);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveRename() {
    if (name === filename) { setEditing(false); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/media/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "rename", key: file.key, newName: name }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Не удалось переименовать");
      setEditing(false);
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Удалить «${filename}» из R2?`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/media/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "delete", key: file.key }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Не удалось удалить");
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 bg-[#0d0b14] border border-violet-900/20 rounded-xl px-3 py-2.5">
      <div className="w-12 h-12 flex-shrink-0 rounded-lg overflow-hidden bg-zinc-900 flex items-center justify-center">
        {file.posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={file.posterUrl} alt="" className="w-full h-full object-cover" />
        ) : isVideo(file.url) ? (
          <span className="text-lg opacity-50">🎬</span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={file.url} alt="" className="w-full h-full object-cover" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveRename()}
            className="w-full text-sm text-zinc-200 bg-transparent border-b border-violet-500 outline-none py-0.5"
          />
        ) : (
          <p className="text-sm text-zinc-200 truncate">{filename}</p>
        )}
        <div className="flex items-center gap-1.5 flex-wrap mt-1">
          <span className="text-[11px] text-zinc-600">{getApproach(file.key)}</span>
          <ProcessingBadges file={file} note={note} />
        </div>
        {error && <p className="text-[11px] text-red-400 mt-0.5">{error}</p>}
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {editing ? (
          <>
            <button onClick={saveRename} disabled={busy} className="text-xs px-2.5 py-1 rounded-lg bg-violet-600 text-white hover:bg-violet-500 transition disabled:opacity-50">
              Сохранить
            </button>
            <button onClick={() => { setEditing(false); setName(filename); }} className="text-xs px-2.5 py-1 rounded-lg text-zinc-400 hover:text-white transition">
              Отмена
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)} disabled={busy} className="text-xs px-2.5 py-1 rounded-lg border border-violet-900/40 text-zinc-300 hover:border-violet-600/50 transition disabled:opacity-50">
              Переименовать
            </button>
            <button onClick={handleDelete} disabled={busy} className="text-xs px-2.5 py-1 rounded-lg border border-red-900/40 text-red-400 hover:border-red-600/50 transition disabled:opacity-50">
              Удалить
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// Best-effort status from what's actually observable today:
// thumbnail = poster exists in R2, transcription = creative_notes.transcription_ru set,
// "готово" = a creative_notes row exists at all (the worker only inserts one once it's
// fully done with a file — there's no per-step signal beyond that; see CreativeUploadModal).
function ProcessingBadges({ file, note }: { file: MediaFile; note: CreativeNote | undefined }) {
  const ready = !!note;
  const badges: { label: string; ok: boolean }[] = [];
  if (isVideo(file.url)) badges.push({ label: "превью", ok: !!file.posterUrl });
  badges.push({ label: "транскрипция", ok: !!note?.transcription_ru });
  badges.push({ label: ready ? "готово" : "обрабатывается", ok: ready });

  return (
    <>
      {badges.map((b) => (
        <span
          key={b.label}
          className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
            b.ok ? "bg-green-900/20 text-green-400/90 border-green-700/30" : "bg-zinc-800/50 text-zinc-500 border-zinc-700/40"
          }`}
        >
          {b.ok ? "✓" : "⏳"} {b.label}
        </span>
      ))}
    </>
  );
}

function StatCard({ label, value, colorClass = "text-white" }: { label: string; value: string; colorClass?: string }) {
  return (
    <div className="bg-[#111118] border border-violet-900/30 rounded-xl px-4 py-3">
      <div className="text-zinc-500 text-xs mb-1 truncate">{label}</div>
      <div className={`text-lg font-bold tabular-nums truncate ${colorClass}`}>{value}</div>
    </div>
  );
}
