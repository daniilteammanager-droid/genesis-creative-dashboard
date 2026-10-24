import { getProfile } from "@/lib/auth/server";
import { listMetaKeys } from "@/lib/connections/metaKeys";
import { getConnection } from "@/lib/connections/store";
import NoConnections from "@/components/NoConnections";

// Отчёт баера собирается по его интеграциям (Decision 061). Без ключа Meta
// показывать нечего, и лучше сказать это прямо, чем отдать пустую таблицу.
// Владелец и тимлид видят сводную по всем — им заглушка не нужна.
export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  const me = await getProfile();

  if (me?.role === "buyer") {
    // Сбой чтения ключей не должен класть раздел — дальше ответит роут и
    // объяснит причину текстом.
    const [keys, conn] = await Promise.all([listMetaKeys(me.id).catch(() => null), getConnection(me.id).catch(() => null)]);
    // Dolphin и TG Ads — источники без ключей Meta (Decision 063, 068).
    if (keys && keys.length === 0 && !conn?.spendSource) {
      return (
        <NoConnections
          title="Reports"
          what="Отчёт собирается по твоим интеграциям. Подключи источник расхода (Meta, Dolphin или Telegram Ads) в Настройках → Интеграции — история догрузится сама."
        />
      );
    }
  }
  return <>{children}</>;
}
