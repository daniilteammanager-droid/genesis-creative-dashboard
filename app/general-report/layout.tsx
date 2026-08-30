import { getProfile } from "@/lib/auth/server";
import NoConnections from "@/components/NoConnections";

// Раздел работал на общих таблицах команды из env, то есть баер видел выгрузки всех.
// До появления подключений он просто не пускается сюда (Decision 035).
export default async function GeneralReportLayout({ children }: { children: React.ReactNode }) {
  const me = await getProfile();
  if (me?.role === "buyer") {
    return (
      <NoConnections
        title="General Report 3.0"
        what="Твою таблицу подключает владелец — она появится здесь сама, отдельной строкой, без чужих источников в переключателе."
      />
    );
  }
  return <>{children}</>;
}
