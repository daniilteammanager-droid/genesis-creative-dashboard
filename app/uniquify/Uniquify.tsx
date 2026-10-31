"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// «Уникализация» (Decision 091) — вкладка как у Артёма: видео из своей Медиатеки с
// фильтром по лицу и «только исходники v1», предпросмотр, вставка и кадры, задания из
// дашборда и Telegram со ссылкой на готовое видео. Монтирует воркер на VPS (Decision 076).
// Видео можно выбрать несколько — по заданию на каждое с одними настройками (31.10.2026).

const card = "card p-5";

interface Video { key: string; code: string; url: string; thumb: string | null; face: string | null; version: string }
interface Job { id: string; ad_id: string | null; source_name: string; tail_type: string; frame_type: string; status: string; stage: string | null; error: string | null; duration: number | null; created_at: string; url: string | null; link: string | null; queue: number | null }
interface View { jobs: Job[]; types: Record<string, string>; videos: Video[] }

const STATUS: Record<string, string> = { choosing: "Выбор в боте", queued: "В очереди", processing: "Монтаж", ready: "Смонтировано", replacing: "Замена в Meta", done: "Готово", failed: "Ошибка", cancelled: "Отменено" };
// Одно задание — 10–15 минут, воркер монтирует по одному: место в очереди → примерное ожидание.
const JOB_MIN = 12;
const when = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });

