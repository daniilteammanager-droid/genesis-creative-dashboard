import { fetchEdgePaged } from "@/lib/reports-live/metaApi";
import { dolphinCabinets } from "@/lib/dolphin/api";
import { fbtoolAccounts, fbtoolCabinets } from "@/lib/fbtool/api";
import { mskDay } from "@/lib/day";
import { warehouse } from "@/lib/warehouse/read";
import { escapeHtml } from "@/lib/telegram/links";
import { deliver } from "./deliver";

// Алерты о состоянии рекламных кабинетов: заблокирован, пропал, grace period,
// unsettled — и обратно. Идея и пороги взяты из Genesis Manager Артёма.
//
// Кабинеты собираются всеми ключами сразу — командным и баерскими: кабинет,
// который видит хоть один ключ, жив. «Пропал» — это когда его не видит никто,
// и решается это только по полному прогону: упал хоть один ключ — пропажу не
// объявляем, иначе каждый сбой Meta рассылал бы «кабинет пропал» пачкой.
//
// Баер на Dolphin — тот же поток, только состояние берётся из Dolphin (Decision 064).
// Свежесть — как у его синхронизации, часы, а не 15 минут: сами Dolphin не пинаем.

const STATUS: Record<number, string> = {
  1: "ACTIVE", 2: "DISABLED", 3: "UNSETTLED", 7: "PENDING_RISK_REVIEW", 8: "PENDING_SETTLEMENT",
  9: "IN_GRACE_PERIOD", 100: "PENDING_CLOSURE", 101: "CLOSED",
};

const PROBLEM: Record<string, string> = {
  DISABLED: "⛔ Кабинет заблокирован",
  MISSING: "🔎 Кабинет пропал",
  IN_GRACE_PERIOD: "⚠️ Кабинет в grace period",
  UNSETTLED: "💳 Кабинет в unsettled",
  PENDING_RISK_REVIEW: "🕵️ Кабинет на проверке риска",
};

// Платёжные проблемы — к ним кнопка оплаты в Meta.
const PAYMENT = new Set(["UNSETTLED", "IN_GRACE_PERIOD"]);

// disable_reason из Graph API. Неизвестный код показывается числом.
const DISABLE_REASON: Record<number, string> = {
  1: "нарушение правил рекламы", 2: "проверка IP", 3: "риск по платежам", 4: "серый аккаунт закрыт",
  5: "проверка AFC", 6: "целостность бизнеса", 7: "закрыт навсегда", 8: "неиспользуемый реселлер", 9: "неиспользуемый кабинет",
};

export interface CabinetState {
  accountId: string;
  name: string | null;
  status: string;
  disableReason: number | null;
  currency: string | null;
  balance: number | null;
  prepay: boolean | null;
}

export interface CabinetAlert {
  accountId: string;
  text: string;           // HTML
  payUrl: string | null;
}

interface MetaAccount {
  id: string;
  name?: string;
  account_status: number;
  disable_reason?: number;
  currency?: string;
  balance?: string;
  is_prepay_account?: boolean;
}

// Meta отдаёт баланс в минимальных единицах валюты: центах, но у иены их нет.
// Сколько знаков после запятой у валюты, знает Intl — свой справочник не нужен.
export function fromMinor(raw: string | undefined, currency: string | undefined): number | null {
  if (raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  let digits = 2;
  try {
    digits = new Intl.NumberFormat("en", { style: "currency", currency: currency || "USD" }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch { /* неизвестная валюта — считаем центами */ }
  return n / 10 ** digits;
}

export function toState(a: MetaAccount): CabinetState {
  return {
    accountId: a.id.replace(/^act_/, ""),
    name: a.name ?? null,
    status: STATUS[a.account_status] ?? `STATUS_${a.account_status}`,
    disableReason: a.disable_reason ?? null,
    currency: a.currency ?? null,
    balance: fromMinor(a.balance, a.currency),
    prepay: a.is_prepay_account ?? null,
  };
}

const label = (s: { accountId: string; name: string | null }) =>
  `CAB${s.accountId.slice(-4)} · ${escapeHtml(s.name || s.accountId)}`;

function money(value: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency: currency || "USD" }).format(value);
  } catch {
    return `${value} ${currency ?? ""}`.trim();
  }
}

