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
    .select("token, role, buyer_code, note, created_at, expires_at, used_at, junior_of")
    .order("created_at", { ascending: false });
  // Баеры — для приглашения джуна (060_junior.sql): джун регистрируется сразу к баеру.
  const { data: people } = await supabase.from("profiles").select("id, name, email, buyer_code")
    .eq("role", "buyer").eq("status", "active").order("created_at");
  const buyers = (people ?? []).map((b) => ({ id: b.id as string, label: `${(b.name as string | null) || (b.email as string)}${b.buyer_code ? ` · ${b.buyer_code}` : ""}` }));

  return (
    <>
      <p className="text-hint text-sm mb-5">
        Одноразовая ссылка на одного человека. Использованную повторно не открыть.
      </p>
      <InviteManager invites={(data as Invite[]) ?? []} buyers={buyers} />
    </>
  );
}
