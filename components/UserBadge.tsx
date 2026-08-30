"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/auth/client";
import { ROLE_LABELS, type Profile } from "@/lib/auth/types";

// Кто вошёл и кнопка выхода. Живёт в layout, а не в шапке каждой страницы:
// навигация продублирована на четырёх страницах, и класть это в каждую — значит
// потом чинить в четырёх местах.
export default function UserBadge() {
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let alive = true;

    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user || !alive) return;
      const { data } = await supabase
        .from("profiles")
        .select("id, email, name, role, buyer_code, crm_buyer_id, notion_url, status")
        .eq("id", user.id)
        .maybeSingle();
      if (alive) setProfile((data as Profile | null) ?? null);
    });

    return () => { alive = false; };
  }, []);

  if (!profile) return null;

  async function signOut() {
    await createClient().auth.signOut();
    // Полная перезагрузка, чтобы middleware увидел, что cookie больше нет.
    window.location.assign("/login");
  }

  return (
    <div className="fixed top-3 right-4 z-50 flex items-center gap-2.5 bg-[#111118]/90 backdrop-blur-md border border-violet-900/40 rounded-xl px-3 py-1.5 text-xs">
      <span className="text-zinc-300 font-medium">{profile.name || profile.email}</span>
      <span className="text-violet-300/80 bg-violet-900/30 border border-violet-700/30 rounded-md px-1.5 py-0.5">
        {profile.buyer_code ?? ROLE_LABELS[profile.role]}
      </span>
      <button onClick={signOut} className="text-zinc-500 hover:text-violet-300 transition" title="Выйти">
        Выйти
      </button>
    </div>
  );
}