function alertText(next: CabinetState, prev: CabinetState, at: Date): string {
  const heading = PROBLEM[next.status] ?? (prev.status === "MISSING" ? "✅ Кабинет снова доступен" : "✅ Проблема кабинета снята");
  const when = at.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const reason = next.status === "DISABLED" && next.disableReason
    ? `Причина Meta: ${DISABLE_REASON[next.disableReason] ?? `код ${next.disableReason}`}`
    : null;
  const balance = PAYMENT.has(next.status) && next.balance !== null
    ? `${next.prepay ? "Остаток предоплаты" : "К оплате"}: ${money(next.balance, next.currency)}`
    : null;
  const missing = next.status === "MISSING"
    ? "Его не видит ни один подключённый источник — ключи Meta и Dolphin. История в дашборде остаётся."
    : null;
  return [
    `<b>${heading}</b>`,
    label(next),
    `ID: <code>${next.accountId}</code>`,
    `Статус: ${next.status} (было ${prev.status})`,
    reason, balance, missing,
    `Обнаружено: ${when} МСК`,
  ].filter(Boolean).join("\n");
}

// Чистая функция: что записать и о чём сообщить. Алерт — только на смену статуса,
// и только если новый статус — проблема или выход из проблемы в ACTIVE.
export function diffCabinets(
  prev: Map<string, CabinetState>,
  seen: CabinetState[],
  complete: boolean,
  at: Date = new Date()
): { states: CabinetState[]; alerts: CabinetAlert[] } {
  const states = new Map<string, CabinetState>();
  for (const s of seen) states.set(s.accountId, s);
  // Пропавшие объявляем только по полному прогону (см. шапку файла).
  if (complete) {
    for (const [id, p] of prev) {
      if (!states.has(id) && p.status !== "MISSING") states.set(id, { ...p, status: "MISSING" });
    }
  }

  const alerts: CabinetAlert[] = [];
  // Пустое прошлое — первый прогон: только запоминаем.
  if (prev.size > 0) {
    for (const next of states.values()) {
      const p = prev.get(next.accountId);
      if (!p || p.status === next.status) continue;
      const problem = next.status in PROBLEM;
      const recovered = next.status === "ACTIVE" && p.status in PROBLEM;
      if (!problem && !recovered) continue;
      alerts.push({
        accountId: next.accountId,
        text: alertText(next, p, at),
        // Через Ads Manager, а не billing_hub: у Артёма стоял billing_hub/payment_settings,
        // и он открывал просто Facebook без кабинета (проверено 24.10.2026).
        payUrl: PAYMENT.has(next.status)
          ? `https://adsmanager.facebook.com/ads/manager/billing/transactions?act=${next.accountId}`
          : null,
      });
    }
  }
  return { states: [...states.values()], alerts };
}

const FIELDS = "id,name,account_status,disable_reason,currency,balance,is_prepay_account";

