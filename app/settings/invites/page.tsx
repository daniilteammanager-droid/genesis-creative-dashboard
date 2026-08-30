import { redirect } from "next/navigation";
import { requireRole, createClient } from "@/lib/auth/server";
import InviteManager, { type Invite } from "./InviteManager";

// Приглашения выписывает только владелец. Проверка на сервере, а не скрытой
// кнопкой: спрятать ссылку в интерфейсе — не защита.
export default async function InvitesPage() {
  const profile = await requireRole("main");
  if (!profile) redirect("/settings");

  // Список читается здесь, а не эффектом на клиенте: сервер и так знает сессию,
  // а RLS всё равно отдаст только то, что положено владельцу.
  const supabase = await createClient();
  const { data } = await supabase
    .from("invites")
    .select("token, role, buyer_code, note, created_at, expires_at, used_at")
    .order("created_at", { ascending: false });

  return (
    <>
      <p className="text-zinc-500 text-sm mb-5">
        Одноразовая ссылка на одного человека. Использованную повторно не открыть.
      </p>
      <InviteManager invites={(data as Invite[]) ?? []} />
    </>
  );
}
