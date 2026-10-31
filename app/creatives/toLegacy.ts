import type { CreativeRow } from "@/lib/warehouse/creatives";
import type { CreativeRow as LegacyRow } from "@/lib/creatives/types";
import { costPer, revenueOf, romiOf } from "@/lib/creatives/tile";

// Модал крео и Медиатека построены на строке легаси-библиотеки: там метрики за
// всё время и строками. Переводим строку склада в ту же форму, чтобы не плодить
// второй модал и вторую Медиатеку ради тех же самых экранов.
// В CSV легаси pdp и dia — цены, поэтому и здесь цены, а не количество.
export function toLegacy(r: CreativeRow): LegacyRow {
  const str = (n: number | null) => (n === null ? "" : String(n));
  return {
    creative: r.code,
    spend: String(r.spend ?? 0),
    revenue: String(revenueOf(r)),
    deposits: String(r.depCount ?? 0),
    pdp: str(costPer(r.spend, r.subscribers)),
    dia: str(costPer(r.spend, r.dialogs)),
    romi: str(romiOf(r)),
    text: "",
  };
}
