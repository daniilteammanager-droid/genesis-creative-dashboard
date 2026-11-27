import { addressFits, PAIRS, type Asset, type Network } from "./chain";

// Настройки «Пополнений» (Decision 131): категория → «куда» → закреплённые кошельки. Чистые функции без
// серверных зависимостей — ими пользуются страница, роуты и MCP. Хранение — lib/topups/settings.ts.

// «Другое» — для того, чего нет в списке. Его нет в настройках: оно всегда последнее в каждой категории.
export const OTHER = "Другое";

export interface Wallet { name: string; asset: Asset; network: Network; address: string }
// only — переводить можно только на кошельки отсюда, «Другой адрес» в форме недоступен.
export interface Target { id: string; name: string; only?: boolean; wallets: Wallet[] }
export interface Category { id: string; name: string; targets: Target[] }

// Список до настроек — как был в форме до 27.11.2026. Пока владелец ничего не сохранил, работает он.
const START: [string, string[]][] = [
  ["Расходники", ["Кабинеты/БМ/Кинги/ФП", "Прокси", "Домены", "Почты", "Антик", "Сервера/хостинг", "Подписки/сервисы", "Кошелёк USDT", "Склад кабинетов"]],
  ["Карты", ["Brocard", "AbCard", "Adpos", "FBMcards"]],
  ["Агенты", ["T2A", "RentAcc", "TSR", "Monika (агенты TikTok)"]],
  ["Кабинеты", ["TG Ads кабинеты (TON)"]],
];
export const DEFAULT: Category[] = START.map(([name, targets], i) => ({
  id: `c${i + 1}`, name, targets: targets.map((t, j) => ({ id: `c${i + 1}t${j + 1}`, name: t, wallets: [] })),
}));

export const newId = () => Math.random().toString(36).slice(2, 10);
export const targetsOf = (cats: Category[], kind: string) => {
  const c = cats.find((x) => x.name === kind);
  return c ? [...c.targets.map((t) => t.name), OTHER] : [];
};
export const findTarget = (cats: Category[], kind: string, target: string) =>
  cats.find((c) => c.name === kind)?.targets.find((t) => t.name === target);

// Проверка перед сохранением: текст ошибки или null. Пустые имена, повторы и адрес не той сети — отказ.
export function checkCategories(cats: Category[]): string | null {
  if (!cats.length) return "Нужна хотя бы одна категория";
  const seen = new Set<string>();
  for (const c of cats) {
    const name = c.name.trim();
    if (!name) return "У категории нет названия";
    if (seen.has(name.toLowerCase())) return `Категория «${name}» — два раза`;
    seen.add(name.toLowerCase());
    const ts = new Set<string>();
    for (const t of c.targets) {
      const tn = t.name.trim();
      if (!tn) return `В «${name}» есть «куда» без названия`;
      if (tn.toLowerCase() === OTHER.toLowerCase()) return `«${OTHER}» есть в каждой категории само — его не добавляют`;
      if (ts.has(tn.toLowerCase())) return `В «${name}» «${tn}» — два раза`;
      ts.add(tn.toLowerCase());
      const ws = new Set<string>();
      for (const w of t.wallets) {
        const wn = w.name.trim();
        if (!wn) return `У кошелька «${tn}» нет подписи`;
        if (ws.has(wn.toLowerCase())) return `У «${tn}» два кошелька «${wn}»`;
        ws.add(wn.toLowerCase());
        if (!PAIRS[w.asset]?.includes(w.network)) return `«${tn}» · ${wn}: ${w.asset} в сети ${w.network} не переводим`;
        if (!addressFits(w.network, w.address.trim())) return `«${tn}» · ${wn}: адрес не похож на адрес сети ${w.network}`;
      }
      if (t.only && !t.wallets.length) return `«${tn}»: «только эти кошельки», а кошельков нет`;
    }
  }
  return null;
}

