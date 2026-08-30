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

  // Чем убранная панель возвращается:
  //   на компе — узким столбцом в раскладке, он виден всегда и ничего не перекрывает;
  //   на телефоне — кнопкой в углу, столбец съел бы восьмую часть ширины.
  // Липкой полосы сверху здесь быть не может: у страниц свои липкие шапки на top-0 —
  // фильтры Креативов и заголовки таблиц Reports, — и полоса накрыла бы их.
  const asideShown = open === null ? "hidden md:flex" : open ? "flex" : "hidden";
  // На телефоне панель выезжает слева поверх страницы, а не встаёт блоком в начале
  // документа. В потоке она открывалась там, куда человек уже не смотрит: прокрутил
  // список, нажал кнопку — панель осталась выше экрана, и казалось, что её нет.
  const asidePlace =
    "fixed inset-y-0 left-0 z-50 w-[264px] overflow-y-auto " +
    "md:sticky md:top-0 md:bottom-auto md:z-auto md:w-[212px] md:h-screen md:overflow-visible";
  const railShown  = open === false ? "hidden md:flex" : "hidden";
  const fabShown   = open === true  ? "hidden"         : "md:hidden";

  const item = "block px-3 py-2 rounded-xl text-sm font-medium transition";
  const iconBtn =
    "flex items-center justify-center h-8 w-8 rounded-lg text-zinc-500 " +
    "hover:text-violet-300 hover:bg-violet-900/20 transition text-base leading-none";

  return (
    <div className="flex min-h-screen bg-[#0a080f]">
      {/* Подложка под выехавшей панелью — только на телефоне. Закрывает по тапу
          мимо: искать крестик ради этого не должно быть нужно. */}
      {open === true && (
        <div
          onClick={() => setOpen(false)}
          className="md:hidden fixed inset-0 z-40 bg-black/60"
          aria-hidden
        />
      )}

      <aside
        className={`${asideShown} ${asidePlace} flex-shrink-0 bg-[#0d0b14] flex-col
                    border-r border-violet-900/25`}
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
                prefetch
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

      {/* Столбец-огрызок вместо убранной панели — только на компе. */}
      <div
        className={`${railShown} w-[52px] flex-shrink-0 flex-col items-center pt-4
                    bg-[#0d0b14] border-r border-violet-900/25 sticky top-0 h-screen`}
      >
        <button onClick={toggle} className={iconBtn} aria-label="Показать панель">☰</button>
      </div>

      <div className="flex-1 min-w-0">{children}</div>

      {/* Кнопка в углу — только на телефоне. Внизу, а не вверху: сверху она попала
          бы под липкие шапки страниц, а до низа ещё и большой палец дотягивается.
          z-40 — под модалом креатива (z-50), над содержимым. */}
      <button
        onClick={toggle}
        aria-label="Показать панель"
        className={`${fabShown} fixed bottom-4 left-4 z-40 h-11 w-11 rounded-full
                    bg-gradient-to-r from-violet-600 to-violet-500 text-white text-lg
                    shadow-lg shadow-violet-900/40 active:scale-95 transition`}
      >
        ☰
      </button>
    </div>
  );
}
