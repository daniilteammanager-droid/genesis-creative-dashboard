"use client";

import { useCallback, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

// Bulk drag-n-drop upload → R2, direct from the browser via a presigned PUT URL
// (never through our own API route — Vercel's body limit would reject a video).
// Compression / thumbnails / transcription are handled entirely by a separate
// worker that polls R2 on its own cron; this component only uploads the raw file
// and, optionally, watches Supabase for the worker to pick it up.

const ALLOWED_EXT = /\.(mov|mp4|jpg|jpeg|png|webp)$/i;

function normalize(filename: string): string {
  return filename.toLowerCase().trim().replace(/\.(mov|mp4|jpg|jpeg|png|webp)$/i, "");
}

type FileStatus = "pending" | "checking" | "exists" | "uploading" | "uploaded" | "processing" | "ready" | "error";

type UploadItem = {
  id: string;
  file: File;
  status: FileStatus;
  progress: number; // 0-100
  error?: string;
};

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 2 * 60_000;

function uploadWithProgress(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`R2 upload failed: ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("R2 upload failed: network error"));
    xhr.send(file);
  });
}

function watchForProcessing(creativeCode: string, onReady: () => void) {
  const startedAt = Date.now();
  const tick = async () => {
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) return;
    const { data } = await supabase.from("creative_notes").select("creative_code").eq("creative_code", creativeCode).maybeSingle();
    if (data) { onReady(); return; }
    setTimeout(tick, POLL_INTERVAL_MS);
  };
  setTimeout(tick, POLL_INTERVAL_MS);
}

export default function CreativeUploadModal({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function patch(id: string, changes: Partial<UploadItem>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...changes } : it)));
  }

  async function processFile(item: UploadItem, overwrite = false) {
    patch(item.id, { status: "checking" });
    try {
      const res = await fetch("/api/media/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: item.file.name, contentType: item.file.type }),
      });
      const data = (await res.json()) as { uploadUrl?: string; key?: string; exists?: boolean; error?: string };
      if (!res.ok || !data.uploadUrl) throw new Error(data.error ?? "Не удалось получить ссылку на загрузку");

      if (data.exists && !overwrite) {
        patch(item.id, { status: "exists" });
        return;
      }

      patch(item.id, { status: "uploading", progress: 0 });
      await uploadWithProgress(data.uploadUrl, item.file, (pct) => patch(item.id, { progress: pct }));
      patch(item.id, { status: "processing", progress: 100 });
      watchForProcessing(normalize(item.file.name), () => patch(item.id, { status: "ready" }));
    } catch (e) {
      patch(item.id, { status: "error", error: e instanceof Error ? e.message : "Ошибка загрузки" });
    }
  }

  const addFiles = useCallback((fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) => ALLOWED_EXT.test(f.name));
    const newItems: UploadItem[] = files.map((file) => ({
      id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
      file,
      status: "pending",
      progress: 0,
    }));
    setItems((prev) => [...prev, ...newItems]);
    newItems.forEach((it) => processFile(it));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  }

  const doneCount = items.filter((i) => i.status === "ready" || i.status === "processing" || i.status === "uploaded").length;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-start md:items-center justify-center p-4 md:p-6" onClick={onClose}>
      <div
        className="w-full max-w-[640px] bg-[#0d0b14] border border-violet-900/40 rounded-2xl md:rounded-3xl overflow-hidden my-4 md:my-0 max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-violet-900/20">
          <h2 className="text-lg font-semibold text-white">Загрузить крео</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-xl leading-none">✕</button>
        </div>

        <div className="p-6 overflow-y-auto">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-2xl px-6 py-10 cursor-pointer transition ${
              dragActive ? "border-violet-500 bg-violet-900/10" : "border-violet-900/40 hover:border-violet-600/50"
            }`}
          >
            <span className="text-3xl opacity-70">📁</span>
            <p className="text-sm text-zinc-300">Перетащи файлы сюда или нажми, чтобы выбрать</p>
            <p className="text-xs text-zinc-600">mp4, mov, jpg, jpeg, png, webp — можно сразу несколько</p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".mp4,.mov,.jpg,.jpeg,.png,.webp"
              className="hidden"
              onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }}
            />
          </div>

          {items.length > 0 && (
            <div className="mt-5 space-y-2">
              <p className="text-xs text-zinc-500 uppercase tracking-wider">
                Загружено {doneCount}/{items.length}
              </p>
              {items.map((it) => (
                <UploadRow key={it.id} item={it} onOverwrite={() => processFile(it, true)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function UploadRow({ item, onOverwrite }: { item: UploadItem; onOverwrite: () => void }) {
  const { file, status, progress, error } = item;
  return (
    <div className="bg-[#111118] border border-violet-900/20 rounded-xl px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-sm text-zinc-200 truncate">{file.name}</span>
        <StatusBadge status={status} />
      </div>

      {status === "uploading" && (
        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full bg-violet-500 transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}

      {status === "exists" && (
        <div className="flex items-center justify-between gap-2 mt-1">
          <p className="text-xs text-amber-400/80">Файл с таким именем уже есть в R2</p>
          <button
            onClick={onOverwrite}
            className="text-xs px-2 py-1 rounded-lg bg-amber-900/40 text-amber-300 border border-amber-700/40 hover:bg-amber-900/60 transition"
          >
            Перезаписать
          </button>
        </div>
      )}

      {status === "error" && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: FileStatus }) {
  const map: Record<FileStatus, { label: string; cls: string }> = {
    pending:    { label: "В очереди",      cls: "text-zinc-500" },
    checking:   { label: "Проверка…",      cls: "text-zinc-500" },
    exists:     { label: "Уже существует", cls: "text-amber-400" },
    uploading:  { label: "Загрузка…",      cls: "text-violet-400" },
    uploaded:   { label: "Загружено",      cls: "text-zinc-400" },
    processing: { label: "Обрабатывается", cls: "text-violet-400" },
    ready:      { label: "Готово ✓",       cls: "text-green-400" },
    error:      { label: "Ошибка",         cls: "text-red-400" },
  };
  const { label, cls } = map[status];
  return <span className={`text-xs font-medium whitespace-nowrap ${cls}`}>{label}</span>;
}
