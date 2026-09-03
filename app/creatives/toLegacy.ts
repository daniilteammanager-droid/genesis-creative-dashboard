import type { CreativeRow } from "@/lib/warehouse/creatives";
import type { CreativeRow as LegacyRow } from "@/lib/creatives/types";

// Модал крео и Медиатека построены на строке легаси-библиотеки: там метрики за
// всё время и строками. Переводим строку склада в ту же форму, чтобы не плодить
// второй модал и вторую Медиатеку ради тех же самых экранов.
export function toLegacy(r: CreativeRow): LegacyRow {
  const revenue = (r.depSum ?? 0) + (r.redepSum ?? 0);
  return {
    creative: r.code,
    spend: String(r.spend ?? 0),
    revenue: String(revenue),
    deposits: String(r.depCount ?? 0),
    pdp: String(r.subscribers ?? 0),
    dia: String(r.dialogs ?? 0),
    romi: r.spend > 0 ? String(((revenue - r.spend) / r.spend) * 100) : "",
    text: "",
  };
}
