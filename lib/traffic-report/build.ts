import { parseCreativeCode, parseName } from "@/lib/creatives/code";

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

export type Platform = "fb" | "tg";
// face — ROMAN | RICKY | "" (из имени кампании, у TG Ads — из названия кабинета); funnel — TG | WA | "".
export interface SpendRow { buyer: string; campaign: string; ad: string; geo: string; face: string; funnel: string; platform: Platform; spend: number; impr: number; clicks: number }
export interface TorroRow { buyer: string; campaign: string; ad: string; subs: number; dia: number; deps: number; rev: number }
export interface Sums { spend: number; impr: number; clicks: number; subs: number; dia: number; deps: number; rev: number }

// Ячейка отчёта: баер × страна × лицо × воронка × площадка × крео. Фильтры режут ячейки,
// дерево собирается из того, что осталось (treeOf) — итоги и этапы считаются заново.
export interface Cell { buyer: string; geo: string; face: string; funnel: string; platform: Platform; creo: string; sums: Sums }

// Фильтры как в General 4.0: в каждом разрезе несколько значений, пусто — все.
export const DIMS = ["face", "region", "geo", "platform", "funnel"] as const;
export type Dim = (typeof DIMS)[number];
export const DIM_LABELS: Record<Dim, string> = { face: "Лицо", region: "Регион", geo: "Гео", platform: "Площадка", funnel: "Воронка" };
export type Filters = Partial<Record<Dim, string[]>>;
const FACE_LABELS: Record<string, string> = { ROMAN: "Роман", RICKY: "Рики" };
export const regionName = (geo: string) => (geo === "ES" ? "Испания" : LATAM.has(geo) ? "Латам" : geo === REST ? "Не разнесено" : "Другие");
export function dimValue(c: Cell, d: Dim): string {
  switch (d) {
    case "face": return FACE_LABELS[c.face] ?? "Без лица";
    case "region": return regionName(c.geo);
    case "geo": return geoName(c.geo);
    case "platform": return c.platform === "tg" ? "TG Ads" : "Facebook";
    case "funnel": return c.funnel || "Без воронки";
  }
}
export function dimOptions(cells: Cell[]): Record<Dim, string[]> {
  return Object.fromEntries(DIMS.map((d) => [d, [...new Set(cells.map((c) => dimValue(c, d)))].sort((a, b) => a.localeCompare(b, "ru"))])) as Record<Dim, string[]>;
}
export function filterCells(cells: Cell[], f: Filters): Cell[] {
  const active = DIMS.filter((d) => f[d]?.length).map((d) => [d, new Set(f[d])] as const);
  return active.length ? cells.filter((c) => active.every(([d, set]) => set.has(dimValue(c, d)))) : cells;
}

export interface Metrics {
  cpm: number | null; cpc: number | null; ctr: number | null;
  cps: number | null; crSub: number | null;     // цена подписки, клик → подписка
  cpd: number | null; crDia: number | null;     // цена диалога, подписка → диалог
  cpdep: number | null; crDep: number | null;   // цена депа, диалог → деп
  romi: number | null;                          // %
}

