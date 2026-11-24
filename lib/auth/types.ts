// Поле называется «Номер», поэтому «1» — это ровно то, что человек и напечатает.
// База ждёт «b1». Дописываем букву сами, вместо того чтобы отчитывать за формат.
export function normalizeBuyerCode(raw: string): string {
  const v = raw.trim().toLowerCase();
  return /^[0-9]+$/.test(v) ? `b${v}` : v;
}

// Роли дашборда. Совпадают с enum public.user_role (001_auth.sql, джун — 060_junior.sql).
export type UserRole = "main" | "teamlead" | "buyer" | "junior";

export interface Profile {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  // "b5". У main и тимлида обычно пустой — они не льют.
  buyer_code: string | null;
  crm_buyer_id: string | null;
  notion_url: string | null;
  // Таблица General 3.0. Живёт в профиле, а не в подключениях: её заводит и шарит
  // на сервисный аккаунт владелец, баеру там нечего вводить.
  gr_spreadsheet_id: string | null;
  // Таблица баера General 4.0 — отдельно от 3.0, оба отчёта живут рядом.
  gr4_spreadsheet_id: string | null;
  status: "active" | "disabled";
  // Прошёл обучалку; null — покажем при входе (Decision 078).
  onboarded_at: string | null;
  // Куда ведёт «/» после входа; null — Главная (lib/nav.ts).
  start_page: string | null;
  // "dark" | "light" | "system"; null — тёмная (lib/theme.ts).
  theme: string | null;
  // «Легаси крео» открыты баеру (Decision 119): новому закрыты, пока не покажет свои. Владелец — на «Команде».
  legacy_access: boolean;
  // Джун (060_junior.sql): чей он, какие разделы ему открыты (null — по умолчанию), свой AI-доступ.
  junior_of: string | null;
  junior_areas: string[] | null;
  junior_mcp: boolean;
  // Только у джуна, считает getProfile: разделы, которые он видит на деле (свои ∩ разделы баера),
  // и подпись баера; null — баер отключён или больше не баер.
  areas?: string[];
  buyer_label?: string | null;
  // Только у места джуна (getSeat): сам джун. Кто нажал — selfOf.
  actor?: Profile;
}

// Кто на деле нажал: у места джуна — сам джун, у остальных — тот же профиль.
export const selfOf = (p: Profile): Profile => p.actor ?? p;

// Колонки профиля — одни для getProfile, места джуна (getSeat) и MCP.
export const PROFILE_COLS = "id, email, name, role, buyer_code, crm_buyer_id, notion_url, gr_spreadsheet_id, gr4_spreadsheet_id, status, onboarded_at, start_page, theme, legacy_access, junior_of, junior_areas, junior_mcp";

// Владелец и тимлид видят легаси всегда, баер — если открыл владелец, джун — если раздел в его разделах
// (а туда он попадает, только когда открыт и баеру — juniorAreas в lib/nav.ts).
// ponytail: нет профиля (Supabase моргнул) — пускаем, как middleware со статусом (Decision 005).
export const canSeeLegacy = (p: (Pick<Profile, "role" | "legacy_access"> & { areas?: string[] }) | null | undefined) =>
  !p || (p.role === "junior" ? !!p.areas?.includes("/library") : p.role !== "buyer" || p.legacy_access !== false);

export const ROLE_LABELS: Record<UserRole, string> = {
  main: "Владелец",
  teamlead: "Тимлид",
  buyer: "Баер",
  junior: "Джун",
};
