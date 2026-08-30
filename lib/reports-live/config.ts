import { getConnection } from "@/lib/connections/store";
import type { Profile } from "@/lib/auth/types";
import type { LiveMode } from "./types";

// Откуда Reports берут данные для конкретного человека.
//
// Раньше источник был один на всех — переменные окружения. Значит и отчёт был
// один на всех: разграничить его было нечем, потому что все цифры добыты одними
// и теми же ключами.
//
// Теперь владелец и тимлид работают на командных ключах (кабинеты расшарены, и
// этот ключ и есть сводная картина), а баер — только на своих.

export interface ReportConfig {
  // Ключ кэша. Общий кэш без него означал бы, что один баер получает
  // закэшированные цифры другого — молча и правдоподобно.
  cacheKey: string;
  metaToken: string;
  campaignsSheetId: string;
  adsSheetId: string;
  adsByIdSheetId?: string;
}

export interface MissingConfig {
  missing: string[];
}

// Чего не хватает для конкретного режима. Спрашивать все три источника разом
// неправильно: «Кампании» работают без выгрузки по объявлениям и наоборот, а
// человек с половиной подключений не должен упираться в стену на обоих режимах.
function whatIsMissing(
  mode: LiveMode | undefined,
  names: { token: string; campaigns: string; ads: string },
  has: { token: boolean; campaigns: boolean; ads: boolean }
): string[] {
  const missing: string[] = [];
  if (!has.token) missing.push(names.token);
  if (mode === "campaigns" && !has.campaigns) missing.push(names.campaigns);
  if (mode === "ads" && !has.ads) missing.push(names.ads);
  // Без режима (проверка на входе в раздел) достаточно одного из двух источников.
  if (!mode && !has.campaigns && !has.ads) missing.push(names.campaigns);
  return missing;
}

export async function reportConfigFor(me: Profile, mode?: LiveMode): Promise<ReportConfig | MissingConfig> {
  if (me.role === "buyer") {
    const c = await getConnection(me.id);
    const missing = whatIsMissing(
      mode,
      { token: "ключ Meta", campaigns: "выгрузку Torro по кампаниям", ads: "выгрузку Torro по объявлениям" },
      { token: Boolean(c?.metaToken), campaigns: Boolean(c?.crmCampaignsSheetId), ads: Boolean(c?.crmAdsSheetId) }
    );
    if (missing.length > 0) return { missing };

    return {
      cacheKey: me.id,
      metaToken: c!.metaToken as string,
      campaignsSheetId: c!.crmCampaignsSheetId ?? "",
      adsSheetId: c!.crmAdsSheetId ?? "",
      // Третья выгрузка: депозиты на конкретном объявлении и на адсете берутся
      // только отсюда — строка по имени предагрегирована и не делится.
      adsByIdSheetId: c!.crmAdsByIdSheetId ?? undefined,
    };
  }

  const metaToken = process.env.META_ACCESS_TOKEN;
  const campaignsSheetId = process.env.MVP_CAMPAIGN_DAILY_SHEET_ID;
  const adsSheetId = process.env.GR_SPREADSHEET_ADS_BY_NAME;

  const missing = whatIsMissing(
    mode,
    { token: "META_ACCESS_TOKEN", campaigns: "MVP_CAMPAIGN_DAILY_SHEET_ID", ads: "GR_SPREADSHEET_ADS_BY_NAME" },
    { token: Boolean(metaToken), campaigns: Boolean(campaignsSheetId), ads: Boolean(adsSheetId) }
  );
  if (missing.length > 0) return { missing };

  return {
    cacheKey: "team",
    metaToken: metaToken as string,
    campaignsSheetId: campaignsSheetId ?? "",
    adsSheetId: adsSheetId ?? "",
    // Резервный путь матча по Ad ID. Необязателен, у баеров его нет вовсе.
    adsByIdSheetId: process.env.GR_SPREADSHEET_ADS,
  };
}
