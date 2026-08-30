import { redirect } from "next/navigation";
import { requireRole, createClient } from "@/lib/auth/server";
import TeamManager from "./TeamManager";
import type { Profile } from "@/lib/auth/types";

// Список команды. Проверка роли на сервере: спрятать ссылку в интерфейсе — не защита,
// адрес всё равно можно набрать руками.
export default async function TeamPage() {
  const me = await requireRole("main");
  if (!me) redirect("/settings");

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, email, name, role, buyer_code, crm_buyer_id, notion_url, gr_spreadsheet_id, status")
    .order("created_at", { ascending: true });

  return (
    <>
      <p className="text-zinc-500 text-sm mb-5">
        Роль, номер баера и доступ. Изменения применяются сразу.
      </p>
      <TeamManager people={(data as Profile[]) ?? []} meId={me.id} />
    </>
  );
}
