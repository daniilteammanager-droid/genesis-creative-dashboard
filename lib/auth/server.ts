import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { PROFILE_COLS, type UserRole, type Profile } from "./types";
import { juniorAreas } from "@/lib/nav";
import { warehouse } from "@/lib/warehouse/read";

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
    .select(PROFILE_COLS)
    .eq("id", user.id)
    .maybeSingle();

  const p = (data as Profile | null) ?? null;
  // Джуну — его разделы на деле и подпись баера: строку баера политика не даёт, junior_buyer() — то, что нужно (060).
  if (p?.role === "junior") {
    const { data: b } = await supabase.rpc("junior_buyer").maybeSingle<{ name: string | null; buyer_code: string | null; status: string; role: string; legacy_access: boolean }>();
    const ok = !!b && b.status === "active" && b.role === "buyer";
    p.areas = juniorAreas(p.junior_areas, ok ? b : null);
    p.buyer_label = ok ? b.name || b.buyer_code : null;
  }
  return p;
});

// Чьи данные смотрит человек (060_junior.sql). Джуну — профиль его баера с ролью баера: загрузчики режут
// его как баера, и 49 проверок role === "buyer" не нужно трогать. «Легаси крео» — только если открыты и
// баеру, и джуну; кто нажал — actor (selfOf). Баер отключён или больше не баер — null. Остальным — свой профиль.
// Данные — через getSeat, личное (задачи, Telegram, AI-ключи, профиль) — через getProfile.
export const getSeat = cache(async function getSeat(): Promise<Profile | null> {
  return seatOf(await getProfile());
});

export async function seatOf(me: Profile | null): Promise<Profile | null> {
  if (!me || me.role !== "junior") return me;
  if (!me.junior_of) return null;
  const { data } = await warehouse().from("profiles").select(PROFILE_COLS).eq("id", me.junior_of).maybeSingle();
  const b = data as Profile | null;
  if (!b || b.status !== "active" || b.role !== "buyer") return null;
  const areas = me.areas ?? juniorAreas(me.junior_areas, b);
  return { ...b, legacy_access: b.legacy_access !== false && areas.includes("/library"), actor: me };
}

// Профиль с нужными правами или null. Проверка идёт на сервере: скрыть кнопку
// в интерфейсе — не защита, роут обязан проверять сам.
export async function requireRole(...roles: UserRole[]): Promise<Profile | null> {
  const profile = await getProfile();
  if (!profile || profile.status !== "active") return null;
  return roles.length === 0 || roles.includes(profile.role) ? profile : null;
}