export interface ReportNode {
  key: string;
  level: 0 | 1 | 2 | 3;               // баер, страна, крео (или текст при склейке), крео под текстом
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

// Расход и Torro → ячейки. Torro берёт страну, лицо, воронку и площадку той пары
// «кампания × объявление», что крутилась в периоде, иначе — кампании, иначе — из имени
// кампании Torro (площадка — та, на которой у баера был расход).
export function cellsOf(spend: SpendRow[], torro: TorroRow[], rest: Map<string, Omit<Sums, "spend" | "impr" | "clicks">> = new Map()): Cell[] {
  const cells = new Map<string, Cell>();
  const cell = (buyer: string, geo: string, face: string, funnel: string, platform: Platform, creo: string) => {
    const k = [buyer, geo, face, funnel, platform, creo].join("\u0000");
    if (!cells.has(k)) cells.set(k, { buyer, geo, face, funnel, platform, creo, sums: { ...ZERO } });
    return cells.get(k)!.sums;
  };
  type Seen = { geo: Set<string>; face: Set<string>; funnel: Set<string>; platform: Set<Platform> };
  const pairs = new Map<string, Seen>(), camps = new Map<string, Seen>(), ads = new Map<string, Seen>(), platforms = new Map<string, Set<Platform>>();
  const note = (m: Map<string, Seen>, k: string, r: SpendRow) => {
    const s = m.get(k) ?? m.set(k, { geo: new Set(), face: new Set(), funnel: new Set(), platform: new Set() }).get(k)!;
    s.geo.add(r.geo); s.face.add(r.face); s.funnel.add(r.funnel); s.platform.add(r.platform);
  };
  const one = <T,>(set: Set<T> | undefined, many: T): T | null => (!set ? null : set.size === 1 ? [...set][0] : many);
  const only = <T,>(set: Set<T> | undefined): T | null => (set?.size === 1 ? [...set][0] : null);
  // Одно непустое значение среди всех мест, где крутилось крео: в имени кампании лица нет,
  // а крео у баера — только под одним лицом (у Андрея кампании «07.10 (1818_FB_102) ES 2»).
  const named = (set: Set<string> | undefined) => only(new Set([...(set ?? [])].filter(Boolean)));
  for (const r of spend) note(ads, `${r.buyer}\u0000${r.ad.trim()}`, r);
  for (const raw of spend) {
    const ad = ads.get(`${raw.buyer}\u0000${raw.ad.trim()}`);
    const r = { ...raw, face: raw.face || named(ad?.face) || "", funnel: raw.funnel || named(ad?.funnel) || "" };
    const s = cell(r.buyer, r.geo, r.face, r.funnel, r.platform, creoName(r.ad));
    s.spend += r.spend; s.impr += r.impr; s.clicks += r.clicks;
    note(pairs, `${r.buyer}\u0000${r.campaign.trim()}\u0000${r.ad.trim()}`, r);
    note(camps, `${r.buyer}\u0000${r.campaign.trim()}`, r);
    (platforms.get(r.buyer) ?? platforms.set(r.buyer, new Set()).get(r.buyer)!).add(r.platform);
  }
  for (const r of torro) {
    const seen = pairs.get(`${r.buyer}\u0000${r.campaign.trim()}\u0000${r.ad.trim()}`) ?? camps.get(`${r.buyer}\u0000${r.campaign.trim()}`);
    // Имя кампании в ссылке Torro не совпало с Meta — лицо и воронку знает само крео:
    // где оно крутилось у этого баера (29.10.2026: у Андрея так терялось лицо у $26k ревенью).
    const ad = ads.get(`${r.buyer}\u0000${r.ad.trim()}`);
    const name = parseName(r.campaign);
    const own = platforms.get(r.buyer);
    const s = cell(
      r.buyer,
      one(seen?.geo, MULTI) ?? name.geo ?? only(ad?.geo) ?? NO_GEO,
      one(seen?.face, "") || named(ad?.face) || name.face || "",
      one(seen?.funnel, "") || named(ad?.funnel) || name.funnel || "",
      one(seen?.platform, "fb" as Platform) ?? only(ad?.platform) ?? (own?.size === 1 ? [...own][0] : "fb"),
      creoName(r.ad),
    );
    s.subs += r.subs; s.dia += r.dia; s.deps += r.deps; s.rev += r.rev;
  }
  for (const [buyer, x] of rest) {
    if (x.subs > 0 || x.dia > 0 || x.deps > 0 || x.rev > 0) Object.assign(cell(buyer, REST, "", "", "fb", "Torro без связки с крео"), { ...ZERO, ...x });
  }
  return [...cells.values()].filter(({ sums: s }) => s.spend > 0 || s.subs || s.dia || s.deps || s.rev);
}

export const buildReport = (spend: SpendRow[], torro: TorroRow[], rest?: Map<string, Omit<Sums, "spend" | "impr" | "clicks">>) =>
  treeOf(cellsOf(spend, torro, rest));

// Дерево баер → страна → крео из ячеек: лица, воронки и площадки внутри складываются.
export function treeOf(input: Cell[]): ReportNode[] {
  const add = (a: Sums, b: Sums) => { for (const k of Object.keys(a) as (keyof Sums)[]) a[k] += b[k]; };
  const cells = new Map<string, Sums>();   // баер|страна|крео
  for (const c of input) {
    const k = `${c.buyer}\u0000${c.geo}\u0000${c.creo}`;
    if (!cells.has(k)) cells.set(k, { ...ZERO });
    add(cells.get(k)!, c.sums);
  }
  const blankCounts = (): Record<Stage, number> => ({ test: 0, loser: 0, deps: 0, nospend: 0 });
  const buyers = new Map<string, ReportNode>();
  const countries = new Map<string, ReportNode>();
  for (const [k, s] of cells) {
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

// Склейка крео внутри страны (Daniil 29.10.2026): «text» — по номеру текста (все t11),
// «version» — по тексту и его версии (все t11_v8). Номер текста общий для подходов: t11
// бывает у balance, checklist и live. Крео — строки под текстом; старые имена без tN
// остаются отдельными строками. Этап считается по сумме склейки.
export type GroupMode = "creo" | "text" | "version";
export function textKey(creo: string, mode: Exclude<GroupMode, "creo">): string | null {
  const c = parseCreativeCode(creo);
  if (c.scheme !== "v2") return null;
  return mode === "text" ? `t${c.textNo}` : `t${c.textNo}_v${c.version}`;
}

export function groupCreos(nodes: ReportNode[], mode: GroupMode): ReportNode[] {
  if (mode === "creo") return nodes;
  const blankCounts = (): Record<Stage, number> => ({ test: 0, loser: 0, deps: 0, nospend: 0 });
  return nodes.map((b) => {
    const bc = blankCounts();
    const countries = (b.children ?? []).map((g) => {
      if (g.geo === REST) return g;
      const gc = blankCounts();
      const units: ReportNode[] = [];
      const groups = new Map<string, ReportNode>();
      for (const c of g.children ?? []) {
        const key = textKey(c.label, mode);
        if (!key) { units.push(c); continue; }
        if (!groups.has(key)) {
          const t: ReportNode = { key: `${g.key} › ${key}`, level: 2, label: key, geo: g.geo, sums: { ...ZERO }, m: metricsOf(ZERO), children: [] };
          groups.set(key, t); units.push(t);
        }
        const t = groups.get(key)!;
        for (const k of Object.keys(t.sums) as (keyof Sums)[]) t.sums[k] += c.sums[k];
        t.children!.push({ ...c, level: 3 });
      }
      for (const t of groups.values()) {
        t.m = metricsOf(t.sums);
        t.stage = stageOf(t.sums, g.geo!);
        if (t.stage === "test") t.left = Math.max(0, testLimit(g.geo!) - t.sums.spend);
      }
      for (const u of units) if (u.stage) { gc[u.stage]++; bc[u.stage]++; }
      units.sort((x, y) => y.sums.spend - x.sums.spend || y.sums.rev - x.sums.rev);
      return { ...g, counts: gc, children: units };
    });
    return { ...b, counts: bc, children: countries };
  });
}

// Порядок крео внутри страны (и крео внутри текста): по убыванию выбранного; ROMI без
// спенда — в конце. Баеры и страны остаются по спенду.
export type SortBy = "spend" | "romi" | "deps" | "rev";
export function sortCreos(nodes: ReportNode[], by: SortBy): ReportNode[] {
  const val = (n: ReportNode) => (by === "romi" ? n.m.romi : n.sums[by]);
  const cmp = (a: ReportNode, b: ReportNode) => {
    const x = val(a), y = val(b);
    if (x === null || y === null) return x === y ? b.sums.spend - a.sums.spend : x === null ? 1 : -1;
    return y - x || b.sums.spend - a.sums.spend;
  };
  const deep = (n: ReportNode): ReportNode =>
    !n.children ? n : { ...n, children: (n.level >= 1 ? [...n.children].sort(cmp) : n.children).map(deep) };
  return nodes.map(deep);
}

export function totalOf(nodes: ReportNode[]): { sums: Sums; m: Metrics } {
  const s = { ...ZERO };
  for (const n of nodes) for (const k of Object.keys(s) as (keyof Sums)[]) s[k] += n.sums[k];
  return { sums: s, m: metricsOf(s) };
}
