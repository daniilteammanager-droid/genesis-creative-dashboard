"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// «Уникализация» (Decision 091) — вкладка как у Артёма: видео из своей Медиатеки с
// фильтром по лицу и «только исходники v1», предпросмотр, вставка и кадры, задания из
// дашборда и Telegram со ссылкой на готовое видео. Монтирует воркер на VPS (Decision 076).

const card = "bg-[#111118] border border-violet-900/30 rounded-2xl p-5";
const field = "bg-[#0d0b14] border border-violet-900/40 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-600/50 text-white";
const small = "px-3 py-1.5 rounded-lg text-sm border transition disabled:opacity-50";

interface Video { key: string; code: string; url: string; thumb: string | null; face: string | null; version: string }
interface Job { id: string; ad_id: string | null; source_name: string; tail_type: string; frame_type: string; status: string; stage: string | null; error: string | null; duration: number | null; created_at: string; url: string | null }
interface View { jobs: Job[]; types: Record<string, string>; videos: Video[] }

const STATUS: Record<string, string> = { choosing: "Выбор в боте", queued: "В очереди", processing: "Монтаж", ready: "Смонтировано", replacing: "Замена в Meta", done: "Готово", failed: "Ошибка" };
const when = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });

export default function Uniquify() {
  const [v, setV] = useState<View | null>(null);
  const [face, setFace] = useState("ROMAN");
  const [q, setQ] = useState("");
  const [onlyV1, setOnlyV1] = useState(true);
  const [sel, setSel] = useState<Video | null>(null);
  const [tail, setTail] = useState("nature");
  const [frame, setFrame] = useState("nature");
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(() => fetch("/api/antireject").then((r) => r.json()).then((d) => d.jobs && setV(d)).catch(() => undefined), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!v?.jobs.some((j) => ["queued", "processing", "ready", "replacing"].includes(j.status))) return;
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [v, load]);

  const list = useMemo(() => (v?.videos ?? []).filter((x) =>
    (face === "" || (x.face ?? "") === face) && (!onlyV1 || x.version === "v1" || x.version === "")
    && (!q || x.code.includes(q.trim().toLowerCase()))).slice(0, 200), [v, face, onlyV1, q]);

  async function start(body: Record<string, unknown>) {
    setNote(null);
    const r = await fetch("/api/antireject", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "start", tail, frame, ...body }) });
    const d = await r.json().catch(() => ({}));
    setNote(d.error ?? "В очереди — монтаж занимает 7–10 минут, ход и ссылка — ниже");
    load();
  }

  if (!v) return <div className="max-w-6xl mx-auto px-4 py-6 text-zinc-500">Загружаю…</div>;
  const pick = (label: string, value: string, set: (s: string) => void) => (
    <label className="flex flex-col gap-1 text-xs text-zinc-500">{label}
      <select value={value} onChange={(e) => set(e.target.value)} className={field}>{Object.entries(v.types).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
    </label>
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-white">Уникализация</h1>
        <p className="text-sm text-zinc-500 mt-1">Выбери видео из своей Медиатеки. Готовый результат появится ниже со ссылкой для скачивания. Уникализация с заменой в отклонённом объявлении — во вкладке «Антиотклон».</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div data-tour="uq-library" className={card}>
          <h2 className="text-base font-semibold text-white mb-3">Видео из медиатеки</h2>
          <div className="flex flex-wrap gap-2 mb-2">
            <select value={face} onChange={(e) => setFace(e.target.value)} className={field} aria-label="Лицо">
              <option value="ROMAN">Роман</option><option value="RICKY">Рики</option><option value="">Все лица</option>
            </select>
            <input placeholder="Найти по коду" value={q} onChange={(e) => setQ(e.target.value)} className={`${field} flex-1 min-w-[160px]`} />
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300 mb-2"><input type="checkbox" checked={onlyV1} onChange={(e) => setOnlyV1(e.target.checked)} className="accent-violet-500" />Только исходники v1</label>
          <div className="max-h-[420px] overflow-y-auto space-y-1">
            {list.length === 0 ? <p className="text-sm text-zinc-500">Нет видео под эти фильтры. Лицо ставится при загрузке в Медиатеку.</p> : list.map((x) => (
              <button key={x.key} type="button" onClick={() => setSel(x)} className={`w-full flex items-center gap-3 px-2 py-1.5 rounded-lg border text-left ${sel?.key === x.key ? "border-violet-500 bg-violet-900/15" : "border-transparent hover:border-violet-900/40"}`}>
                {x.thumb ? <img src={x.thumb} alt="" loading="lazy" className="w-8 h-12 object-cover rounded bg-black" /> : <span className="w-8 h-12 rounded bg-black/40" />}
                <span className="text-sm text-zinc-200 truncate">{x.code}</span>
              </button>
            ))}
          </div>
        </div>

        <div data-tour="uq-settings" className={card}>
          <h2 className="text-base font-semibold text-white mb-3">Настройки обработки</h2>
          {sel ? (
            <>
              <p className="text-sm text-zinc-200 mb-2 truncate">{sel.code}</p>
              <video key={sel.key} src={sel.url} poster={sel.thumb ?? undefined} controls preload="none" className="w-full max-h-72 rounded-lg bg-black mb-3" />
            </>
          ) : <p className="text-sm text-zinc-500 mb-3">Выбери исходное видео слева.</p>}
          <div className="grid grid-cols-2 gap-2 mb-3">
            {pick("После 30 секунд чёрного экрана", tail, setTail)}
            {pick("Кадры перед и после крео", frame, setFrame)}
          </div>
          <p className="text-[11px] text-zinc-500 mb-3 leading-relaxed">Крайние вставки — по 1/30 секунды перед и после крео. Основное видео сохраняется без пережатия, сжимаются только добавленные материалы. Скорость исходника меняется на 3–5%. Вставка — 5–10 минут; с дисклеймером весь ролик заканчивается около 10-й минуты. Дисклеймер: 10 голосов × 10 оформлений, сочетания меняются сами.</p>
          <button type="button" disabled={!sel} onClick={() => sel && start({ key: sel.key })} className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-600 to-violet-500 text-white disabled:opacity-50">Обработать видео</button>
          {note && <p className="text-sm text-violet-200 mt-2">{note}</p>}
        </div>
      </div>

      <div data-tour="uq-jobs" className={card}>
        <h2 className="text-base font-semibold text-white mb-3">Задания и готовые видео</h2>
        <p className="text-[11px] text-zinc-600 mb-2">Общая история обработки — из дашборда и из Telegram.</p>
        {v.jobs.length === 0 ? <p className="text-sm text-zinc-500">Заданий пока нет.</p> : (
          <div className="divide-y divide-violet-900/20">
            {v.jobs.map((j) => (
              <div key={j.id} className="py-2.5 flex flex-wrap gap-3 items-start">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-200 truncate">{j.source_name} <span className="text-zinc-500">· {v.types[j.tail_type]} · кадры: {v.types[j.frame_type]}{j.ad_id ? " · с заменой в объявлении" : ""}</span></p>
                  <p className="text-[11px] text-zinc-500">{when(j.created_at)}{j.duration ? ` · ${Math.round(Number(j.duration))} с` : ""}{j.stage ? ` · ${j.stage}` : ""}</p>
                  {j.error && <p className="text-[11px] text-red-300 mt-0.5">{j.error}</p>}
                </div>
                <span className="text-[11px] px-2 py-1 rounded-full border border-violet-900/40 text-zinc-300 shrink-0">{STATUS[j.status] ?? j.status}</span>
                {j.status === "failed" && !j.ad_id && <button type="button" onClick={() => start({ retry: j.id })} className={`${small} border-violet-900/40 text-zinc-300 shrink-0`}>Повторить</button>}
                {j.url && <a href={j.url} target="_blank" rel="noreferrer" className={`${small} border-violet-700/50 text-violet-200 shrink-0`}>Скачать ↓</a>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
