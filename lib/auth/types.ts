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
  status: "active" | "disabled";
}

export const ROLE_LABELS: Record<UserRole, string> = {
  main: "Владелец",
  teamlead: "Тимлид",
  buyer: "Баер",
};
