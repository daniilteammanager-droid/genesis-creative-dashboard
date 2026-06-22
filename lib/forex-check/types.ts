export type Entity = "campaign" | "ad";
export type EntityMode = "auto" | "campaign" | "ad";

export interface SheetData {
  sheetName: string;
  rows: unknown[][];
}

export interface FBItem {
  title: string;
  normalizedTitle: string;
  spend: number;
  budget: number | null;
  rowNumber: number;
  firstSeenIndex: number;
  clicks: number | null;
  views: number | null;
}

export interface MVPItem {
  title: string;
  normalizedTitle: string;
  adId: string;
  geo: string;
  sub: number;
  chat: number;
  rowNumber: number;
  depSummary: number;
  redepSummary: number;
  websiteClicks: number;
}

export interface FBDetailedItem {
  title: string;
  normalizedTitle: string;
  entity: Entity;
  campaignTitle: string;
  campaignNormalizedTitle: string;
  adTitle: string;
  adNormalizedTitle: string;
  creative: string;
  geo: string;
  date: string;
  cabinet: string;
  spend: number;
  budget: number | null;
  clicks: number | null;
  views: number | null;
  status: string;
  adStatus: string;
  accountStatus: string;
  rawId: string;
  adId: string;
  campaignId: string;
  rowNumber: number;
  firstSeenIndex: number;
}

export interface CheckRow {
  status: string;
  title: string;
  geo: string;
  date: string;
  cabinet: string;
  budget: string;
  spend: number;
  sub: number;
  chat: number;
  deposits: number;
  depSummary: number;
  redepSummary: number;
  websiteClicks: number;
  costPerSub: number | null;
  costPerChat: number | null;
  fbClicks: number | null;
  views: number | null;
  fbRow: number | null;
  mvpRow: number | null;
  inCheck: boolean;
}

export interface CreativeSummaryRow {
  geo: string;
  creative: string;
  spendTotal: number;
  fbClicks: number;
  views: number;
  websiteClicks: number;
  sub: number;
  chat: number;
  deposits: number;
  costPerSub: number | null;
  costPerChat: number | null;
  adsCount: number;
  campaignsCount: number;
  adNames: string;
}

export interface CreativeDetailRow {
  geo: string;
  creative: string;
  adName: string;
  spendTotal: number;
  fbClicks: number;
  views: number;
  websiteClicks: number;
  sub: number;
  chat: number;
  deposits: number;
  costPerSub: number | null;
  costPerChat: number | null;
  adsCount: number;
  campaignsCount: number;
}

export interface LinkRow {
  linkStatus: string;
  geo: string;
  creative: string;
  adTitle: string;
  adId: string;
  mvpId: string;
  campaign: string;
  spendAd: number;
  adStatus: string;
  accountStatus: string;
  date: string;
  cabinet: string;
  fbClicks: number | null;
  views: number | null;
  websiteClicks: number;
  sub: number;
  chat: number;
  deposits: number;
  costPerSub: number | null;
  costPerChat: number | null;
  metricsFrom: string;
  fbAdRow: number | null;
  mvpAdRow: number | null;
  _geo: string;
  _creative: string;
  _metricKey: string;
}

export interface CreativeAnalysis {
  summaryRows: CreativeSummaryRow[];
  detailRows: CreativeDetailRow[];
  linkRows: LinkRow[];
  hasAdData: boolean;
}

export interface ParseFBResult {
  items: FBItem[];
  resolvedEntity: Entity;
}

export interface ParseFBDetailedResult {
  items: FBDetailedItem[];
  resolvedEntity: Entity;
}

export interface BuildResult {
  rows: CheckRow[];
  checkText: string;
  resolvedEntity: Entity;
  fbCount: number;
  mvpCount: number;
  creativeAnalysis: CreativeAnalysis;
}
