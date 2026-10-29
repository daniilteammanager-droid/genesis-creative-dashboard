import { parseName } from "@/lib/creatives/code";

// Отчёт по трафику (Decision 098): Баер → страна → крео за период. Чистая сборка —
// без базы, её проверяет build.test.ts. Читает склад load.ts.
//
// Расход — по объявлению, страна — из таргета адсета (Decision 045), иначе из имени
// кампании. Torro — связка «кампания × объявление» (wh_crm_pairs): поэтому депы ложатся
// в страну своей кампании, даже когда одно крео крутится в нескольких странах. Страна
// связки — та, где крутилась эта пара в периоде, иначе — где крутилась кампания, иначе —
// из имени кампании Torro. Что Torro по кампаниям дал сверх связок (связки за день не
// обновились), идёт у баера строкой «не разнесено» — итог баера равен Torro.

export type Stage = "test" | "loser" | "deps" | "nospend";

// Целевая цена депа по региону; граница теста — 2,5 × цель (Daniil 29.10.2026): Испания
// $300 → $750, Латам $200 → $500. Для остальных стран цели нет — как у Испании.
export const TARGET_DEP = { ES: 300, LATAM: 200, OTHER: 300 } as const;
export const TEST_MULT = 2.5;

// Цвет ROMI, %: −100 и ниже — красный, до 0 — оранжевый, до 130 — жёлтый, выше — зелёный.
export const ROMI_CUTS = { red: -100, orange: 0, yellow: 130 } as const;
export type RomiBand = "red" | "orange" | "yellow" | "green";
export function romiBand(romi: number | null): RomiBand | null {
  if (romi === null) return null;
  const r = Math.round(romi);
  return r <= ROMI_CUTS.red ? "red" : r <= ROMI_CUTS.orange ? "orange" : r <= ROMI_CUTS.yellow ? "yellow" : "green";
}

const LATAM = new Set(["AR", "MX", "CO", "CL", "PE", "PY", "UY", "EC", "PA", "BO", "VE", "CR", "GT", "DO", "HN", "SV", "NI", "LATAM"]);
export const MULTI = "MULTI", NO_GEO = "??", REST = "REST";
const GEO_NAMES: Record<string, string> = {
  ES: "Испания", AR: "Аргентина", MX: "Мексика", CO: "Колумбия", CL: "Чили", PE: "Перу", PY: "Парагвай", UY: "Уругвай",
  EC: "Эквадор", PA: "Панама", BO: "Боливия", VE: "Венесуэла", CR: "Коста-Рика", GT: "Гватемала", DO: "Доминикана",
  IT: "Италия", PT: "Португалия", DE: "Германия", FR: "Франция", US: "США", PL: "Польша", BY: "Беларусь", VN: "Вьетнам",
  LATAM: "Латам, страна не указана", [MULTI]: "Несколько стран", [NO_GEO]: "Страна не определена", [REST]: "Не разнесено по крео",
};
export const geoName = (geo: string) => GEO_NAMES[geo] ?? geo;
export const testLimit = (geo: string) => TEST_MULT * (geo === "ES" ? TARGET_DEP.ES : LATAM.has(geo) ? TARGET_DEP.LATAM : TARGET_DEP.OTHER);

// Страна строки расхода: одна страна таргета — она, несколько — «несколько стран»,
// таргета нет — гео из имени кампании.
export function geoOf(countries: string[], campaignName: string): string {
  if (countries.length === 1) return countries[0];
  if (countries.length > 1) return MULTI;
  return parseName(campaignName).geo ?? NO_GEO;
}

export interface SpendRow { buyer: string; campaign: string; ad: string; geo: string; spend: number; impr: number; clicks: number }
export interface TorroRow { buyer: string; campaign: string; ad: string; subs: number; dia: number; deps: number; rev: number }
export interface Sums { spend: number; impr: number; clicks: number; subs: number; dia: number; deps: number; rev: number }

export interface Metrics {
  cpm: number | null; cpc: number | null; ctr: number | null;
  cps: number | null; crSub: number | null;     // цена подписки, клик → подписка
  cpd: number | null; crDia: number | null;     // цена диалога, подписка → диалог
  cpdep: number | null; crDep: number | null;   // цена депа, диалог → деп
  romi: number | null;                          // %
}

export interface ReportNode {
  key: string;
  level: 0 | 1 | 2;
  label: string;
  geo?: string;
  sums: Sums;
  m: Metrics;
  stage?: Stage;                       // у крео
  left?: number;                       // крео на тесте: сколько ещё до границы, $
  counts?: Record<Stage, number>;      // у баера и страны: крео по этапам
  children?: ReportNode[];
}

const ZERO: Sums = { spend: 0, impr: 0, clicks: 0, subs: 0, dia: 0, deps: 0, rev: 0 };
const div = (a: number, b: number) => (b > 0 ? a / b : null);

export function metricsOf(s: Sums): Metrics {
  // Без спенда цены нет: «$0 за подписку» у депов со старого трафика вводило бы в заблуждение.
  const cost = (b: number) => (s.spend > 0 ? div(s.spend, b) : null);
  return {
    cpm: cost(s.impr / 1000), cpc: cost(s.clicks), ctr: div(s.clicks, s.impr),
    cps: cost(s.subs), crSub: div(s.subs, s.clicks),
    cpd: cost(s.dia), crDia: div(s.dia, s.subs),
    cpdep: cost(s.deps), crDep: div(s.deps, s.dia),
    romi: s.spend > 0 ? ((s.rev - s.spend) / s.spend) * 100 : null,
  };
}

