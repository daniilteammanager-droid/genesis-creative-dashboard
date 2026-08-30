import { getConnection } from "@/lib/connections/store";
import type { Profile } from "@/lib/auth/types";

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
  campaignsUrl: string;
  adsSheetId: string;
  adsByIdSheetId?: string;
}

export interface MissingConfig {
  missing: string[];
}

export async function reportConfigFor(me: Profile): Promise<ReportConfig | MissingConfig> {
  if (me.role === "buyer") {
    const c = await getConnection(me.id);
    const missing: string[] = [];
    if (!c?.metaToken) missing.push("ключ Meta");
    if (!c?.crmCampaignsUrl) missing.push("выгрузку Torro по кампаниям");
    if (!c?.crmAdsSheetId) missing.push("выгрузку Torro по объявлениям");
    if (missing.length > 0 || !c) return { missing };

    return {
      cacheKey: me.id,
      metaToken: c.metaToken as string,
      campaignsUrl: c.crmCampaignsUrl as string,
      adsSheetId: c.crmAdsSheetId as string,
    };
  }

  const metaToken = process.env.META_ACCESS_TOKEN;
  const campaignsUrl = process.env.MVP_CAMPAIGN_WEEKLY_XLSX_URL;
  const adsSheetId = process.env.GR_SPREADSHEET_ADS_BY_NAME;

  const missing: string[] = [];
  if (!metaToken) missing.push("META_ACCESS_TOKEN");
  if (!campaignsUrl) missing.push("MVP_CAMPAIGN_WEEKLY_XLSX_URL");
  if (!adsSheetId) missing.push("GR_SPREADSHEET_ADS_BY_NAME");
  if (missing.length > 0) return { missing };

  return {
    cacheKey: "team",
    metaToken: metaToken as string,
    campaignsUrl: campaignsUrl as string,
    adsSheetId: adsSheetId as string,
    // Резервный путь матча по Ad ID. Необязателен, у баеров его обычно нет.
    adsByIdSheetId: process.env.GR_SPREADSHEET_ADS,
  };
}