export default function Uniquify() {
  const [v, setV] = useState<View | null>(null);
  const [face, setFace] = useState("ROMAN");
  const [q, setQ] = useState("");
  const [onlyV1, setOnlyV1] = useState(true);
  const [sel, setSel] = useState<Video | null>(null);   // в предпросмотре — последнее нажатое
  const [picked, setPicked] = useState<string[]>([]);   // ключи выбранных видео, по порядку выбора
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
    const n = Array.isArray(d.ids) ? d.ids.length : 1;
    setNote(d.error ?? `${n > 1 ? `В очереди ${n} видео` : "В очереди"} — одно монтируется 10–15 минут, по одному. Место в очереди, ход и ссылка — ниже`);
    if (!d.error && body.keys) setPicked([]);
    load();
  }
  const toggle = (x: Video) => {
    setSel(x);
    setPicked((p) => (p.includes(x.key) ? p.filter((k) => k !== x.key) : [...p, x.key]));
  };
  async function cancel(id: string) {
    const r = await fetch("/api/antireject", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "cancel", id }) });
    const d = await r.json().catch(() => ({}));
    if (d.error) setNote(d.error);
    load();
  }

  if (!v) return <div className="max-w-6xl mx-auto p-4 md:p-8 text-hint">Загружаю…</div>;
  const pick = (label: string, value: string, set: (s: string) => void) => (
    <label className="flex flex-col gap-1 text-xs text-hint">{label}
      <select value={value} onChange={(e) => set(e.target.value)} className="field">{Object.entries(v.types).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
    </label>
  );

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-4">
      <div>
        <h1 className="page-title">Уникализация</h1>
        <p className="text-sm text-hint mt-1">Выбери видео из своей Медиатеки. Готовый результат появится ниже со ссылкой для скачивания. Уникализация с заменой в отклонённом объявлении — во вкладке «Антиотклон».</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div data-tour="uq-library" className={card}>
          <h2 className="text-base font-semibold text-white mb-3">Видео из медиатеки</h2>
          <div className="flex flex-wrap gap-2 mb-2">
            <select value={face} onChange={(e) => setFace(e.target.value)} className="field" aria-label="Лицо">
              <option value="ROMAN">Роман</option><option value="RICKY">Рики</option><option value="">Все лица</option>
            </select>
            <input placeholder="Найти по коду" value={q} onChange={(e) => setQ(e.target.value)} className={`field flex-1 min-w-[160px]`} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2">
            <label className="flex items-center gap-2 text-sm text-zinc-300"><input type="checkbox" checked={onlyV1} onChange={(e) => setOnlyV1(e.target.checked)} className="accent-violet-500" />Только исходники v1</label>
            {picked.length > 0 && <button type="button" onClick={() => setPicked([])} className="text-xs text-violet-300 hover:text-violet-200 ml-auto">Снять выбор · {picked.length}</button>}
          </div>
          <div className="max-h-[420px] overflow-y-auto space-y-1">
            {list.length === 0 ? <p className="text-sm text-hint">Нет видео под эти фильтры. Лицо ставится при загрузке в Медиатеку.</p> : list.map((x) => (
              <button key={x.key} type="button" onClick={() => toggle(x)} aria-pressed={picked.includes(x.key)}
                      className={`w-full flex items-center gap-3 px-2 py-1.5 rounded-lg border text-left ${picked.includes(x.key) ? "border-violet-500 bg-violet-900/15" : "border-transparent hover:border-line"}`}>
                <input type="checkbox" readOnly tabIndex={-1} checked={picked.includes(x.key)} className="accent-violet-500 shrink-0 pointer-events-none" />
                {x.thumb ? <img src={x.thumb} alt="" loading="lazy" className="w-8 h-12 object-cover rounded bg-black" /> : <span className="w-8 h-12 rounded bg-black/40" />}
                <span className="text-sm text-zinc-200 truncate">{x.code}</span>
              </button>
            ))}
          </div>
        </div>

        <div data-tour="uq-settings" className={card}>
          <h2 className="text-base font-semibold text-white mb-3">Настройки обработки</h2>
          {picked.length > 1 && <p className="text-sm text-violet-200 mb-2">Выбрано {picked.length} видео — каждое уйдёт отдельным заданием с этими настройками.</p>}
          {sel ? (
            <>
              <p className="text-sm text-zinc-200 mb-2 truncate">{sel.code}</p>
              <video key={sel.key} src={sel.url} poster={sel.thumb ?? undefined} controls preload="none" className="w-full max-h-72 rounded-lg bg-black mb-3" />
            </>
          ) : <p className="text-sm text-hint mb-3">Выбери исходное видео слева — можно несколько.</p>}
          <div className="grid grid-cols-2 gap-2 mb-3">
            {pick("После 30 секунд чёрного экрана", tail, setTail)}
            {pick("Кадры перед и после крео", frame, setFrame)}
          </div>
          <p className="text-[11px] text-hint mb-3 leading-relaxed">Крайние вставки — по 1/30 секунды перед и после крео. Основное видео сохраняется без пережатия, сжимаются только добавленные материалы. Скорость исходника меняется на 3–5%. Вставка — 5–10 минут; с дисклеймером весь ролик заканчивается около 10-й минуты. Дисклеймер: 10 голосов × 10 оформлений, сочетания меняются сами.</p>
          <button type="button" disabled={!picked.length} onClick={() => start({ keys: picked })} className="btn btn-primary">
            {picked.length > 1 ? `Обработать ${picked.length} видео` : "Обработать видео"}
          </button>
          {note && <p className="text-sm text-violet-200 mt-2">{note}</p>}
        </div>
      </div>

      <div data-tour="uq-jobs" className={card}>
        <h2 className="text-base font-semibold text-white mb-3">Задания и готовые видео</h2>
        <p className="text-[11px] text-hint mb-2">Общая история обработки — из дашборда и из Telegram.</p>
        {v.jobs.length === 0 ? <p className="text-sm text-hint">Заданий пока нет.</p> : (
          <div className="divide-y divide-line">
            {v.jobs.map((j) => (
              <div key={j.id} className="py-2.5 flex flex-wrap gap-3 items-start">
                {/* min-w: на телефоне кнопки уходят строкой ниже, а не сжимают название. */}
                <div className="flex-1 min-w-[14rem]">
                  <p className="text-sm text-zinc-200 truncate">{j.source_name} <span className="text-hint">· {v.types[j.tail_type]} · кадры: {v.types[j.frame_type]}{j.ad_id ? " · с заменой в объявлении" : ""}</span></p>
                  <p className="text-[11px] text-hint">
                    {when(j.created_at)}{j.duration ? ` · ${Math.round(Number(j.duration))} с` : ""}
                    {j.status === "queued" && j.queue ? ` · ${j.queue}-е в очереди, ≈ ${j.queue * JOB_MIN} мин` : j.stage ? ` · ${j.stage}` : ""}
                  </p>
                  {j.error && <p className="text-[11px] text-red-300 mt-0.5">{j.error}</p>}
                </div>
                <span className="text-[11px] px-2 py-1 rounded-full border border-line text-zinc-300 shrink-0">{STATUS[j.status] ?? j.status}</span>
                {["choosing", "queued", "processing"].includes(j.status) && <button type="button" onClick={() => cancel(j.id)} className="btn btn-sm border-red-900/40 text-red-300 shrink-0">Отменить</button>}
                {["failed", "cancelled"].includes(j.status) && !j.ad_id && <button type="button" onClick={() => start({ retry: j.id })} className="btn btn-sm shrink-0">Повторить</button>}
                {j.link && <button type="button" onClick={() => navigator.clipboard.writeText(j.link!).then(() => setNote("Ссылка на видео скопирована"))} className="btn btn-sm shrink-0">Копировать ссылку</button>}
                {j.url && <a href={j.url} download className="btn btn-sm border-violet-700/50 text-violet-200 shrink-0">Скачать ↓</a>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
