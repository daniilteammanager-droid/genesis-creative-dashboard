"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/auth/client";
import type { Profile } from "@/lib/auth/types";
import { stepsFor } from "@/lib/onboarding/steps";

// Тур по дашборду (Decision 078): подсвечивает блок шага, остальное затемняет,
// рядом — подсказка. «Нажми»-шаг ждёт клика по самому блоку, остальные — «Дальше».
// Открывается, пока в профиле нет onboarded_at; «Пропустить» и «Готово» ставят
// отметку. Повторить — Настройки → Профиль.

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 6;
const WAIT_MS = 15000;  // столько ждём блок: живой чек и отчёты догружаются по нескольку секунд

const find = (target: string) => document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
function visibleRect(el: HTMLElement | null): Rect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 } : null;
}

export default function Onboarding({ profile }: { profile: Profile }) {
  const router = useRouter();
  const pathname = usePathname();
  const steps = stepsFor(profile.role);
  const [i, setI] = useState(0);
  const [open, setOpen] = useState(true);
  const [found, setFound] = useState<{ target: string; rect: Rect | null; searching: boolean } | null>(null);
  const s = steps[i];
  // Блок — только этого шага: у прошлого шага своя цель.
  const rect = s?.target && found?.target === s.target ? found.rect : null;
  const searching = Boolean(s?.target) && (found?.target !== s?.target || found?.searching);
  const last = i === steps.length - 1;
  const clickStep = s?.action === "click" && rect !== null;

  const finish = useCallback(async () => {
    setOpen(false);
    await createClient().from("profiles").update({ onboarded_at: new Date().toISOString() }).eq("id", profile.id);
    router.refresh();
  }, [profile.id, router]);

  // «Дальше»-шаги живут на своей странице: не там — переходим.
  useEffect(() => {
    if (open && s?.route && s.action !== "click" && pathname !== s.route) router.push(s.route);
  }, [open, s, pathname, router]);

  // Ищем блок шага и следим за ним: страница может догружаться и прокручиваться.
  useEffect(() => {
    if (!open || !s?.target) return;
    const target = s.target;
    const started = Date.now();
    let scrolled = false;
    const tick = () => {
      const el = find(target);
      const r = visibleRect(el);
      if (r && !scrolled) {
        scrolled = true;
        el!.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      setFound({ target, rect: r, searching: !r && Date.now() - started <= WAIT_MS });
    };
    const t = setInterval(tick, 150);
    return () => clearInterval(t);
  }, [open, s, pathname]);

  // «Нажми»: клик по самому блоку — следующий шаг (ссылка сама уведёт в раздел).
  useEffect(() => {
    if (!open || s?.action !== "click" || !s.target || !rect) return;
    const el = find(s.target);
    if (!el) return;
    const next = () => setI((k) => k + 1);
    el.addEventListener("click", next);
    return () => el.removeEventListener("click", next);
  }, [open, s, rect]);

  if (!open || !s) return null;

  function next() {
    if (last) return void finish();
    // «Нажми», а блока не видно (меню на телефоне) — переводим сами.
    if (s.action === "click" && s.route && pathname !== s.route) router.push(s.route);
    setI(i + 1);
  }

  // Подсказка — под блоком, если там есть место, иначе над ним; без блока — по центру.
  const vw = typeof window === "undefined" ? 1024 : window.innerWidth;
  const vh = typeof window === "undefined" ? 768 : window.innerHeight;
  const w = Math.min(360, vw - 24);
  const tip: React.CSSProperties = rect
    ? {
        width: w,
        left: Math.max(12, Math.min(rect.left, vw - w - 12)),
        ...(vh - (rect.top + rect.height) > 230 ? { top: rect.top + rect.height + 10 } : { bottom: Math.max(12, vh - rect.top + 10) }),
      }
    : { width: Math.min(440, vw - 24), left: "50%", top: "50%", transform: "translate(-50%, -50%)" };

  const shade = "fixed bg-black/75 z-[60]";
  return (
    <>
      {rect ? (
        <>
          {/* Затемнение вокруг блока — четыре полосы, чтобы сам блок оставался кликабельным. */}
          <div className={shade} style={{ top: 0, left: 0, right: 0, height: Math.max(0, rect.top) }} />
          <div className={shade} style={{ top: rect.top + rect.height, left: 0, right: 0, bottom: 0 }} />
          <div className={shade} style={{ top: rect.top, left: 0, width: Math.max(0, rect.left), height: rect.height }} />
          <div className={shade} style={{ top: rect.top, left: rect.left + rect.width, right: 0, height: rect.height }} />
          <div className={`fixed z-[61] rounded-xl ring-2 ring-violet-400 ${clickStep ? "pointer-events-none animate-pulse" : ""}`}
               style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} />
        </>
      ) : (
        <div className={`${shade} inset-0`} />
      )}

      <div role="dialog" aria-modal aria-label="Обучение"
           className="fixed z-[70] bg-card border border-violet-700/50 rounded-2xl p-5 shadow-2xl shadow-violet-950/60" style={tip}>
        <div className="flex items-center gap-1 mb-3">
          {steps.map((_, k) => <span key={k} className={`h-1 flex-1 rounded-full ${k <= i ? "bg-violet-500" : "bg-violet-900/40"}`} />)}
        </div>
        <h2 className="text-base font-semibold text-white mb-1.5">{s.title}</h2>
        <p className="text-sm text-zinc-300 leading-relaxed">{s.text}</p>
        {clickStep && <p className="text-sm text-violet-300 mt-2">👆 Нажми на подсвеченное</p>}
        {searching && !rect && <p className="text-xs text-hint mt-2">Открываю раздел…</p>}
        <div className="flex items-center gap-2 mt-4">
          {!last && <button type="button" onClick={finish} className="text-xs text-hint hover:text-zinc-300 mr-auto">Пропустить</button>}
          {last && <span className="mr-auto" />}
          <span className="text-xs text-hint">{i + 1} / {steps.length}</span>
          {i > 0 && (
            <button type="button" onClick={() => setI(i - 1)} className="px-3 py-1.5 rounded-lg text-sm text-zinc-300 border border-line hover:bg-violet-900/20">Назад</button>
          )}
          {!clickStep && (
            <button type="button" onClick={next}
                    className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-violet-600 to-violet-500 text-white hover:from-violet-500 hover:to-violet-400">
              {i === 0 ? "Поехали" : last ? "Готово" : "Дальше"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
