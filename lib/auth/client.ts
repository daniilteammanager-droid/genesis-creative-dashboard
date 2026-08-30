"use client";

import { createBrowserClient } from "@supabase/ssr";

// Браузерный клиент. Держит сессию в cookies, а не в localStorage — только так
// её видит сервер. Это единственная точка входа в Supabase из браузера.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