// Все кабинеты, которые видит ключ: напрямую и через Business Manager. Статусы
// любые — в отличие от отчётов, тут нужны именно неактивные.
export async function accountsOf(token: string, withBusinesses: boolean): Promise<MetaAccount[]> {
  const direct = await fetchEdgePaged<MetaAccount>(token, "me", "adaccounts", FIELDS);
  if (!withBusinesses) return direct;
  // Ключ без business_management на /me/businesses отвечает «Missing Permission» —
  // это не сбой ключа: его прямые кабинеты живы и читаются.
  const businesses = await fetchEdgePaged<{ id: string }>(token, "me", "businesses", "id").catch((e: unknown) => {
    if (/Missing Permission|\(#100\)/i.test(e instanceof Error ? e.message : String(e))) return [];
    throw e;
  });
  const nested = await Promise.all(businesses.flatMap((b) => [
    fetchEdgePaged<MetaAccount>(token, b.id, "owned_ad_accounts", FIELDS),
    fetchEdgePaged<MetaAccount>(token, b.id, "client_ad_accounts", FIELDS),
  ]));
  return [...direct, ...nested.flat()];
}

export interface CabinetCheckResult {
  cabinets: number;
  alerts: number;
  sent: number;
  failedTokens: number;
  firstRun: boolean;
  tokenFor: Map<string, string>;   // живой кабинет → ключ, который его видит
  dolphinFor: Map<string, string>; // живой кабинет без ключа Meta → ключ Dolphin
  fbtoolFor: Map<string, { key: string; account: string }>; // живой кабинет → ключ и аккаунт FB Tool
}

export async function checkCabinets(buyerTokens: string[], dolphinTokens: string[] = [], fbtool: { key: string; userId: string }[] = []): Promise<CabinetCheckResult> {
  const db = warehouse();
  const tokens: { token: string; withBusinesses: boolean }[] = [
    ...(process.env.META_ACCESS_TOKEN ? [{ token: process.env.META_ACCESS_TOKEN, withBusinesses: true }] : []),
    // Как в складе: напрямую и через Business Manager (Decision 062).
    ...buyerTokens.map((token) => ({ token, withBusinesses: true })),
  ];

  const seen = new Map<string, CabinetState>();
  // Каким ключом читать живой кабинет дальше — антиотклону.
  const tokenFor = new Map<string, string>();
  const dolphinFor = new Map<string, string>();
  const fbtoolFor = new Map<string, { key: string; account: string }>();
  let failedTokens = 0;
  // Последовательно: лимит приложения общий на все ключи (Decision 042).
  for (const t of tokens) {
    try {
      for (const a of await accountsOf(t.token, t.withBusinesses)) {
        const s = toState(a);
        const was = seen.get(s.accountId);
        // Один кабинет через два ключа: живой статус важнее, чем то, что видит
        // второй ключ с урезанными правами.
        if (!was || s.status === "ACTIVE") seen.set(s.accountId, s);
        if (s.status === "ACTIVE" && !tokenFor.has(s.accountId)) tokenFor.set(s.accountId, t.token);
      }
    } catch (e) {
      failedTokens++;
      console.warn("cabinets: ключ не прочитался:", e instanceof Error ? e.message : e);
    }
  }
  // Dolphin — после Meta: кабинет, который видят оба, читаем через Meta, она свежее.
  for (const token of dolphinTokens) {
    try {
      for (const c of await dolphinCabinets(token, mskDay())) {
        const s: CabinetState = {
          ...toState({ id: c.id, name: c.name, account_status: c.status, disable_reason: c.disableReason ?? undefined, currency: c.currency }),
          balance: c.balance, prepay: null,
        };
        const was = seen.get(s.accountId);
        if (!was || (s.status === "ACTIVE" && was.status !== "ACTIVE")) seen.set(s.accountId, s);
        if (s.status === "ACTIVE" && !tokenFor.has(s.accountId) && !dolphinFor.has(s.accountId)) dolphinFor.set(s.accountId, token);
      }
    } catch (e) {
      failedTokens++;
      console.warn("cabinets: Dolphin не прочитался:", e instanceof Error ? e.message : e);
    }
  }
  // FB Tool (Decision 071): кабинеты живых аккаунтов. Разлогиненный аккаунт — не
  // «кабинеты пропали»: про него баеру уходит свой алерт, а его кабинеты держат
  // прошлое состояние (ниже). Иначе у Андрея, у которого разлогинены 7 аккаунтов
  // из 8, все их кабинеты каждый раз «пропадали» бы.
  const keepOwners = new Set<string>();
  for (const { key, userId } of fbtool) {
    try {
      const accounts = await fbtoolAccounts(key);
      if (accounts.some((a) => !a.ok)) keepOwners.add(userId);
      for (const a of accounts.filter((x) => x.ok)) {
        for (const c of await fbtoolCabinets(key, a.id)) {
          const s: CabinetState = {
            ...toState({ id: c.id, name: c.name, account_status: c.status, disable_reason: c.disableReason ?? undefined, currency: c.currency }),
            balance: null, prepay: null,
          };
          const was = seen.get(s.accountId);
          if (!was || (s.status === "ACTIVE" && was.status !== "ACTIVE")) seen.set(s.accountId, s);
          if (s.status === "ACTIVE" && !tokenFor.has(s.accountId) && !dolphinFor.has(s.accountId) && !fbtoolFor.has(s.accountId)) {
            fbtoolFor.set(s.accountId, { key, account: a.id });
          }
        }
      }
    } catch (e) {
      failedTokens++;
      console.warn("cabinets: FB Tool не прочитался:", e instanceof Error ? e.message : e);
    }
  }
  const sources = tokens.length + dolphinTokens.length + fbtool.length;
  if (sources > 0 && failedTokens === sources) throw new Error("Ни один источник не прочитался — состояние кабинетов не обновлено");

  const { data: prevRows, error } = await db.from("wh_cabinet_states").select("*");
  if (error) throw new Error(`wh_cabinet_states: ${error.message}`);
  const prev = new Map<string, CabinetState>((prevRows ?? []).map((r) => [r.account_id, {
    accountId: r.account_id, name: r.name, status: r.status, disableReason: r.disable_reason,
    currency: r.currency, balance: r.balance === null ? null : Number(r.balance), prepay: r.prepay,
  }]));

  if (keepOwners.size) {
    const { data: kept } = await db.from("wh_account_owners").select("account_id").in("owner_user_id", [...keepOwners]);
    for (const k of kept ?? []) {
      const p = prev.get(k.account_id as string);
      if (p && !seen.has(p.accountId)) seen.set(p.accountId, p);
    }
  }

  const now = new Date();
  const { states, alerts } = diffCabinets(prev, [...seen.values()], failedTokens === 0, now);

  // Прошлые отметки времени передаются явно: в пакетном upsert пропущенное поле
  // становится значением по умолчанию, и changed_at сбрасывался бы каждый прогон.
  const stamps = new Map((prevRows ?? []).map((r) => [r.account_id as string, { seen: r.seen_at, changed: r.changed_at, alerted: r.alerted_at }]));
  // Алерт о проблеме — отметка для утренней сводки (Decision 066).
  const statusOf = new Map(states.map((s) => [s.accountId, s.status]));
  const problemAlert = new Set(alerts.filter((a) => (statusOf.get(a.accountId) ?? "") in PROBLEM).map((a) => a.accountId));
  const rows = states.map((s) => {
    const p = prev.get(s.accountId);
    const was = stamps.get(s.accountId);
    return {
      account_id: s.accountId, name: s.name, status: s.status, disable_reason: s.disableReason,
      currency: s.currency, balance: s.balance, prepay: s.prepay,
      // seen_at двигается, только если кабинет правда видели.
      seen_at: seen.has(s.accountId) || !was ? now.toISOString() : was.seen,
      changed_at: !p || p.status !== s.status || !was ? now.toISOString() : was.changed,
      alerted_at: problemAlert.has(s.accountId) ? now.toISOString() : was?.alerted ?? null,
    };
  });
  for (let i = 0; i < rows.length; i += 500) {
    const { error: e } = await db.from("wh_cabinet_states").upsert(rows.slice(i, i + 500), { onConflict: "account_id" });
    if (e) throw new Error(`wh_cabinet_states: ${e.message}`);
  }

  const sent = await deliver(alerts.map((a) => ({
    accountId: a.accountId,
    text: a.text,
    extra: a.payUrl ? { reply_markup: { inline_keyboard: [[{ text: "💳 Открыть оплату в Meta", url: a.payUrl }]] } } : undefined,
  })), "cabinet_status");
  return { cabinets: states.length, alerts: alerts.length, sent, failedTokens, firstRun: prev.size === 0, tokenFor, dolphinFor, fbtoolFor };
}
