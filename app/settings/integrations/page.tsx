import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth/server";
import { getConnectionView } from "@/lib/connections/store";
import ConnectionsForm from "./ConnectionsForm";

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

  return (
    <ConnectionsForm
      initial={view}
      loadError={error}
      serviceAccount={process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null}
      grSheetId={profile.gr_spreadsheet_id ?? null}
    />
  );
}
