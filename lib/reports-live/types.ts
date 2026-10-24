// Типы клиента Meta Marketing API. От старого Live-отчёта здесь остался только
// LiveMode — режим живого отчёта.

export type LiveMode = "campaigns" | "ads";

export interface MetaCampaignRow {
  campaignId: string;
  campaignName: string;
  accountId: string;
  accountName: string;
  spend: number;
  clicks: number;
  impressions: number;
}

export interface MetaAdRow {
  adId: string;
  adName: string;
  // Нужен, чтобы достать страну таргета: гео живёт в настройках адсета, а не в
  // имени (Decision 045). Поле и так запрашивается у Meta, оставалось донести.
  adsetId: string;
  campaignId: string;
  campaignName: string;
  accountId: string;
  accountName: string;
  spend: number;
  clicks: number;
  impressions: number;
}