// Этап крео: депы есть — оцениваем по ROMI; нет — на тесте до границы, дальше лузер.
export function stageOf(s: Sums, geo: string): Stage {
  if (s.spend <= 0) return "nospend";
  if (s.deps > 0) return "deps";
  return s.spend >= testLimit(geo) ? "loser" : "test";
}

const NO_MARK = "Без метки в ссылке";
export const creoName = (ad: string) => {
  const s = ad.trim();
  return !s || /^\{\{|^not_exists$/i.test(s) ? NO_MARK : s;
};

export function buildReport(spend: SpendRow[], torro: TorroRow[], rest: Map<string, Omit<Sums, "spend" | "impr" | "clicks">> = new Map()): ReportNode[] {
  const cells = new Map<string, Sums>();   // баер|страна|крео
  const cell = (buyer: string, geo: string, creo: string) => {
    const k = `${buyer}\u0000${geo}\u0000${creo}`;
    if (!cells.has(k)) cells.set(k, { ...ZERO });
    return cells.get(k)!;
  };
  const pairGeo = new Map<string, Set<string>>(), campGeo = new Map<string, Set<string>>();
  const note = (m: Map<string, Set<string>>, k: string, geo: string) => (m.get(k) ?? m.set(k, new Set()).get(k)!).add(geo);
  for (const r of spend) {
    const s = cell(r.buyer, r.geo, creoName(r.ad));
    s.spend += r.spend; s.impr += r.impr; s.clicks += r.clicks;
    note(pairGeo, `${r.buyer}\u0000${r.campaign.trim()}\u0000${r.ad.trim()}`, r.geo);
    note(campGeo, `${r.buyer}\u0000${r.campaign.trim()}`, r.geo);
  }
  const one = (set?: Set<string>) => (!set ? null : set.size === 1 ? [...set][0] : MULTI);
  for (const r of torro) {
    const geo = one(pairGeo.get(`${r.buyer}\u0000${r.campaign.trim()}\u0000${r.ad.trim()}`))
      ?? one(campGeo.get(`${r.buyer}\u0000${r.campaign.trim()}`)) ?? parseName(r.campaign).geo ?? NO_GEO;
    const s = cell(r.buyer, geo, creoName(r.ad));
    s.subs += r.subs; s.dia += r.dia; s.deps += r.deps; s.rev += r.rev;
  }
  for (const [buyer, x] of rest) {
    if (x.subs > 0 || x.dia > 0 || x.deps > 0 || x.rev > 0) Object.assign(cell(buyer, REST, "Torro без связки с крео"), { ...ZERO, ...x });
  }

  const add = (a: Sums, b: Sums) => { for (const k of Object.keys(a) as (keyof Sums)[]) a[k] += b[k]; };
  const blankCounts = (): Record<Stage, number> => ({ test: 0, loser: 0, deps: 0, nospend: 0 });
  const buyers = new Map<string, ReportNode>();
  const countries = new Map<string, ReportNode>();
  for (const [k, s] of cells) {
    if (!(s.spend > 0 || s.subs || s.dia || s.deps || s.rev)) continue;
    const [buyer, geo, creo] = k.split("\u0000");
    if (!buyers.has(buyer)) buyers.set(buyer, { key: buyer, level: 0, label: buyer, sums: { ...ZERO }, m: metricsOf(ZERO), counts: blankCounts(), children: [] });
    const b = buyers.get(buyer)!;
    const gk = `${buyer} › ${geo}`;
    if (!countries.has(gk)) {
      const g: ReportNode = { key: gk, level: 1, label: geoName(geo), geo, sums: { ...ZERO }, m: metricsOf(ZERO), counts: blankCounts(), children: [] };
      countries.set(gk, g); b.children!.push(g);
    }
    const g = countries.get(gk)!;
    const node: ReportNode = { key: `${gk} › ${creo}`, level: 2, label: creo, geo, sums: s, m: metricsOf(s) };
    if (geo !== REST) {
      node.stage = stageOf(s, geo);
      if (node.stage === "test") node.left = Math.max(0, testLimit(geo) - s.spend);
      g.counts![node.stage]++; b.counts![node.stage]++;
    }
    g.children!.push(node);
    add(g.sums, s); add(b.sums, s);
  }
  const bySpend = (a: ReportNode, b: ReportNode) => b.sums.spend - a.sums.spend || b.sums.rev - a.sums.rev;
  const finish = (n: ReportNode): ReportNode => {
    n.m = metricsOf(n.sums);
    if (n.children) n.children = n.children.map(finish).sort(bySpend);
    return n;
  };
  return [...buyers.values()].map(finish).sort(bySpend);
}

export function totalOf(nodes: ReportNode[]): { sums: Sums; m: Metrics } {
  const s = { ...ZERO };
  for (const n of nodes) for (const k of Object.keys(s) as (keyof Sums)[]) s[k] += n.sums[k];
  return { sums: s, m: metricsOf(s) };
}
