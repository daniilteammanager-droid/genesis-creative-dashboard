import type { IconName } from "@/components/ui";
import { canSeeLegacy } from "@/lib/auth/types";

// Рабочие области левой панели. Отдельно от Shell (он клиентский): тот же список
// проверяет стартовую страницу на сервере — в профиль можно записать что угодно.
// Иконка — из набора <Icon> (components/ui.tsx); новой нет — путь туда же.
export const WORK_AREAS: { href: string; label: string; icon: IconName }[] = [
  { href: "/home", label: "Главная", icon: "home" },
  // Личный холст задач у каждого и общие холсты (02.11.2026).
  { href: "/tasks", label: "Задачи", icon: "tasks" },
  { href: "/library", label: "Легаси крео", icon: "archive" },
  { href: "/creatives", label: "Креативы", icon: "film" },
  { href: "/check", label: "Checks", icon: "check" },
  { href: "/live-manager", label: "Live Manager", icon: "pulse" },
  // /reports занят переадресацией на Live Manager (next.config.ts).
  { href: "/traffic-report", label: "Отчёты", icon: "chart" },
  // General 3.0 из панели убран: им больше не пользуются (Daniil 26.10.2026). Роут живой.
  { href: "/general-report-4", label: "General 4.0", icon: "table" },
  { href: "/autoupload", label: "Автозалив", icon: "rocket" },
  { href: "/antireject", label: "Антиотклон", icon: "shield" },
  { href: "/uniquify", label: "Уникализация", icon: "layers" },
  { href: "/topups", label: "Пополнения", icon: "wallet" },
];

export const DEFAULT_START = "/home";

// Области, которые человек видит: «Легаси крео» закрыты новому баеру (Decision 119).
// Это только панель — сам /library проверяет доступ в app/library/layout.tsx.
export const areasFor = (p: Parameters<typeof canSeeLegacy>[0]) =>
  canSeeLegacy(p) ? WORK_AREAS : WORK_AREAS.filter((a) => a.href !== "/library");

export const startPageOf = (v: string | null | undefined, areas = WORK_AREAS) =>
  areas.some((a) => a.href === v) ? (v as string) : DEFAULT_START;
