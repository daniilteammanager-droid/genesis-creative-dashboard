"use client";

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

  // На входе оболочка не нужна. А вот отсутствие профиля на рабочей странице — это
  // не «не залогинен» (таких сюда не пускает middleware), а «Supabase не ответил».
  // Панель в этом случае обязана остаться: дашборд не теряет навигацию из-за
  // недоступности Supabase (Decision 005).
  if (pathname === "/login") return <>{children}</>;

  const item = "block px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition";
  const inSettings = pathname.startsWith("/settings");

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-[#0a080f]">
      {/* На узком экране панель ложится сверху полосой: колонка в 212px съела бы
          половину телефона, а таблицы отчётов и так требуют широкого экрана. */}
      <aside
        className="md:w-[212px] flex-shrink-0 bg-[#0d0b14] border-b md:border-b-0 md:border-r
                   border-violet-900/25 flex flex-col md:sticky md:top-0 md:h-screen"
      >
        <div className="hidden md:block px-4 py-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-dark.png" alt="Genesis" className="h-9 w-auto object-contain" />
        </div>

        <nav className="flex md:block gap-1 md:space-y-0.5 px-2.5 py-2 md:py-0 flex-1
                        overflow-x-auto md:overflow-x-visible md:overflow-y-auto">
          {WORK_AREAS.map((a) => {
            const active = a.href === "/" ? pathname === "/" : pathname.startsWith(a.href);
            return (
              <Link
                key={a.href}
                href={a.href}
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
        <div className="px-2.5 pb-2 md:pb-3 md:pt-2 md:border-t border-violet-900/25">
          {profile ? (
            <Link
              href="/settings"
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl transition ${
                inSettings ? "bg-violet-900/25" : "hover:bg-violet-900/15"
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

      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
