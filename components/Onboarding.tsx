"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/auth/client";
import type { Profile } from "@/lib/auth/types";
import { stepsFor } from "@/lib/onboarding/steps";

// Обучалка поверх любой страницы (Decision 077): открывается, пока в профиле нет
// отметки onboarded_at. «Пропустить» и «Готово» ставят отметку — второй раз сама
// не откроется; повторить — Настройки → Профиль.

export default function Onboarding({ profile }: { profile: Profile }) {
  const router = useRouter();
  const steps = stepsFor(profile.role);
  const [i, setI] = useState(0);
  const [open, setOpen] = useState(true);
  if (!open) return null;
  const s = steps[i];
  const last = i === steps.length - 1;

  async function finish(goTo?: string) {
    setOpen(false);
    await createClient().from("profiles").update({ onboarded_at: new Date().toISOString() }).eq("id", profile.id);
    if (goTo) router.push(goTo);
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-end sm:items-center justify-center p-4" role="dialog" aria-modal aria-label="Обучение">
      <div className="w-full max-w-lg bg-[#111118] border border-violet-900/40 rounded-2xl p-6 shadow-2xl shadow-violet-950/50">
        <div className="flex items-center gap-1 mb-5">
          {steps.map((_, k) => (
            <span key={k} className={`h-1 flex-1 rounded-full ${k <= i ? "bg-violet-500" : "bg-violet-900/40"}`} />
          ))}
        </div>
        <p className="text-4xl mb-3">{s.emoji}</p>
        <h2 className="text-xl font-semibold text-white mb-3">{s.title}</h2>
        <div className="space-y-2.5 text-sm text-zinc-300 leading-relaxed min-h-[150px]">
          {s.text.map((t) => <p key={t}>{t}</p>)}
        </div>
        {s.href && (
          <button type="button" onClick={() => finish(s.href)} className="mt-3 text-sm text-violet-300 hover:text-violet-200">
            Открыть раздел и закончить обучение →
          </button>
        )}
        <div className="flex items-center gap-2 mt-6">
          {!last && (
            <button type="button" onClick={() => finish()} className="text-xs text-zinc-500 hover:text-zinc-300 mr-auto">Пропустить</button>
          )}
          {last && <span className="mr-auto" />}
          <span className="text-xs text-zinc-600">{i + 1} / {steps.length}</span>
          {i > 0 && (
            <button type="button" onClick={() => setI(i - 1)} className="px-4 py-2 rounded-xl text-sm text-zinc-300 border border-violet-900/40 hover:bg-violet-900/20">Назад</button>
          )}
          <button type="button" onClick={() => (last ? finish() : setI(i + 1))}
                  className="px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-600 to-violet-500 text-white hover:from-violet-500 hover:to-violet-400">
            {i === 0 ? "Поехали" : last ? "Готово" : "Дальше"}
          </button>
        </div>
      </div>
    </div>
  );
}
