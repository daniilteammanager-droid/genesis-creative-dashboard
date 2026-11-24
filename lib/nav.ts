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

// Области, которые человек видит: «Легаси крео» закрыты новому баеру (Decision 119), у джуна —
// его разделы на деле (p.areas, считает getProfile). Это только панель — доступ режут middleware
// (джуна — juniorMay ниже) и app/library/layout.tsx.
export const areasFor = (p: Parameters<typeof canSeeLegacy>[0]) =>
  p?.role === "junior" ? WORK_AREAS.filter((a) => p.areas?.includes(a.href))
  : canSeeLegacy(p) ? WORK_AREAS : WORK_AREAS.filter((a) => a.href !== "/library");

// Стартовая не из своих разделов — Главная, а у джуна без Главной — первый открытый раздел или Настройки:
// закрытая стартовая крутила бы «/» ↔ middleware по кругу.
export const startPageOf = (v: string | null | undefined, areas = WORK_AREAS) =>
  areas.some((a) => a.href === v) ? (v as string)
  : areas.some((a) => a.href === DEFAULT_START) ? DEFAULT_START : areas[0]?.href ?? "/settings";

// ─── Джун (060_junior.sql) ───────────────────────────────────────────────────

// По умолчанию джуну закрыты деньги (24.11.2026, Даниил). Остальное открыто.
export const JUNIOR_OFF = ["/general-report-4", "/topups"];
export const juniorDefault = () => WORK_AREAS.map((a) => a.href).filter((h) => !JUNIOR_OFF.includes(h));

// Разделы джуна на деле: выбранные (null — по умолчанию) ∩ разделы его баера, поэтому закрыли баеру легаси —
// у джуна они пропали сами. Баер отключён или больше не баер — остаётся только личное: Задачи.
export function juniorAreas(chosen: string[] | null, buyer: { role: string; status: string; legacy_access: boolean } | null): string[] {
  const mine = chosen ?? juniorDefault();
  const ok = buyer && buyer.status === "active" && buyer.role === "buyer" ? areasFor(buyer as Parameters<typeof areasFor>[0]).map((a) => a.href) : ["/tasks"];
  return WORK_AREAS.map((a) => a.href).filter((h) => mine.includes(h) && ok.includes(h));
}

const under = (path: string, p: string) => path === p || path.startsWith(`${p}/`);

// Ключи и подключения баера джуну закрыты целиком, как и админка.
const JUNIOR_NEVER = [
  "/settings/integrations", "/settings/team", "/settings/invites", "/settings/juniors",
  "/api/connections", "/api/meta-keys", "/api/tgads-keys", "/api/fbtool", "/api/dolphin", "/api/accounts",
  "/api/telegram", "/api/sheets", "/api/gr-sheets", "/api/ai/budget", "/api/ai/summary",
];
// Свой Claude или Codex — только если включили (profiles.junior_mcp).
const JUNIOR_MCP = ["/settings/ai", "/api/mcp-tokens", "/oauth/authorize", "/api/oauth/authorize"];
// Страница или API → разделы, любой из которых его открывает. Общие API (медиа, модалка крео, AI-разбор)
// не режем: они и так отдают джуну данные только его баера (getSeat).
const AREA_OF: [string, string[]][] = [
  ["/reports", ["/live-manager"]],
  ["/general-report", ["/general-report-4"]],
  ["/api/general-report", ["/general-report-4"]],
  ["/api/general-report-4", ["/general-report-4"]],
  ["/api/topups", ["/topups"]],
  ["/api/autoupload", ["/autoupload"]],
  // Уникализация ставит задания через /api/antireject (op uniq) — тот же роут, что антиотклон.
  ["/api/antireject", ["/antireject", "/uniquify"]],
  ["/api/report-live", ["/live-manager"]],
  ["/api/report-tree", ["/live-manager"]],
  ["/api/traffic-report", ["/traffic-report"]],
  ["/api/check", ["/check"]],
  ["/api/home", ["/home"]],
  ["/api/tasks", ["/tasks"]],
  ["/api/legacy", ["/library"]],
  ...WORK_AREAS.map((a): [string, string[]] => [a.href, [a.href]]),
];

// Пускает ли middleware джуна по адресу: страница закрытого раздела и её API — нет.
export function juniorMay(path: string, areas: string[], mcp: boolean): boolean {
  if (JUNIOR_NEVER.some((p) => under(path, p))) return false;
  if (JUNIOR_MCP.some((p) => under(path, p))) return mcp;
  const hit = AREA_OF.find(([p]) => under(path, p));
  return !hit || hit[1].some((a) => areas.includes(a));
}

// Инструменты MCP джуна — по тем же разделам. Нет в списке — джуну не виден.
const TOOL_AREAS: Record<string, string[]> = {
  get_stats: ["/traffic-report"],
  get_campaigns: ["/live-manager"], get_live_state: ["/live-manager"], manage_campaigns: ["/live-manager"], get_cabinets: ["/live-manager"],
  get_creative: ["/creatives", "/traffic-report"], get_transcript: ["/creatives", "/traffic-report"], get_ai_analysis: ["/creatives", "/traffic-report"],
  get_check: ["/check"],
  get_rejects: ["/antireject"],
  get_tasks: ["/tasks"], add_tasks: ["/tasks"], update_tasks: ["/tasks"], delete_tasks: ["/tasks"], create_board: ["/tasks"], update_board: ["/tasks"],
  get_topups: ["/topups"], create_topup: ["/topups"],
};
export const juniorTool = (name: string, areas: string[]) => (TOOL_AREAS[name] ?? []).some((a) => areas.includes(a));
