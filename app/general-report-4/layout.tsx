import { getProfile } from "@/lib/auth/server";
import NoConnections from "@/components/NoConnections";

// Баер видит только свою таблицу GR 4.0. Без неё — экран с объяснением, а не
// общие таблицы команды (Decision 035).
export default async function GeneralReport4Layout({ children }: { children: React.ReactNode }) {
  const me = await getProfile();
  if (me?.role === "buyer" && !me.gr4_spreadsheet_id) {
    return (
      <NoConnections
        title="General Report 4.0"
        what="Твою таблицу подключает владелец — она появится здесь сама."
      />
    );
  }
  return <>{children}</>;
}
