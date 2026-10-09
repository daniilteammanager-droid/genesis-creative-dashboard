import type { GrDayRow, GrTotals } from "../general-report/types";

// General Report 4.0 — плоский формат таблиц: одна строка = день × связка.
//
// Строка расширяет дневную строку GR 3.0 разрезами. Метрики те же, поэтому
// суммирование и производные берутся из aggregate.ts General 3.0, а не пишутся
// второй раз. country = гео.

export type Gr4Kind = "main" | "buyer";

export const DIMENSIONS = ["face", "lang", "country", "region", "source", "funnel", "buyer"] as const;
export type Gr4Dim = (typeof DIMENSIONS)[number];

export const DIM_LABELS: Record<Gr4Dim, string> = {
  face: "Лицо",
  lang: "Язык",
  country: "Гео",
  region: "Регион",
  source: "Источник",
  funnel: "Воронка",
  buyer: "Баер",
};

export interface Gr4Row extends GrDayRow {
  face: string;
  lang: string;
  region: string;
  source: string;
  funnel: string;
  buyer: string;
}

// Сверх GR 3.0 — колонки, которые есть в таблице, но не в его итогах.
export interface Gr4Totals extends GrTotals {
  romiCpa: number | null;       // (доход CPA − бюджет) / бюджет
  crTotal: number | null;       // подписки / клики по объявлению — «Общая CR LP %»
  cacPayouts: number | null;    // бюджет / выплаты — так CAC считает таблица
  awDep: number | null;         // средний деп: сумма депов / их число
}

// Пороги подсветки — лист «Настройки», колонка E. Их правят в таблице, поэтому
// и дашборд берёт их оттуда, а не держит свои.
export interface Gr4Targets {
  costPerSub: number | null;
  costPerDialog: number | null;
  crToDialog: number | null;
  crDialogToDep: number | null;
}

export interface Gr4SourceInfo {
  id: string;       // "main" | "me" | "buyer:<uuid>"
  label: string;
  kind: Gr4Kind;
}

export interface Gr4Data {
  source: string;
  sources: Gr4SourceInfo[];
  kind: Gr4Kind;
  rows: Gr4Row[];
  targets: Gr4Targets;
  generatedAt: string;
  fetchedFrom: "api" | "cache";
  error?: string;
}
