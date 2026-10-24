import { warehouse } from "./read";
import { callStatistics, fetchDay, type TorroRow } from "@/lib/torro/mcp";
import { getConnection } from "@/lib/connections/store";
import { crmColumns, quals } from "./torroIngest";
import { mskDay, mskDaysAgo } from "@/lib/day";

// Связки «кампания × объявление» из Torro (Decision 070).
//
// Torro группирует по одному признаку за раз и id не отдаёт. Чтобы узнать, в
// какой кампании какое объявление принесло подписки и депы, каждое объявление
// дня раскладывается по кампаниям отдельным запросом (~1 с). У Артёма это ~90
// запросов на день — поэтому отдельным кроном, а не в прогоне раз в 15 минут.
//
// Прошлые дни Torro не переписывает (депозит пишется днём, когда он сделан):
// закрытый день раскладывается один раз. Сегодня — раз в час, вчера — ещё раз
// после полуночи, чтобы добрать вечер. История — день за днём вглубь, до самого
// старого дня Torro в складе. Раскладка дня продолжается с места, где её прервал
// конец отведённого времени.

const TODAY_EVERY_MS = 3600_000;

interface Cursor {
  day?: string;          // день в работе
  after?: string;        // последнее разложенное объявление этого дня
  started?: string;      // начало прохода по дню — по нему чистятся устаревшие связки
  todayAt?: string;      // когда сегодня разложено целиком
  finalized?: string;    // какой «вчера» уже разложен после полуночи
}

const active = (r: TorroRow) =>
  ["click", "sub", "unsub", "chat", "reg", "dep_count", "redep_count"].some((k) => Number(r[k] ?? 0) > 0);

// Один проход по дню. Возвращает, докуда дошёл; done — день разложен целиком.
async function pairsForDay(userId: string, torro: { token: string; buyerId: number }, day: string, c: Cursor, deadline: number) {
  const db = warehouse();
  const started = c.day === day && c.started ? c.started : new Date().toISOString();
  const ads = (await fetchDay({ ...torro, day }, "ad_name")).filter(active).map((r) => r.group.trim()).filter(Boolean).sort();
  const todo = c.day === day && c.after ? ads.filter((a) => a > c.after!) : ads;
  let rows = 0;
  for (const ad of todo) {
    if (Date.now() > deadline) return { done: false, cursor: { ...c, day, after: ads[ads.indexOf(ad) - 1], started }, rows };
    const p = await callStatistics({ ...torro, day, groupBy: "campaign_name", adName: [ad] });
    if (p.truncated || (p.rows_total ?? p.rows.length) > p.rows.length) throw new Error(`Torro: у объявления «${ad}» за ${day} больше 100 кампаний`);
    const now = new Date().toISOString();
    const out = p.rows.filter((r) => r.group.trim()).map((r) => ({
      user_id: userId, period_start: day, campaign_name: r.group.trim(), ad_name: ad,
      ...crmColumns(r, false), ...quals(r), updated_at: now,
    }));
    if (out.length) {
      const { error } = await db.from("wh_crm_pairs").upsert(out, { onConflict: "user_id,period_start,campaign_name,ad_name" });
      if (error) throw new Error(`wh_crm_pairs: ${error.message}`);
      rows += out.length;
    }
  }
  // День целиком: всё, что этот проход не тронул, — устаревшие связки (переименовали).
  const { error } = await db.from("wh_crm_pairs").delete().eq("user_id", userId).eq("period_start", day).lt("updated_at", started);
  if (error) throw new Error(`wh_crm_pairs: ${error.message}`);
  return { done: true, cursor: { ...c, day: undefined, after: undefined, started: undefined }, rows };
}

export interface PairsRun { userId: string; day?: string; rows: number; done?: boolean; error?: string }

// Один баер, сколько успеем до deadline: сначала незаконченный день, потом
// сегодня (раз в час), потом вчера (раз после полуночи), потом история.
async function pairsForUser(userId: string, deadline: number): Promise<PairsRun[]> {
  const db = warehouse();
  const conn = await getConnection(userId);
  if (!conn?.torroToken || !conn.torroBuyerId) return [];
  const torro = { token: conn.torroToken, buyerId: conn.torroBuyerId };
  const { data: st } = await db.from("buyer_connections")
    .select("pairs_cursor, pairs_backfilled_from, pairs_backfill_done").eq("user_id", userId).maybeSingle();
  let c: Cursor = (st?.pairs_cursor as Cursor | null) ?? {};
  let historyFrom: string | null = st?.pairs_backfilled_from ?? null;
  let historyDone = Boolean(st?.pairs_backfill_done);
  const today = mskDay(), yesterday = mskDaysAgo(1);
  // Глубже, чем Torro лежит в складе, раскладывать нечего.
  const { data: oldest } = await db.from("wh_crm_ad_periods").select("period_start").eq("user_id", userId).order("period_start").limit(1);
  const floor = (oldest?.[0]?.period_start as string | undefined) ?? today;

  const runs: PairsRun[] = [];
  while (Date.now() < deadline) {
    let day: string | null = c.day ?? null;
    if (!day && (!c.todayAt || Date.now() - Date.parse(c.todayAt) > TODAY_EVERY_MS || mskDay(new Date(c.todayAt)) !== today)) day = today;
    if (!day && c.finalized !== yesterday) day = yesterday;
    if (!day && !historyDone) {
      const next = mskDaysAgo(1, new Date(`${historyFrom ?? yesterday}T12:00:00+03:00`));
      if (next < floor) historyDone = true;
      else day = next;
    }
    if (!day) break;

    const r = await pairsForDay(userId, torro, day, c, deadline);
    runs.push({ userId, day, rows: r.rows, done: r.done });
    c = r.cursor;
    if (r.done) {
      if (day === today) c.todayAt = new Date().toISOString();
      else if (day === yesterday) c.finalized = yesterday;
      else historyFrom = day;
    }
    await db.from("buyer_connections").update({
      pairs_cursor: c, pairs_backfilled_from: historyFrom, pairs_backfill_done: historyDone,
    }).eq("user_id", userId);
    if (!r.done) break;
  }
  return runs;
}

// Крон: все баеры с Torro по кругу, пока есть время. Начинаем каждый раз с
// другого — иначе первый в списке съедал бы всё время, а последний ждал.
export async function runPairs(budgetMs: number): Promise<PairsRun[]> {
  const deadline = Date.now() + budgetMs;
  const { data } = await warehouse().from("buyer_connections").select("user_id").not("torro_token_enc", "is", null).order("user_id");
  const users = (data ?? []).map((r) => r.user_id as string);
  const shift = users.length ? Math.floor(Date.now() / 900_000) % users.length : 0;
  const order = [...users.slice(shift), ...users.slice(0, shift)];
  const out: PairsRun[] = [];
  for (const u of order) {
    if (Date.now() > deadline) break;
    // Свою долю времени — каждому, остаток переходит следующему.
    const left = order.length - order.indexOf(u);
    const share = Date.now() + (deadline - Date.now()) / left;
    try {
      out.push(...await pairsForUser(u, share));
    } catch (e) {
      out.push({ userId: u, rows: 0, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
