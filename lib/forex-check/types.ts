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

export interface ParseFBResult {
  items: FBItem[];
  resolvedEntity: Entity;
}

export interface BuildResult {
  rows: CheckRow[];
  checkText: string;
  resolvedEntity: Entity;
  fbCount: number;
  mvpCount: number;
}
