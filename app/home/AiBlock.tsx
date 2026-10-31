"use client";

import { useEffect, useState } from "react";
import { AiText, VERDICT, type Verdict } from "@/app/traffic-report/AiPanel";

// Главная, AI-разборы (Decision 101): свежие разборы крео (баеру — свои и его лимит) и
// недельная сводка по баерам для владельца и тимлида — с кнопкой «Собрать за 7 дней».

interface Item { id: string; buyer_id: string; creo: string; verdict: Verdict | null; text: string; created_at: string; trigger: string }
const when = (s: string) => new Date(s).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const card = "card p-4";

export default function AiBlock({ lead }: { lead: boolean }) {
  const [data, setData] = useState<{ ready: boolean; analyses: Item[]; names: Record<string, string>; budget: { limit: number; used: number } | null } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/ai/creo?recent=5").then((r) => r.json()).then((j) => !j.error && setData(j)).catch(() => {});
  }, []);
  if (!data || (!data.ready && !lead)) return null;

  return (
    <section className="mb-10">
      <h2 className="text-lg font-semibold mb-1">✦ AI-разборы</h2>
      <p className="text-xs text-hint mb-4">
        Разбор крео — значок ✦ у крео в «Отчётах», и сам, в Telegram, когда крео прошло границу теста или дало первые депы.
        {data.budget && ` Твой лимит: $${data.budget.used.toFixed(2)} из $${data.budget.limit} в этом месяце.`}
      </p>
      {!data.ready && <p className="text-sm text-amber-300/80 mb-4">Не подключено: на сервере нет ключа ANTHROPIC_API_KEY.</p>}
      <div className={`grid grid-cols-1 gap-4 ${lead ? "xl:grid-cols-2" : ""}`}>
        {lead && data.ready && <Weekly />}
        <div className={card}>
          <p className="font-semibold mb-3">Свежие разборы крео</p>
          {data.analyses.length === 0 && <p className="text-sm text-hint">Пока ни одного. Открой «Отчёты» и нажми ✦ у крео.</p>}
          <ul className="space-y-1">
            {data.analyses.map((a) => {
              const v = a.verdict ? VERDICT[a.verdict] : null;
              return (
                <li key={a.id}>
                  <button onClick={() => setOpen(open === a.id ? null : a.id)} className="w-full flex items-center gap-2 text-left text-sm py-1.5 hover:text-violet-200">
                    {v && <span className={`shrink-0 px-1.5 py-0.5 rounded border text-[11px] ${v.tone}`}>{v.label}</span>}
                    <span className="truncate flex-1">{a.creo}</span>
                    <span className="shrink-0 text-[11px] text-hint">{lead ? `${data.names[a.buyer_id] ?? ""} · ` : ""}{when(a.created_at)}</span>
                  </button>
                  {open === a.id && <div className="pb-3 pl-1"><AiText text={a.text} /></div>}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Weekly() {
  const [s, setS] = useState<{ week: string; text: string; created_at: string } | null | undefined>(undefined);
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/ai/summary").then((r) => r.json()).then((j) => setS(j.summary ?? null)).catch(() => setS(null));
  }, []);
  const run = () => {
    setBusy(true); setErr(null);
    fetch("/api/ai/summary", { method: "POST" }).then((r) => r.json())
      .then((j) => { if (j.error) throw new Error(j.error); setS(j.summary); setFull(true); })
      .catch((e) => setErr(e instanceof Error ? e.message : "Не получилось"))
      .finally(() => setBusy(false));
  };

  return (
    <div className={card}>
      <div className="flex items-center gap-3 mb-3">
        <p className="font-semibold flex-1">Сводка недели по баерам</p>
        <button onClick={run} disabled={busy} className="text-xs px-3 py-1.5 rounded-full border border-violet-800/50 text-violet-300 hover:bg-violet-900/20 disabled:opacity-60">
          {busy ? "Собираю… до 2 минут" : "Собрать за 7 дней"}
        </button>
      </div>
      {err && <p className="text-xs text-red-400 mb-2">{err}</p>}
      {s === undefined && <p className="text-sm text-hint">Загружаю…</p>}
      {s === null && <p className="text-sm text-hint">Первая сводка придёт в понедельник после 10:00 МСК — или собери сейчас.</p>}
      {s && (
        <>
          <p className="text-[11px] text-hint mb-2">Неделя с {new Date(`${s.week}T00:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })} · собрана {when(s.created_at)}</p>
          <div className={full ? "" : "max-h-64 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]"}><AiText text={s.text} /></div>
          <button onClick={() => setFull((v) => !v)} className="mt-2 text-xs text-violet-300 hover:text-violet-200">{full ? "Свернуть" : "Показать целиком"}</button>
        </>
      )}
    </div>
  );
}
