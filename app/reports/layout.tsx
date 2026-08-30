import { getProfile } from "@/lib/auth/server";
import { reportConfigFor } from "@/lib/reports-live/config";
import NoConnections from "@/components/NoConnections";

// Отчёт собирается по ключам того, кто его открыл: у владельца и тимлида это
// командные ключи, у баера — его собственные (Decision 035). Без подключений
// баеру показывать нечего, и лучше сказать это прямо, чем отдать пустую таблицу.
export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  const me = await getProfile();

  if (me?.role === "buyer") {
    const config = await reportConfigFor(me);
    if ("missing" in config) {
      return (
        <NoConnections
          title="Reports"
          what={`Отчёт собирается по твоим ключам. Не хватает: ${config.missing.join(", ")}. Завести можно в Настройках → Интеграции.`}
        />
      );
    }
  }
  return <>{children}</>;
}
