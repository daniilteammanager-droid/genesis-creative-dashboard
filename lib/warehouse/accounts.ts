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
  // Сколько объявлений кабинета нашлось в личной выгрузке Torro баера.
  // Подсказка для нераспределённых, а не решение.
  hints: { userId: string; matched: number }[];
}

const normalizeId = (raw: string) => raw.trim().replace(/^act_/i, "");
const looksLikeId = (id: string) => /^\d{6,20}$/.test(id);

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
    hints: buyers
      .map((b) => ({ userId: b.id, matched: [...a.ads].filter((n) => namesByUser.get(b.id)?.has(n)).length }))
      .filter((h) => h.matched > 0)
      .sort((x, y) => y.matched - x.matched),
  }));

  // Нераспределённые с расходом — сверху: это деньги без владельца.
  accounts.sort((a, b) =>
    (a.ownerUserId ? 1 : 0) - (b.ownerUserId ? 1 : 0) || b.spend - a.spend || a.accountName.localeCompare(b.accountName, "ru")
  );
  return { accounts, buyers };
}

// Закрепить кабинет. Баер — только за собой, владелец — за кем угодно.
export async function claimAccount(
  me: Profile,
  rawId: string,
  forUserId: string
): Promise<{ accountId: string; accountName: string }> {
  const accountId = normalizeId(rawId);
  if (!looksLikeId(accountId)) throw new Error("id кабинета — это число, без act_ и пробелов");
  if (me.role === "buyer" && forUserId !== me.id) throw new Error("Закрепить кабинет можно только за собой");
  if (me.role === "teamlead") throw new Error("Кабинеты раздаёт владелец");

  const db = warehouse();

  const { data: target } = await db.from("profiles").select("id, status").eq("id", forUserId).maybeSingle();
  if (!target) throw new Error("Такого человека нет");
  if (target.status === "disabled") throw new Error("Этот человек отключён");

  // Занятый кабинет баер не перехватит — ради этого и ввод по id, а не выбор
  // из списка. Владелец переназначает сознательно, ему можно.
  const { data: existing } = await db.from("wh_account_owners").select("owner_user_id").eq("account_id", accountId).maybeSingle();
  if (existing?.owner_user_id && existing.owner_user_id !== forUserId && me.role !== "main") {
    const { data: p } = await db.from("profiles").select("name, buyer_code").eq("id", existing.owner_user_id).maybeSingle();
    throw new Error(`Этот кабинет уже закреплён за ${p?.name ?? p?.buyer_code ?? "другим человеком"}`);
  }

  // Имя и сам факт существования подтверждает ключ того, за кем закрепляем.
  // Нет своего ключа — владелец проверяет своим, командным: он видит всё.
  const { getConnection } = await import("@/lib/connections/store");
  const { verifyAdAccount } = await import("@/lib/connections/verify");
  const conn = await getConnection(forUserId);
  const token = conn?.metaToken ?? (me.role === "main" ? process.env.META_ACCESS_TOKEN : undefined);
  if (!token) throw new Error("Сначала подключи ключ Meta — им и проверяется кабинет");

  const checked = await verifyAdAccount(token, accountId);
  if (typeof checked === "string") throw new Error(checked);

  const { error } = await db.from("wh_account_owners").upsert(
    {
      account_id: checked.id,
      account_name: checked.name,
      owner_user_id: forUserId,
      assigned_by: me.id,
      assigned_at: new Date().toISOString(),
    },
    { onConflict: "account_id" }
  );
  if (error) throw new Error(error.message);
  return { accountId: checked.id, accountName: checked.name };
}

// Снять закрепление. Баер — только со своего, владелец — с любого.
export async function releaseAccount(me: Profile, rawId: string): Promise<void> {
  const accountId = normalizeId(rawId);
  const db = warehouse();
  const { data: existing } = await db.from("wh_account_owners").select("owner_user_id").eq("account_id", accountId).maybeSingle();
  if (!existing) return;
  if (me.role !== "main" && existing.owner_user_id !== me.id) throw new Error("Это не твой кабинет");

  // Строку оставляем, владельца снимаем: имя пригодится, когда кабинет закрепят снова.
  const { error } = await db.from("wh_account_owners")
    .update({ owner_user_id: null, assigned_by: me.id, assigned_at: new Date().toISOString() })
    .eq("account_id", accountId);
  if (error) throw new Error(error.message);
}
