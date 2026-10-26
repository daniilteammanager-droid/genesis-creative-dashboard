"use client";

import { useCallback, useEffect, useState } from "react";

// «Антиотклон» (Decision 083): отклонённые объявления своих кабинетов и
// уникализация — по объявлению (видео заменит креатив) или из библиотеки (просто
// новое видео). Монтирует воркер на VPS, ход виден здесь и в боте.

const card = "bg-[#111118] border border-violet-900/30 rounded-2xl p-5";
const field = "bg-[#0d0b14] border border-violet-900/40 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-600/50 text-white";
const small = "px-3 py-1.5 rounded-lg text-sm border transition disabled:opacity-50";

interface Rejected { ad_id: string; account_id: string; ad_name: string | null; campaign_name: string | null; status: string; reason: string | null; first_seen_at: string }
interface Job { id: string; ad_id: string | null; source_name: string; tail_type: string; frame_type: string; status: string; stage: string | null; error: string | null; duration: number | null; created_at: string; url: string | null }
interface View { rejected: Rejected[]; jobs: Job[]; types: Record<string, string>; videos: { key: string; code: string }[] }

const STATUS: Record<string, string> = { choosing: "Выбор в боте", queued: "В очереди", processing: "Монтаж", ready: "Смонтировано", replacing: "Замена в Meta", done: "Готово", failed: "Ошибка" };
const when = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });

export default function Antireject() {
  const [v, setV] = useState<View | null>(null);
  const [tail, setTail] = useState("nature");
  const [frame, setFrame] = useState("nature");
  const [key, setKey] = useState("");
  const [q, setQ] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(() => fetch("/api/antireject").then((r) => r.json()).then((d) => d.rejected && setV(d)).catch(() => undefined), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!v?.jobs.some((j) => ["queued", "processing", "ready", "replacing"].includes(j.status))) return;
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [v, load]);

  async function start(body: { adId?: string; key?: string }) {
    setNote(null);
    const r = await fetch("/api/antireject", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "start", tail, frame, ...body }) });
    const d = await r.json().catch(() => ({}));
    setNote(d.error ?? "В очереди — монтаж занимает 7–10 минут, ход виден ниже");
    load();
  }

  if (!v) return <div className="max-w-6xl mx-auto px-4 py-6 text-zinc-500">Загружаю…</div>;
  const videos = v.videos.filter((x) => !q || x.code.includes(q.toLowerCase())).slice(0, 80);
  const pick = (label: string, value: string, set: (s: string) => void) => (
    <label className="flex items-center gap-2 text-xs text-zinc-500">{label}
      <select value={value} onChange={(e) => set(e.target.value)} className={field}>{Object.entries(v.types).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
    </label>
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-white">Антиотклон</h1>
        <p className="text-sm text-zinc-500 mt-1">Замена ссылки, ФП и Multi-advertiser — кнопками под алертом в боте. Здесь — что отклонено и уникализация видео.</p>
      </div>

      <div data-tour="ar-settings" className={`${card} flex flex-wrap gap-3 items-center`}>
        <span className="text-sm text-zinc-300">Уникализация:</span>
        {pick("после 30 с чёрного", tail, setTail)}
        {pick("кадры до и после", frame, setFrame)}
        <span className="text-[11px] text-zinc-600">Ролик 5–10 минут: кадр, крео ±3–5% скорости, 30 с чёрного, вставка. Крео не пережимается.</span>
      </div>
      {note && <div className="bg-violet-950/30 border border-violet-800/30 rounded-xl px-4 py-2.5 text-violet-100/90 text-sm">{note}</div>}

      <div data-tour="ar-rejected" className={card}>
        <h2 className="text-base font-semibold text-white mb-3">Отклонённые объявления · {v.rejected.length}</h2>
        {v.rejected.length === 0 ? <p className="text-sm text-zinc-500">Сейчас отклонённых нет.</p> : (
          <div className="divide-y divide-violet-900/20">
            {v.rejected.map((r) => (
              <div key={r.ad_id} className="py-2.5 flex flex-wrap gap-3 items-start">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-200 truncate">{r.ad_name ?? r.ad_id}</p>
                  <p className="text-[11px] text-zinc-500 truncate">{r.campaign_name ?? "—"} · CAB{r.account_id.slice(-4)} · с {when(r.first_seen_at)}</p>
                  {r.reason && <p className="text-[11px] text-red-300/90 mt-0.5 line-clamp-2">{r.reason}</p>}
                </div>
                {!r.ad_id.startsWith("tg:") && (
                  <>
                    <a href={`https://adsmanager.facebook.com/adsmanager/manage/ads?act=${r.account_id}&selected_ad_ids=${r.ad_id}`} target="_blank" rel="noreferrer" className={`${small} border-violet-900/40 text-zinc-300`}>Ads Manager ↗</a>
                    <button type="button" onClick={() => start({ adId: r.ad_id })} className={`${small} border-violet-700/50 text-violet-200`}>🎬 Уникализировать и заменить</button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div data-tour="ar-library" className={card}>
        <h2 className="text-base font-semibold text-white mb-3">Из библиотеки</h2>
        <div className="flex flex-wrap gap-2 items-center">
          <input placeholder={`Найти видео — всего ${v.videos.length}`} value={q} onChange={(e) => setQ(e.target.value)} className={`${field} flex-1 min-w-[200px]`} />
          <select value={key} onChange={(e) => setKey(e.target.value)} className={`${field} flex-1 min-w-[200px]`}>
            <option value="">Выбери видео</option>
            {videos.map((x) => <option key={x.key} value={x.key}>{x.code}</option>)}
          </select>
          <button type="button" disabled={!key} onClick={() => start({ key })} className={`${small} border-violet-700/50 text-violet-200`}>Обработать</button>
        </div>
        <p className="text-[11px] text-zinc-600 mt-2">Из библиотеки — просто новое видео для скачивания, в объявления оно не встаёт.</p>
      </div>

      <div data-tour="ar-jobs" className={card}>
        <h2 className="text-base font-semibold text-white mb-3">Задания</h2>
        {v.jobs.length === 0 ? <p className="text-sm text-zinc-500">Пока не было.</p> : (
          <div className="divide-y divide-violet-900/20">
            {v.jobs.map((j) => (
              <div key={j.id} className="py-2.5 flex flex-wrap gap-3 items-start">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-200 truncate">{j.source_name} <span className="text-zinc-500">· {v.types[j.tail_type]} · кадры: {v.types[j.frame_type]}{j.ad_id ? " · с заменой в объявлении" : ""}</span></p>
                  <p className="text-[11px] text-zinc-500">{when(j.created_at)}{j.duration ? ` · ${Math.round(Number(j.duration))} с` : ""}{j.stage ? ` · ${j.stage}` : ""}</p>
                  {j.error && <p className="text-[11px] text-red-300 mt-0.5">{j.error}</p>}
                </div>
                <span className="text-[11px] px-2 py-1 rounded-full border border-violet-900/40 text-zinc-300 shrink-0">{STATUS[j.status] ?? j.status}</span>
                {j.url && <a href={j.url} target="_blank" rel="noreferrer" className={`${small} border-violet-700/50 text-violet-200 shrink-0`}>Скачать ↓</a>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
