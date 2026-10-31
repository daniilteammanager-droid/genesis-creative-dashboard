// Модалка крео (31.10.2026): все цифры одного крео за выбранный период и его динамика
// по неделям. Чистые функции — загрузка со склада в lib/warehouse/creativeDetail.ts.
// Самопроверка: npx tsx lib/creatives/detail.test.ts

export interface Sums {
  spend: number;
  impressions: number;
  clicks: number;
  subs: number;   // ПДП (Torro)
  dia: number;    // диалоги
  deps: number;
  rev: number;    // сумма депов и редепов
}

export interface DetailWeek { start: string; end: string; sums: Sums }

export interface CreativeDetail {
  code: string;
  since: string;
  until: string;
  sums: Sums;
  weeks: DetailWeek[];
  countries: string[]; // где крутилось — из таргета адсетов
  firstDay: string | null; // первый день расхода крео на складе
  notice?: string;
}

// Строки склада, уже очищенные от повторов и чужих кабинетов.
export interface SpendDay { date: string; spend: number; impressions: number; clicks: number }
export interface TorroDay { date: string; subs: number; dia: number; deps: number; rev: number }

export const zero = (): Sums => ({ spend: 0, impressions: 0, clicks: 0, subs: 0, dia: 0, deps: 0, rev: 0 });

const add = (a: Sums, b: Partial<Sums>) => {
  for (const k of Object.keys(b) as (keyof Sums)[]) a[k] += b[k] ?? 0;
};

const toDate = (day: string) => new Date(`${day}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

// Понедельник недели дня (дни — строки ГГГГ-ММ-ДД по Москве, считаем в UTC, чтобы пояс не сдвигал).
export function weekStart(day: string): string {
  const d = toDate(day);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return iso(d);
}

const plusDays = (day: string, n: number) => {
  const d = toDate(day);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

// Недели — от первой недели с цифрами до недели конца периода, пустые внутри тоже:
// пауза в открутке должна быть видна, а не схлопнута.
export function buildDetail(code: string, since: string, until: string, spend: SpendDay[], torro: TorroDay[]): Omit<CreativeDetail, "countries" | "firstDay"> {
  const sums = zero();
  const byWeek = new Map<string, Sums>();
  const slot = (day: string) => {
    const w = weekStart(day);
    return byWeek.get(w) ?? byWeek.set(w, zero()).get(w)!;
  };
  // Пустые дни (объявление записано, но не тратило) недель не открывают — иначе график начинался бы с нулей.
  for (const d of spend) {
    if (d.date < since || d.date > until || (!d.spend && !d.impressions && !d.clicks)) continue;
    const s = { spend: d.spend, impressions: d.impressions, clicks: d.clicks };
    add(sums, s); add(slot(d.date), s);
  }
  for (const t of torro) {
    if (t.date < since || t.date > until || (!t.subs && !t.dia && !t.deps && !t.rev)) continue;
    const s = { subs: t.subs, dia: t.dia, deps: t.deps, rev: t.rev };
    add(sums, s); add(slot(t.date), s);
  }
  const starts = [...byWeek.keys()].sort();
  const weeks: DetailWeek[] = [];
  if (starts.length) {
    for (let w = starts[0]; w <= weekStart(until); w = plusDays(w, 7)) {
      weeks.push({
        start: w < since ? since : w,
        end: plusDays(w, 6) > until ? until : plusDays(w, 6),
        sums: byWeek.get(w) ?? zero(),
      });
    }
  }
  return { code, since, until, sums, weeks };
}

// Производные — всегда из сумм, а не средним по дням (Decision 024). null — делить не на что.
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
export function metricsOf(s: Sums) {
  return {
    profit: s.rev - s.spend,
    romi: s.spend > 0 ? ((s.rev - s.spend) / s.spend) * 100 : null,
    roas: ratio(s.rev, s.spend),
    cpm: s.impressions > 0 ? (s.spend / s.impressions) * 1000 : null,
    cpc: ratio(s.spend, s.clicks),
    ctr: s.impressions > 0 ? (s.clicks / s.impressions) * 100 : null,
    cpdp: ratio(s.spend, s.subs),
    clickToSub: s.clicks > 0 ? (s.subs / s.clicks) * 100 : null,
    cdia: ratio(s.spend, s.dia),
    subToDia: s.subs > 0 ? (s.dia / s.subs) * 100 : null,
    cdep: ratio(s.spend, s.deps),
    diaToDep: s.dia > 0 ? (s.deps / s.dia) * 100 : null,
  };
}
