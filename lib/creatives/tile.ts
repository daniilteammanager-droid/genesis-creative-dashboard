import type { CreativeRow as LegacyRow } from "./types";
import type { CreativeRow } from "@/lib/warehouse/creatives";
import { parseNumber } from "./format";

// Цифры карточки крео — одни и те же для легаси (CSV за всё время) и новой
// картотеки (склад за период), чтобы обе плитки выглядели и считались одинаково.
export interface TileMetrics {
  spend: number | null;
  revenue: number | null;
  romi: number | null; // в процентах
  cpdp: number | null; // цена ПДП
  cdia: number | null; // цена диалога
  cdep: number | null; // цена депа: спенд / депы
}

// Цена — из сумм за период, а не усреднением по дням (Decision 024).
export const costPer = (spend: number, count: number | null) => (count && count > 0 ? spend / count : null);

export const revenueOf = (r: CreativeRow) => (r.depSum ?? 0) + (r.redepSum ?? 0);
export const romiOf = (r: CreativeRow) => (r.spend > 0 ? ((revenueOf(r) - r.spend) / r.spend) * 100 : null);

const num = (s: string) => {
  const n = parseNumber(s);
  return Number.isFinite(n) ? n : null;
};

export function warehouseTile(r: CreativeRow): TileMetrics {
  const revenue = revenueOf(r);
  return {
    spend: r.spend,
    revenue: revenue > 0 ? revenue : null,
    romi: romiOf(r),
    cpdp: costPer(r.spend, r.subscribers),
    cdia: costPer(r.spend, r.dialogs),
    cdep: costPer(r.spend, r.depCount),
  };
}

// В CSV легаси pdp и dia — уже цены, депы — количество.
export function legacyTile(r: LegacyRow): TileMetrics {
  const spend = num(r.spend);
  return {
    spend,
    revenue: num(r.revenue),
    romi: num(r.romi),
    cpdp: num(r.pdp),
    cdia: num(r.dia),
    cdep: spend === null ? null : costPer(spend, num(r.deposits)),
  };
}
