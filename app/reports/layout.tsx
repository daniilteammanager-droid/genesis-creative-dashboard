import { getProfile } from "@/lib/auth/server";
import NoConnections from "@/components/NoConnections";

// Отчёт собирался по общему ключу Meta и общим выгрузкам Торро, то есть по всей
// команде. Баер получит его тогда, когда подключит свои (Decision 035).
export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  const me = await getProfile();
  if (me?.role === "buyer") {
    return (
      <NoConnections
        title="Reports"
        what="Отчёт собирается по твоему ключу Meta и твоей выгрузке Torro CRM. Заведи их в Настройках → Интеграции, и раздел заработает."
      />
    );
  }
  return <>{children}</>;
}
