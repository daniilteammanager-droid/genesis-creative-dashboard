import type { GrDayRow, GrTotals } from "../general-report/types";

// General Report 4.0 — плоский формат таблиц: одна строка = день × связка.
//
// Строка расширяет дневную строку GR 3.0 разрезами. Метрики те же, поэтому
// суммирование и производные берутся из aggregate.ts General 3.0, а не пишутся
// второй раз. country = гео.

export type Gr4Kind = "main" | "buyer";

export const DIMENSIONS = ["face", "lang", "country", "region", "source", "platform", "funnel", "buyer"] as const;
export type Gr4Dim = (typeof DIMENSIONS)[number];

export const DIM_LABELS: Record<Gr4Dim, string> = {
  face: "Лицо",
  lang: "Язык",
  country: "Гео",
  region: "Регион",
  source: "Источник",
  platform: "Площадка",
  funnel: "Воронка",
  buyer: "Баер",
};

// Квалификация трафика из CRM: сегменты A–E.
export const QUAL_KEYS = ["qualA", "qualB", "qualC", "qualD", "qualE"] as const;
export type QualKey = (typeof QUAL_KEYS)[number];

export interface Gr4Row extends GrDayRow, Record<QualKey, number> {
  face: string;
  lang: string;
  region: string;
  source: string;
  platform: string;      // второй слой под источником (УБТ → YouTube/TikTok/Instagram); пусто — нет
  funnel: string;
  buyer: string;
}

// Сверх GR 3.0 — колонки, которые есть в таблице, но не в его итогах.
export interface Gr4Totals extends GrTotals {
  romiCpa: number | null;       // (доход CPA − бюджет) / бюджет
  crTotal: number | null;       // подписки / клики по объявлению — «Общая CR LP %»
  cacPayouts: number | null;    // бюджет / выплаты — так CAC считает таблица
  awDep: number | null;         // средний деп: сумма депов / их число
  qualA: number; qualB: number; qualC: number; qualD: number; qualE: number;
  quals: number;                // A+B+C+D+E
  unquals: number;              // диалоги − квалы
  qualShare: Record<QualKey, number | null>; // доля сегмента от всех квалов
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
  combined?: boolean; // «Сводная по баерам»: таблицы всех баеров вместе, разрез «Баер» остаётся
}

export interface Gr4Data {
  source: string;
  sources: Gr4SourceInfo[];
  kind: Gr4Kind;
  combined?: boolean;
  rows: Gr4Row[];
  targets: Gr4Targets;
  generatedAt: string;
  fetchedFrom: "api" | "db";
  syncError?: string | null;    // последняя ошибка чтения таблицы; показан прежний снимок
  error?: string;
}
