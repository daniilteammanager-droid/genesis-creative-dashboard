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

// Кабинеты закрепляет загрузка за тем, чей ключ их видит (Decision 061): сразу
// после подключения и дальше каждые 15 минут. Ручной раздачи больше нет.
export const NO_CABINETS =
  "Кабинеты ещё не закреплены. Они закрепляются сами при загрузке — сразу после подключения ключа и дальше каждые 15 минут. " +
  "Если ключ подключён давно, а кабинетов так и нет, — он не видит ни одного кабинета.";

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

// ─── Закрепление кабинетов ───────────────────────────────────────────────────
//
// Кабинет закрепляется ДО расхода: баер вводит id у себя в Интеграциях, ключ
// Meta проверяет, что видит его, и возвращает имя. Ждать первого спенда, чтобы
// раздать кабинет, — это не раздача, а дежурство.
//
// Один кабинет — один владелец. Чужой занятый кабинет баер закрепить не может;
// переназначить может только владелец дашборда.

export interface AccountRow {
  accountId: string;
  accountName: string;
  ownerUserId: string | null;
  spend: number;              // за окно, после схлопывания дублей
  adCount: number;
  lastSpendDate: string | null;
}


// Кабинеты, закреплённые за человеком, — для его страницы Интеграций.
export async function listMyAccounts(userId: string): Promise<{ accountId: string; accountName: string }[]> {
  const db = warehouse();
  const { data, error } = await db
    .from("wh_account_owners")
    .select("account_id, account_name")
    .eq("owner_user_id", userId)
    .order("account_name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ accountId: r.account_id as string, accountName: (r.account_name as string) || (r.account_id as string) }));
}

// Полная картина для владельца: всё закреплённое плюс всё, по чему был расход.
// Второе нужно, чтобы деньги без владельца не потерялись молча.
export async function listAccounts(me: Profile, since: string, until: string): Promise<{
  accounts: AccountRow[];
  buyers: { id: string; label: string }[];
}> {
  if (me.role === "buyer") throw new Error("Полный список кабинетов видит владелец");
  const db = warehouse();
  const { buyers } = await resolveScope(db, me);

  const days = await selectAll<{ account_id: string; account_name: string | null; ad_name: string; ad_id: string; date: string; spend: number | string }>(
    (from, to) =>
      db.from("wh_ad_days").select("account_id, account_name, ad_name, ad_id, date, spend")
        .gte("date", since).lte("date", until)
        .order("account_id").order("date").order("ad_id")
        .range(from, to)
  );

  const { data: owners } = await db.from("wh_account_owners").select("account_id, account_name, owner_user_id");

  type Acc = { name: string; owner: string | null; spend: number; ads: Set<string>; last: string | null; seen: Set<string> };
  const byAcc = new Map<string, Acc>();
  const touch = (id: string, name: string | null) => {
    const acc = byAcc.get(id) ?? { name: name || id, owner: null, spend: 0, ads: new Set(), last: null, seen: new Set() };
    if (name && acc.name === id) acc.name = name;
    byAcc.set(id, acc);
    return acc;
  };

  for (const o of owners ?? []) {
    const acc = touch(o.account_id as string, o.account_name as string | null);
    acc.owner = (o.owner_user_id as string | null) ?? null;
  }
  for (const d of days) {
    const id = String(d.account_id ?? "");
    if (!id) continue;
    const acc = touch(id, d.account_name as string | null);
    // Один день одного объявления могли принести два токена — считаем один раз.
    // Ключ по ad_id, а не по имени: одинаковые имена у разных объявлений — норма.
    const key = `${d.date}|${d.ad_id}`;
    if (!acc.seen.has(key)) { acc.seen.add(key); acc.spend += Number(d.spend) || 0; }
    if (d.ad_name) acc.ads.add(String(d.ad_name).trim());
    if (!acc.last || d.date > acc.last) acc.last = d.date;
  }

  const accounts: AccountRow[] = [...byAcc.entries()].map(([accountId, a]) => ({
    accountId,
    accountName: a.name,
    ownerUserId: a.owner,
    spend: a.spend,
    adCount: a.ads.size,
    lastSpendDate: a.last,
  }));

  // Нераспределённые с расходом — сверху: это деньги без владельца.
  accounts.sort((a, b) =>
    (a.ownerUserId ? 1 : 0) - (b.ownerUserId ? 1 : 0) || b.spend - a.spend || a.accountName.localeCompare(b.accountName, "ru")
  );
  return { accounts, buyers };
}
