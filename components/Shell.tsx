"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ROLE_LABELS, type Profile } from "@/lib/auth/types";

// Оболочка приложения: рабочие области, аккаунт и содержимое страницы.
//
// До неё меню было скопировано руками в четыре страницы и успело разъехаться — из Check
// не было ссылки на Креативы, а с админских страниц вообще некуда было вернуться. Теперь
// навигация живёт в одном месте, и новая страница получает её просто потому, что она есть.
//
// Правило раскладки: в панели только рабочие области, всё служебное — внутри аккаунта.
// Иначе панель растёт от каждой настроечной страницы.

const WORK_AREAS = [
  { href: "/", label: "Легаси крео" },
  { href: "/creatives", label: "Креативы" },
  { href: "/check", label: "Checks" },
  { href: "/reports", label: "Reports" },
  { href: "/general-report", label: "General 3.0" },
];

export default function Shell({ profile, children }: { profile: Profile | null; children: React.ReactNode }) {
  const pathname = usePathname();

  // null — «панель не трогали», работает раскладка по умолчанию: на компе открыта,
  // на телефоне убрана. Держать это в CSS, а не в состоянии, важно: ширину экрана
  // на сервере не узнать, а значение из useState приехало бы в разметку и первым
  // кадром показало не то.
  const [open, setOpen] = useState<boolean | null>(null);

  // На входе оболочка не нужна. А вот отсутствие профиля на рабочей странице — это
  // не «не залогинен» (таких сюда не пускает middleware), а «Supabase не ответил».
  // Панель в этом случае обязана остаться: дашборд не теряет навигацию из-за
  // недоступности Supabase (Decision 005).
  if (pathname === "/login") return <>{children}</>;

  // window трогаем только в обработчике: там рендер уже позади и SSR не мешает.
  const isNarrow = () => window.innerWidth < 768;
  const toggle = () => setOpen((v) => (v === null ? isNarrow() : !v));
  // Перешёл по ссылке на телефоне — панель уезжает. Она занимает весь экран, и
  // оставлять её открытой поверх страницы, куда человек только что шёл, незачем.
  const closeIfNarrow = () => { if (isNarrow()) setOpen(false); };

  const asideShown = open === null ? "hidden md:flex" : open ? "flex" : "hidden";
  const barShown   = open === null ? "md:hidden"     : open ? "hidden" : "block";

  const item = "block px-3 py-2 rounded-xl text-sm font-medium transition";
  const iconBtn =
    "flex items-center justify-center h-8 w-8 rounded-lg text-zinc-500 " +
    "hover:text-violet-300 hover:bg-violet-900/20 transition text-base leading-none";

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-[#0a080f]">
      <aside
        className={`${asideShown} md:w-[212px] flex-shrink-0 bg-[#0d0b14] flex-col
                    border-b md:border-b-0 md:border-r border-violet-900/25
                    md:sticky md:top-0 md:h-screen`}
      >
        <div className="flex items-center justify-between px-4 py-3 md:py-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-dark.png" alt="Genesis" className="h-8 md:h-9 w-auto object-contain" />
          <button onClick={toggle} className={iconBtn} aria-label="Свернуть панель">✕</button>
        </div>

        <nav className="px-2.5 pb-2 md:pb-0 space-y-0.5 flex-1 md:overflow-y-auto">
          {WORK_AREAS.map((a) => {
            const active = a.href === "/" ? pathname === "/" : pathname.startsWith(a.href);
            return (
              <Link
                key={a.href}
                href={a.href}
                onClick={closeIfNarrow}
                className={`${item} ${
                  active
                    ? "bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm"
                    : "text-zinc-400 hover:text-violet-300 hover:bg-violet-900/15"
                }`}
              >
                {a.label}
              </Link>
            );
          })}
        </nav>

        {/* Аккаунт — вход в настройки. Команда, приглашения, интеграции и пароль
            живут там, а не в этой панели: сюда они добавлялись бы бесконечно. */}
        <div className="px-2.5 pb-3 pt-2 border-t border-violet-900/25">
          {profile ? (
            <Link
              href="/settings"
              onClick={closeIfNarrow}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl transition ${
                pathname.startsWith("/settings") ? "bg-violet-900/25" : "hover:bg-violet-900/15"
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm text-zinc-200 truncate">{profile.name || profile.email}</p>
                <p className="text-[11px] text-zinc-600">{profile.buyer_code ?? ROLE_LABELS[profile.role]}</p>
              </div>
              <span className="text-zinc-600 text-xs">›</span>
            </Link>
          ) : (
            <p className="px-3 py-2 text-[11px] text-zinc-600 leading-relaxed">
              Профиль не прочитался. Настройки недоступны, остальное работает.
            </p>
          )}
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        {/* Полоска с кнопкой — единственный способ вернуть убранную панель.
            Не sticky нарочно: на страницах свои липкие шапки, и две липкие
            полосы на одной высоте перекрывают друг друга. */}
        <div className={`${barShown} border-b border-violet-900/25 bg-[#0d0b14] px-3 py-2`}>
          <button onClick={toggle} className={iconBtn} aria-label="Показать панель">☰</button>
        </div>
        {children}
      </div>
    </div>
  );
}
