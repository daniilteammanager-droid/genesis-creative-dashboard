import { redirect } from "next/navigation";
import { requireRole, createClient } from "@/lib/auth/server";
import InviteManager, { type Invite } from "./InviteManager";

// Приглашения выписывает только владелец. Проверка на сервере, а не скрытой
// кнопкой: спрятать ссылку в интерфейсе — не защита.
export default async function InvitesPage() {
  const profile = await requireRole("main");
  if (!profile) redirect("/");

  // Список читается здесь, а не эффектом на клиенте: сервер и так знает сессию,
  // а RLS всё равно отдаст только то, что положено владельцу.
  const supabase = await createClient();
  const { data } = await supabase
    .from("invites")
    .select("token, role, note, created_at, expires_at, used_at")
    .order("created_at", { ascending: false });

  return (
    <main className="min-h-screen bg-[#0a080f] text-white p-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-semibold mb-1">Приглашения</h1>
        <p className="text-zinc-500 text-sm mb-8">
          Одноразовая ссылка на одного человека. Использованную повторно не открыть.
        </p>
        <InviteManager invites={(data as Invite[]) ?? []} />
      </div>
    </main>
  );
}
