"use client";

import { Fragment, useEffect, useState } from "react";

// Панель AI-разбора крео в «Отчётах» (Decision 101): последний разбор «баер × крео» за 30 дней
// и кнопка «Разобрать». Те же цифры — сервер вернёт прежний разбор, лимит не тратится.

export type Verdict = "scale" | "hold" | "rework" | "off";
export const VERDICT: Record<Verdict, { label: string; tone: string }> = {
  scale: { label: "Масштабировать", tone: "border-green-500/50 text-green-300" },
  hold: { label: "Держать", tone: "border-sky-500/50 text-sky-300" },
  rework: { label: "Доработать", tone: "border-amber-400/50 text-amber-200" },
  off: { label: "Выключить", tone: "border-red-500/50 text-red-300" },
};
interface Analysis { id: string; verdict: Verdict | null; text: string | null; created_at: string; trigger: string }
interface Budget { limit: number; used: number }

// **жирный** и строки — без HTML из ответа модели.
export function AiText({ text }: { text: string }) {
  return (
    <div className="space-y-1.5 text-[13px] leading-relaxed text-zinc-200">
      {text.split("\n").filter((l) => l.trim()).map((line, i) => (
        <p key={i} className={/^\s*[-•]\s/.test(line) ? "pl-3" : ""}>
          {line.replace(/^#{1,6}\s*/, "").split("**").map((part, j) => (j % 2 ? <b key={j} className="text-white">{part}</b> : <Fragment key={j}>{part}</Fragment>))}
        </p>
      ))}
    </div>
  );
}

const WHY: Record<string, string> = { manual: "по кнопке", test_limit: "крео прошло границу теста", first_deps: "крео дало первые депы" };

export default function AiPanel({ buyerId, buyerLabel, creo, onClose, onDone }: {
  buyerId: string; buyerLabel: string; creo: string; onClose: () => void; onDone: (verdict: Verdict | null) => void;
}) {
  const [a, setA] = useState<Analysis | null>(null);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [ready, setReady] = useState(true);
  const [state, setState] = useState<"load" | "idle" | "run">("load");
  const [err, setErr] = useState<string | null>(null);
  const [same, setSame] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/ai/creo?${new URLSearchParams({ buyer: buyerId, creo })}`).then((r) => r.json()).then((j) => {
      if (!alive) return;
      if (j.error) setErr(j.error); else { setA(j.analysis); setBudget(j.budget); setReady(j.ready); }
      setState("idle");
    }).catch(() => { if (alive) { setErr("Не загрузилось"); setState("idle"); } });
    return () => { alive = false; };
  }, [buyerId, creo]);

  const run = () => {
    setState("run"); setErr(null); setSame(false);
    fetch("/api/ai/creo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ buyer: buyerId, creo }) })
      .then((r) => r.json()).then((j) => {
        if (j.error) throw new Error(j.error);
        setSame(a?.id === j.analysis.id);
        setA(j.analysis); setBudget(j.budget); onDone(j.analysis.verdict);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Не получилось"))
      .finally(() => setState("idle"));
  };

  const v = a?.verdict ? VERDICT[a.verdict] : null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <aside onClick={(e) => e.stopPropagation()} role="dialog" aria-label="AI-разбор крео"
             className="w-full sm:w-[30rem] h-full overflow-y-auto bg-card border-l border-line p-5 shadow-2xl">
        <div className="flex items-start gap-3 mb-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-violet-300 mb-1">✦ AI-разбор · {buyerLabel}</p>
            <h2 className="text-sm font-semibold text-white break-words">{creo}</h2>
            <p className="text-[11px] text-hint mt-1">Все страны за 30 дней, модель Claude Opus 5.5</p>
          </div>
          <button onClick={onClose} aria-label="Закрыть" className="text-hint hover:text-white text-lg leading-none">×</button>
        </div>

        {state === "load" && <p className="text-sm text-hint">Загружаю…</p>}
        {state !== "load" && !ready && <p className="text-sm text-amber-300/80">AI-разборы ещё не подключены: на сервере нет ключа ANTHROPIC_API_KEY.</p>}
        {state !== "load" && ready && (
          <>
            {a ? (
              <div className="mb-4">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  {v && <span className={`px-2 py-0.5 rounded-md border text-xs ${v.tone}`}>{v.label}</span>}
                  <span className="text-[11px] text-hint">
                    {new Date(a.created_at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {WHY[a.trigger] ?? ""}
                  </span>
                </div>
                {a.text && <AiText text={a.text} />}
              </div>
            ) : state === "idle" && <p className="text-sm text-zinc-400 mb-4">Разбора ещё нет. Модель посмотрит транскрипт и воронку по странам, сравнит со средними команды и скажет, что делать с крео.</p>}

            {same && <p className="text-xs text-hint mb-3">Цифры с прошлого разбора не изменились — разбор тот же, лимит не потрачен.</p>}
            {err && <p className="text-xs text-red-400 mb-3">{err}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={run} disabled={state === "run"}
                      className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-sm text-white font-medium">
                {state === "run" ? "Модель разбирает… ~15 с" : a ? "Разобрать заново" : "Разобрать"}
              </button>
              {budget && <span className="text-[11px] text-hint">Лимит баера: ${budget.used.toFixed(2)} из ${budget.limit} в этом месяце</span>}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
