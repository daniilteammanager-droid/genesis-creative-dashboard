import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { UserRole, Profile } from "./types";

// Серверный клиент Supabase: сессия живёт в cookies, поэтому её видят и route
// handlers, и middleware. Раньше сессии не было вовсе, а клиент ходил в Supabase
// напрямую с публичным anon-ключом.

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Component не может писать cookies. Обновлением сессии
            // занимается middleware, так что здесь это безопасно проглотить.
          }
        },
      },
    }
  );
}

// Профиль текущего пользователя или null. Namesake auth.getUser() ходит на
// сервер Supabase и проверяет подпись токена — в отличие от getSession(),
// которому можно подсунуть что угодно из cookie.
// cache() на один проход рендера: профиль спрашивают и корневой layout ради левой
// панели, и layout настроек, и сама страница через requireRole. Без него это три
// похода в Supabase на каждый запрос вместо одного.
export const getProfile = cache(async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("id, email, name, role, buyer_code, crm_buyer_id, notion_url, status")
    .eq("id", user.id)
    .maybeSingle();

  return (data as Profile | null) ?? null;
});

// Профиль с нужными правами или null. Проверка идёт на сервере: скрыть кнопку
// в интерфейсе — не защита, роут обязан проверять сам.
export async function requireRole(...roles: UserRole[]): Promise<Profile | null> {
  const profile = await getProfile();
  if (!profile || profile.status !== "active") return null;
  return roles.length === 0 || roles.includes(profile.role) ? profile : null;
}
