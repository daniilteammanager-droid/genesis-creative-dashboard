// Поле называется «Номер», поэтому «1» — это ровно то, что человек и напечатает.
// База ждёт «b1». Дописываем букву сами, вместо того чтобы отчитывать за формат.
export function normalizeBuyerCode(raw: string): string {
  const v = raw.trim().toLowerCase();
  return /^[0-9]+$/.test(v) ? `b${v}` : v;
}

// Роли дашборда. Совпадают с enum public.user_role в supabase/001_auth.sql.
export type UserRole = "main" | "teamlead" | "buyer";

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
  status: "active" | "disabled";
}

export const ROLE_LABELS: Record<UserRole, string> = {
  main: "Владелец",
  teamlead: "Тимлид",
  buyer: "Баер",
};
