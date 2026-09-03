import { warehouse, selectAll } from "./read";
import type { Profile } from "@/lib/auth/types";
import type { SupabaseClient } from "@supabase/supabase-js";

// Кто владеет рекламным кабинетом и что из этого следует для чтения склада.
//
// Раньше «чьи это цифры» решал user_id строки — то есть чей токен её принёс.
// На живых данных это оказалось не разграничением: токены баеров видели все
// кабинеты команды, и каждому записывался общий расход (Decision 052).
//
// Теперь принадлежность объявляет владелец, а строки читаются по кабинету.
// Один и тот же день одного объявления могли принести два токена — значит при
// чтении их надо схлопывать, иначе расход задвоится.

export interface WarehouseScope {
  // Подключённые баеры — для переключателя в интерфейсе.
  buyers: { id: string; label: string }[];
  // Чьи выгрузки Torro читать. Выгрузки личные по своей природе, поэтому здесь
  // по-прежнему user_id.
  userIds: string[];
  // Какие кабинеты считать. null — все, включая нераспределённые: владелец
  // должен видеть деньги, которые ещё никому не приписаны.
  accountIds: string[] | null;
}

export async function resolveScope(
  db: SupabaseClient,
  me: Profile,
  buyerFilter?: string
): Promise<WarehouseScope> {
  const { data: connected } = await db.from("buyer_connections").select("user_id");
  const ids = [...new Set((connected ?? []).map((c) => c.user_id as string))];
  const { data: profiles } = ids.length
    ? await db.from("profiles").select("id, name, email, buyer_code").in("id", ids)
    : { data: [] as { id: string; name: string | null; email: string; buyer_code: string | null }[] };

  const buyers = (profiles ?? []).map((b) => ({
    id: b.id as string,
    label: (b.name as string) || (b.buyer_code as string) || (b.email as string),
  }));

  const userIds =
    me.role === "buyer"
      ? [me.id]
      : buyerFilter && buyers.some((b) => b.id === buyerFilter)
        ? [buyerFilter]
        : buyers.map((b) => b.id);

  // Баер видит только свои кабинеты. Не поставили ни одного — не видит ничего,
  // и это правильнее, чем показать ему чужой расход.
  const onlyOne = me.role === "buyer" ? me.id : buyerFilter && buyers.some((b) => b.id === buyerFilter) ? buyerFilter : null;
  let accountIds: string[] | null = null;
  if (onlyOne) {
    const { data } = await db.from("wh_account_owners").select("account_id").eq("owner_user_id", onlyOne);
    accountIds = (data ?? []).map((r) => r.account_id as string);
  }

  return { buyers, userIds, accountIds };
}

// ─── Экран раздачи кабинетов ─────────────────────────────────────────────────

export interface AccountRow {
  accountId: string;
  accountName: string;
  spend: number;
  adCount: number;
  lastSpendDate: string | null;
  ownerUserId: string | null;
  // Сколько объявлений этого кабинета нашлось в личной выгрузке Torro баера.
  // Подсказка, а не решение: проставляет всё равно человек.
  hints: { userId: string; matched: number }[];
}

export async function listAccounts(me: Profile, since: string, until: string): Promise<{
  accounts: AccountRow[];
  buyers: { id: string; label: string }[];
}> {
  if (me.role === "buyer") throw new Error("Кабинеты раздаёт владелец");
  const db = warehouse();

  const { buyers } = await resolveScope(db, me);

  const days = await selectAll<{ account_id: string; account_name: string | null; ad_name: string; ad_id: string; date: string; spend: number | string }>(
    (from, to) =>
      db.from("wh_ad_days").select("account_id, account_name, ad_name, ad_id, date, spend")
        .gte("date", since).lte("date", until)
        .order("account_id").order("date").order("ad_id")
        .range(from, to)
  );

  // Имена объявлений из личных выгрузок Torro — основа подсказки.
  const crm = await selectAll<{ user_id: string; ad_name: string }>((from, to) =>
    db.from("wh_crm_ad_periods").select("user_id, ad_name")
      .gte("period_start", since).lte("period_end", until)
      .order("user_id").order("period_start").order("ad_name")
      .range(from, to)
  );
  const namesByUser = new Map<string, Set<string>>();
  for (const r of crm) {
    const set = namesByUser.get(r.user_id) ?? new Set<string>();
    set.add((r.ad_name ?? "").trim());
    namesByUser.set(r.user_id, set);
  }

  const { data: owners } = await db.from("wh_account_owners").select("account_id, owner_user_id");
  const ownerOf = new Map((owners ?? []).map((o) => [o.account_id as string, o.owner_user_id as string | null]));

  type Acc = { name: string; spend: number; ads: Set<string>; last: string | null; seen: Set<string> };
  const byAcc = new Map<string, Acc>();
  for (const d of days) {
    const id = String(d.account_id ?? "");
    if (!id) continue;
    const acc = byAcc.get(id) ?? { name: String(d.account_name ?? id), spend: 0, ads: new Set(), last: null, seen: new Set() };
    // Один день одного объявления могли принести два токена — считаем один раз.
    // Ключ по ad_id, а не по имени: одинаковые имена у разных объявлений — норма,
    // и по имени схлопнулись бы разные объявления, занизив расход.
    const key = `${d.date}|${d.ad_id}`;
    if (!acc.seen.has(key)) {
      acc.seen.add(key);
      acc.spend += Number(d.spend) || 0;
    }
    if (d.ad_name) acc.ads.add(String(d.ad_name).trim());
    if (!acc.last || d.date > acc.last) acc.last = d.date;
    byAcc.set(id, acc);
  }

  const accounts: AccountRow[] = [...byAcc.entries()].map(([accountId, a]) => ({
    accountId,
    accountName: a.name,
    spend: a.spend,
    adCount: a.ads.size,
    lastSpendDate: a.last,
    ownerUserId: ownerOf.get(accountId) ?? null,
    hints: buyers
      .map((b) => ({
        userId: b.id,
        matched: [...a.ads].filter((n) => namesByUser.get(b.id)?.has(n)).length,
      }))
      .filter((h) => h.matched > 0)
      .sort((x, y) => y.matched - x.matched),
  }));

  // Нераспределённые сверху, дальше по расходу: деньги без владельца — то, что
  // нужно увидеть первым.
  accounts.sort((a, b) =>
    (a.ownerUserId ? 1 : 0) - (b.ownerUserId ? 1 : 0) || b.spend - a.spend
  );

  return { accounts, buyers };
}

export async function assignAccount(me: Profile, accountId: string, ownerUserId: string | null): Promise<void> {
  if (me.role !== "main") throw new Error("Кабинеты раздаёт только владелец");
  const db = warehouse();

  if (ownerUserId) {
    const { data } = await db.from("profiles").select("id, status").eq("id", ownerUserId).maybeSingle();
    if (!data) throw new Error("Такого человека нет");
    if (data.status === "disabled") throw new Error("Этот человек отключён");
  }

  const { error } = await db.from("wh_account_owners").upsert(
    { account_id: accountId, owner_user_id: ownerUserId, assigned_by: me.id, assigned_at: new Date().toISOString() },
    { onConflict: "account_id" }
  );
  if (error) throw new Error(error.message);
}
