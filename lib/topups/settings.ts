import { warehouse } from "@/lib/warehouse/read";
import { PAIRS, type Asset, type Network } from "./chain";
import { checkCategories, DEFAULT, findTarget, renames, targetsOf, type Category, type Template } from "./config";

// Настройки «Пополнений» и личные шаблоны (Decision 131) — база. Таблицы закрыты от браузера, доступ проверяют роуты:
// настройки меняет только владелец (/api/topups/settings), шаблоны — каждый свои (/api/topups/templates).

const db = () => warehouse();

// Категории из настроек. Строки ещё нет или база не ответила — список по умолчанию: форма работает как раньше.
// Через clean: jsonb хранит ключи в своём порядке, а страница сравнивает черновик с сохранённым по JSON —
// без этого после перечитывания висело «есть несохранённые изменения» (27.11.2026).
export async function loadCategories(): Promise<Category[]> {
  const { data, error } = await db().from("topup_settings").select("categories").eq("id", 1).maybeSingle();
  if (error || !Array.isArray(data?.categories) || !data.categories.length) return DEFAULT;
  return clean(data.categories as Category[]);
}

const clean = (cats: Category[]): Category[] => cats.map((c) => ({
  id: String(c.id), name: c.name.trim(),
  targets: c.targets.map((t) => ({
    id: String(t.id), name: t.name.trim(), only: Boolean(t.only) && t.wallets.length > 0,
    wallets: t.wallets.map((w) => ({ name: w.name.trim(), asset: w.asset, network: w.network, address: w.address.trim() })),
    ...(t.fee && (t.fee.mode === "deduct" || t.fee.mode === "top") ? { fee: { mode: t.fee.mode, pct: Number(t.fee.pct) } } : {}),
  })),
}));

// Сохранить. Переименованное переписывается и в старых заявках и шаблонах — аналитика не делится на старое и новое имя.
export async function saveCategories(input: Category[], by: string): Promise<Category[]> {
  if (!Array.isArray(input)) throw new Error("Нет списка категорий");
  const next = clean(input);
  const bad = checkCategories(next);
  if (bad) throw new Error(bad);
  const prev = await loadCategories();
  for (const r of renames(prev, next)) {
    for (const table of ["topup_requests", "topup_templates"]) {
      let q = db().from(table).update(r.to.kind ? { kind: r.to.kind } : { target: r.to.target! }).eq("kind", r.kind);
      if (r.target !== undefined) q = q.eq("target", r.target);
      const { error } = await q;
      if (error) throw new Error(error.message);
    }
  }
  const { error } = await db().from("topup_settings").upsert({ id: 1, categories: next, updated_at: new Date().toISOString(), updated_by: by });
  if (error) throw new Error(error.message);
  return next;
}

// ─── Шаблоны ─────────────────────────────────────────────────────────────────────────────────────────────

const TCOLS = "id, kind, target, wallet, asset, network, address, amount, fee, minutes, comment";
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const tpl = (r: Record<string, unknown>): Template => ({
  id: String(r.id), kind: String(r.kind), target: String(r.target), wallet: (r.wallet as string) ?? null,
  asset: (r.asset as Asset) ?? null, network: (r.network as Network) ?? null, address: (r.address as string) ?? null,
  amount: num(r.amount), fee: Number(r.fee ?? 0), minutes: num(r.minutes), comment: (r.comment as string) ?? null,
});

export async function listTemplates(userId: string): Promise<Template[]> {
  const { data, error } = await db().from("topup_templates").select(TCOLS).eq("user_id", userId).order("created_at").limit(50);
  if (error) return [];   // таблицы ещё нет или база не ответила — форма без шаблонов
  return (data ?? []).map(tpl);
}

export const MAX_TEMPLATES = 20;

// Сохранить шаблон из формы. Деньги он не отправляет: только заполняет форму, отправляет человек.
export async function saveTemplate(userId: string, t: Partial<Template>): Promise<Template[]> {
  const cats = await loadCategories();
  const kind = String(t.kind ?? ""), target = String(t.target ?? "");
  if (!targetsOf(cats, kind).includes(target)) throw new Error("Выбери категорию и «куда» — шаблон без них не сохранить");
  const w = t.wallet ? findTarget(cats, kind, target)?.wallets.find((x) => x.name === t.wallet) : undefined;
  if (t.wallet && !w) throw new Error(`У «${target}» нет кошелька «${t.wallet}»`);
  const asset = (w ? null : t.asset ?? null) as Asset | null, network = (w ? null : t.network ?? null) as Network | null;
  if (asset && network && !PAIRS[asset]?.includes(network)) throw new Error(`${asset} в сети ${network} не переводим`);
  const amount = num(t.amount);
  if (amount !== null && !(amount > 0)) throw new Error("Сумма шаблона — больше нуля или пусто");
  const { count } = await db().from("topup_templates").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if ((count ?? 0) >= MAX_TEMPLATES) throw new Error(`Шаблонов не больше ${MAX_TEMPLATES} — убери ненужный`);
  const { error } = await db().from("topup_templates").insert({
    user_id: userId, kind, target, wallet: w ? w.name : null, asset, network,
    address: w ? null : String(t.address ?? "").trim() || null, amount, fee: Number(t.fee ?? 0) || 0,
    minutes: num(t.minutes), comment: String(t.comment ?? "").trim() || null,
  });
  if (error) throw new Error(error.message);
  return listTemplates(userId);
}

export async function deleteTemplate(userId: string, id: string): Promise<Template[]> {
  const { error } = await db().from("topup_templates").delete().eq("id", id).eq("user_id", userId);
  if (error) throw new Error(error.message);
  return listTemplates(userId);
}