// Что переименовали — по id. Старые заявки и шаблоны переписываются на новые имена, иначе в аналитике
// одно и то же «куда» разъедется на две строки. Сначала категории, потом «куда» — уже в новой категории.
export interface Rename { kind: string; target?: string; to: { kind?: string; target?: string } }
export function renames(prev: Category[], next: Category[]): Rename[] {
  const out: Rename[] = [];
  const old = new Map(prev.map((c) => [c.id, c]));
  for (const c of next) {
    const p = old.get(c.id);
    if (!p) continue;
    if (p.name !== c.name.trim()) out.push({ kind: p.name, to: { kind: c.name.trim() } });
  }
  for (const c of next) {
    const p = old.get(c.id);
    if (!p) continue;
    const was = new Map(p.targets.map((t) => [t.id, t.name]));
    for (const t of c.targets) {
      const name = was.get(t.id);
      if (name !== undefined && name !== t.name.trim()) out.push({ kind: c.name.trim(), target: name, to: { target: t.name.trim() } });
    }
  }
  return out;
}

// Шаблон частой заявки — личный. wallet — подпись кошелька «куда» (адрес, монета и сеть — из настроек на момент
// заявки), иначе свой asset / network / address. amount пусто — сумму вводят каждый раз.
export interface Template {
  id: string; kind: string; target: string; wallet: string | null; asset: Asset | null; network: Network | null;
  address: string | null; amount: number | null; fee: number; minutes: number | null; comment: string | null;
}

// Что предложить сохранить шаблоном: за 30 дней три и больше одинаковых заявок («куда», адрес, монета, сумма),
// а шаблона на это «куда» с этой суммой ещё нет. Одна подсказка — самая частая.
type Own = { kind: string; target: string; address: string; asset: Asset; network: Network; amount: number; status: string; created_at: string };
export interface Suggest { kind: string; target: string; address: string; asset: Asset; network: Network; amount: number; n: number }
export function suggestTemplate(rows: Own[], tpls: Pick<Template, "kind" | "target" | "amount">[], now = Date.now()): Suggest | null {
  const from = now - 30 * 86_400_000;
  const by = new Map<string, Suggest>();
  for (const r of rows) {
    if (r.status === "rejected" || Date.parse(r.created_at) < from) continue;
    const k = [r.kind, r.target, r.address, r.asset, r.network, r.amount].join("\u0000");
    const s = by.get(k) ?? by.set(k, { kind: r.kind, target: r.target, address: r.address, asset: r.asset, network: r.network, amount: r.amount, n: 0 }).get(k)!;
    s.n++;
  }
  const have = (s: Suggest) => tpls.some((t) => t.kind === s.kind && t.target === s.target && t.amount === s.amount);
  return [...by.values()].filter((s) => s.n >= 3 && !have(s)).sort((a, b) => b.n - a.n)[0] ?? null;
}

// Подсказки владельцу из истории заявок: у «куда» без кошелька большая часть заявок ушла на один адрес — закрепить;
// в «Другое» категории все заявки на один адрес — похоже на отдельное «куда».
type Row = { kind: string; target: string; address: string; asset: Asset; network: Network; status: string };
export interface Hint { kind: string; target: string; asset: Asset; network: Network; address: string; n: number; of: number; make: boolean }
export function walletHints(rows: Row[], cats: Category[]): Hint[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    if (r.status === "rejected") continue;
    const k = `${r.kind}\u0000${r.target}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: Hint[] = [];
  for (const [k, list] of groups) {
    const [kind, target] = k.split("\u0000");
    if (!cats.some((c) => c.name === kind)) continue;
    const other = target === OTHER;
    const t = findTarget(cats, kind, target);
    if (!other && (!t || t.wallets.length)) continue;
    const by = new Map<string, Row[]>();
    for (const r of list) by.set(r.address, [...(by.get(r.address) ?? []), r]);
    const [address, top] = [...by].sort((a, b) => b[1].length - a[1].length)[0];
    const n = top.length;
    if (other ? n >= 5 && n / list.length >= 0.8 : n >= 3 && n / list.length >= 0.4) {
      out.push({ kind, target, asset: top[0].asset, network: top[0].network, address, n, of: list.length, make: other });
    }
  }
  return out.sort((a, b) => b.n - a.n);
}
