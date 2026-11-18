import { AUTO_SEARCH, type SearchRule } from "./chain";
import type { Topup } from "./requests";

// Автопоиск оплаты (Decision 125, 18.11.2026): заявку закрывает сам перевод точной суммы на адрес заявки, «Оплачено»
// нажимать не обязательно. 18.11 оплатили и не нажали — по висящей заявке заплатили второй раз.
// Здесь — чистая часть: кого искать на этом прогоне крона (раз в минуту) и по какому правилу.
// Самопроверка — auto.test.ts.

const H = 3600_000;
// Перевод, пришедший до 30 минут после срока, ещё закрывает заявку: платили в последние минуты,
// биржа отправила вывод с задержкой. Позже — уже не эта заявка.
export const GRACE_MS = 30 * 60_000;
// Заявку с вышедшим сроком ищем ещё сутки: перевод в окне срока мог не попасться из-за сбоя API или крона
// (29.10.2026 VPS с кроном был без сети 8 часов).
export const AFTER_EXPIRY_MS = 24 * H;
// После «Оплачено» — сутки каждую минуту и с допуском по сумме, как раньше: человек сказал, что заплатил.
const PRESSED_MS = 24 * H;

// Раз в сколько минут искать: свежие — каждую минуту, старые реже. Без срока заявка висит неделями.
export const every = (ageMs: number) => (ageMs < 6 * H ? 1 : ageMs < 72 * H ? 5 : 30);

export interface Due extends SearchRule { id: string; expired: boolean }
type Row = Pick<Topup, "id" | "number" | "status" | "network" | "address" | "amount" | "created_at" | "expires_at" | "searching_since">;

// rows — открытые заявки и все заявки за последние дни (нужны для проверки «есть новая на ту же сумму»).
// Порядок — по созданию: две открытые заявки на один адрес и сумму, перевод один — его берёт старшая.
export function dueSearches(rows: Row[], now: number): Due[] {
  const minute = Math.floor(now / 60_000);
  // Номер заявки сдвигает минуту: редкие поиски расходятся по разным прогонам, а не идут пачкой.
  const turn = (r: Row, n: number) => (minute + r.number) % n === 0;
  // BSC: обычно — последние минуты (полное окно — десятки запросов), раз в 30 минут — всё окно заявки. Иначе перевод,
  // пропущенный сбоем узла, не находится никогда: #137 (18.11) — 13 USDT пришли в 18:05, «Оплачено» в 18:20 не нашло.
  const recent = (r: Row, n: number) => (turn(r, 30) ? undefined : Math.max(15, 3 * n) * 60_000);
  const out: Due[] = [];
  for (const r of [...rows].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) {
    if (!AUTO_SEARCH.includes(r.network)) continue;
    const created = Date.parse(r.created_at);
    if (r.status === "pending") {
      const pressed = Boolean(r.searching_since) && now - Date.parse(r.searching_since!) < PRESSED_MS;
      const n = pressed ? 1 : every(now - created);
      if (turn(r, n)) out.push({ id: r.id, expired: false, strict: !pressed, recentMs: recent(r, n) });
    } else if (r.status === "expired" && r.expires_at) {
      const end = Date.parse(r.expires_at);
      if (now - end > AFTER_EXPIRY_MS) continue;
      // Срок вышел и на тот же адрес и сумму уже завели новую заявку — перевод её, а не старой.
      if (rows.some((o) => o.status !== "rejected" && o.address === r.address && o.amount === r.amount && Date.parse(o.created_at) > created)) continue;
      // Первый час после срока — каждую минуту (платили в последний момент), дальше — страховка от сбоев.
      const n = now - end < H ? 1 : 30;
      if (turn(r, n)) out.push({ id: r.id, expired: true, strict: true, until: end + GRACE_MS, recentMs: recent(r, n) });
    }
  }
  return out;
}
