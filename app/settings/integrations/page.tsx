import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth/server";
import { getConnectionView } from "@/lib/connections/store";
import ConnectionsForm from "./ConnectionsForm";
import GrSheets, { type GrSheet } from "./GrSheets";
import { createClient } from "@/lib/auth/server";

export default async function IntegrationsPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  // Читаем на сервере: таблица подключений закрыта от браузера, а страница и так
  // серверная — лишний круг через свой же API ей ни к чему.
  let view = null;
  let error: string | null = null;
  try {
    view = await getConnectionView(profile.id);
  } catch (e) {
    error = e instanceof Error ? e.message : "Не удалось прочитать подключения";
  }

  const isMain = profile.role === "main";
  const serviceAccount = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null;

  // Общие таблицы читаются политикой RLS, поэтому обычным клиентом сессии —
  // список сам собой окажется пустым у того, кому он не положен.
  let sheets: GrSheet[] = [];
  if (isMain) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("gr_spreadsheets")
      .select("id, name, spreadsheet_id, kind")
      .order("sort", { ascending: true })
      .order("created_at", { ascending: true });
    sheets = (data as GrSheet[]) ?? [];
  }

  return (
    <div className="space-y-4">
      <ConnectionsForm
        initial={view}
        loadError={error}
        serviceAccount={serviceAccount}
        grSheetId={profile.gr_spreadsheet_id ?? null}
        isMain={isMain}
      />
      {isMain && <GrSheets sheets={sheets} serviceAccount={serviceAccount} />}
    </div>
  );
}
