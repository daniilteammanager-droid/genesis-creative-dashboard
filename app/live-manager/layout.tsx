import { getProfile } from "@/lib/auth/server";
import { listMetaKeys } from "@/lib/connections/metaKeys";
import { getConnection } from "@/lib/connections/store";
import { listTgadsKeys } from "@/lib/connections/tgadsKeys";
import NoConnections from "@/components/NoConnections";

// Отчёт баера собирается по его интеграциям (Decision 061). Без ключа Meta
// показывать нечего, и лучше сказать это прямо, чем отдать пустую таблицу.
// Владелец и тимлид видят сводную по всем — им заглушка не нужна.
export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  const me = await getProfile();

  if (me?.role === "buyer") {
    // Сбой чтения ключей не должен класть раздел — дальше ответит роут и
    // объяснит причину текстом.
    const [keys, conn, tg] = await Promise.all([
      listMetaKeys(me.id).catch(() => null), getConnection(me.id).catch(() => null), listTgadsKeys(me.id).catch(() => null),
    ]);
    // Dolphin — источник без ключей Meta (Decision 063), TG Ads — своя площадка (Decision 069).
    if (keys && keys.length === 0 && !conn?.spendSource && tg && tg.length === 0) {
      return (
        <NoConnections
          title="Live Manager"
          what="Отчёт собирается по твоим интеграциям. Подключи источник расхода (Meta, Dolphin или Telegram Ads) в Настройках → Интеграции — история догрузится сама."
        />
      );
    }
  }
  return <>{children}</>;
}
