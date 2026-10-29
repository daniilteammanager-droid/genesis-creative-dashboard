// Главная, рейтинг баеров за месяц, 3 месяца и всё время — по таблицам General 4.0 (у них есть история, склад молодой).
//
// Место — по профиту (доход − расход): он сам совмещает «больше лить» и «держать ROMI».
// Номинации:
//   Объём         — самый большой расход при ROMI выше нуля (сжечь бюджет — не заслуга);
//   Эффективность — самый высокий ROMI у тех, кто лил в среднем от $15k в месяц:
//                   иначе ROMI 300% на $500 забирал бы номинацию;
//   Прогресс      — сильнее всех поднял ROMI к прошлому окну той же длины (30 дней — к 30 дням до них),
//                   от $1k расхода в обоих окнах: новичку в минусе тоже есть за что бороться.
//                   У «всего времени» прошлого окна нет — и номинации нет.
// Баеру — место, ник и ROMI, суммы — только свои; чужие видят владелец и тимлид (решено 28.10.2026).
// Отключённый баер остаётся в рейтинге со своей историей, с пометкой «выбыл» (gone).

export const MIN_MONTHLY_SPEND = 15_000;
export const PROGRESS_MIN_SPEND = 1_000;

export interface DayMoney { date: string; budget: number; revenue: number }
export interface BuyerInput { id: string; label: string; gone?: boolean; rows: DayMoney[] }

export interface Standing {
  id: string; label: string; romi: number | null;
  prevRomi?: number | null;                            // ROMI прошлого окна — для «Прогресса»
  spend?: number; revenue?: number; profit?: number;   // только владельцу и тимлиду
  me?: boolean;
  gone?: boolean;
}
export interface Board<T = Standing> {
  ranking: T[];
  volume: T | null;
  efficiency: T | null;
  progress?: T | null;                                 // нет у «всего времени»
}

type Full = { id: string; label: string; gone: boolean; spend: number; revenue: number; profit: number; romi: number; prevRomi: number | null; monthly: number };

const DAY = 86_400_000;
const shift = (d: string, days: number) => new Date(Date.parse(d) + days * DAY).toISOString().slice(0, 10);

// months — длина окна в месяцах; null («всё время») — по месяцам, где был расход.
export function rankBuyers(buyers: BuyerInput[], since: string | null, until: string, months: number | null): Board<Full> {
  const all: Full[] = [];
  // Прошлое окно той же длины, вплотную перед текущим.
  const len = since ? (Date.parse(until) - Date.parse(since)) / DAY + 1 : 0;
  const prevSince = since ? shift(since, -len) : "", prevUntil = since ? shift(since, -1) : "";
  for (const b of buyers) {
    let spend = 0, revenue = 0, prevSpend = 0, prevRevenue = 0;
    const active = new Set<string>();
    for (const r of b.rows) {
      if (since && r.date >= prevSince && r.date <= prevUntil) { prevSpend += r.budget; prevRevenue += r.revenue; }
      if (r.date > until || (since && r.date < since)) continue;
      spend += r.budget; revenue += r.revenue;
      if (r.budget > 0) active.add(r.date.slice(0, 7));
    }
    if (spend <= 0) continue;
    const profit = revenue - spend;
    const prevRomi = prevSpend >= PROGRESS_MIN_SPEND ? (prevRevenue - prevSpend) / prevSpend : null;
    all.push({ id: b.id, label: b.label, gone: !!b.gone, spend, revenue, profit, romi: profit / spend, prevRomi, monthly: spend / (months ?? active.size) });
  }
  const ranking = all.sort((a, b) => b.profit - a.profit);
  const best = (list: Full[], key: (x: Full) => number) => list.reduce<Full | null>((m, x) => (!m || key(x) > key(m) ? x : m), null);
  return {
    ranking,
    volume: best(ranking.filter((x) => x.romi > 0), (x) => x.spend),
    efficiency: best(ranking.filter((x) => x.monthly >= MIN_MONTHLY_SPEND), (x) => x.romi),
    progress: since
      ? best(ranking.filter((x) => x.prevRomi !== null && x.spend >= PROGRESS_MIN_SPEND && x.romi > x.prevRomi), (x) => x.romi - x.prevRomi!)
      : undefined,
  };
}

// Что уходит в браузер: баеру суммы не отдаём вовсе, а не прячем в интерфейсе.
export function forViewer(board: Board<Full>, meId: string, withMoney: boolean): Board {
  // Свои суммы баер видит — чужие нет.
  const out = (x: Full | null): Standing | null => x && (withMoney || x.id === meId
    ? { id: x.id, label: x.label, gone: x.gone, romi: x.romi, prevRomi: x.prevRomi, spend: x.spend, revenue: x.revenue, profit: x.profit, me: x.id === meId }
    : { id: x.id, label: x.label, gone: x.gone, romi: x.romi, prevRomi: x.prevRomi, me: x.id === meId });
  return {
    ranking: board.ranking.map((x) => out(x)!), volume: out(board.volume), efficiency: out(board.efficiency),
    progress: board.progress === undefined ? undefined : out(board.progress),
  };
}
