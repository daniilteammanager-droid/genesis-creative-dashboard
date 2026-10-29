// Рабочие области левой панели. Отдельно от Shell (он клиентский): тот же список
// проверяет стартовую страницу на сервере — в профиль можно записать что угодно.
export const WORK_AREAS = [
  { href: "/home", label: "Главная" },
  { href: "/library", label: "Легаси крео" },
  { href: "/creatives", label: "Креативы" },
  { href: "/check", label: "Checks" },
  { href: "/live-manager", label: "Live Manager" },
  // /reports занят переадресацией на Live Manager (next.config.ts).
  { href: "/traffic-report", label: "Отчёты" },
  // General 3.0 из панели убран: им больше не пользуются (Daniil 26.10.2026). Роут живой.
  { href: "/general-report-4", label: "General 4.0" },
  { href: "/autoupload", label: "Автозалив" },
  { href: "/antireject", label: "Антиотклон" },
  { href: "/uniquify", label: "Уникализация" },
  { href: "/topups", label: "Пополнения" },
];

export const DEFAULT_START = "/home";

export const startPageOf = (v: string | null | undefined) =>
  WORK_AREAS.some((a) => a.href === v) ? (v as string) : DEFAULT_START;
