import { fetchEdgePaged } from "@/lib/reports-live/metaApi";
import { dolphinProblemAds, type DolphinAdStatus } from "@/lib/dolphin/api";
import { fbtoolProblemAds } from "@/lib/fbtool/api";
import { mskDay } from "@/lib/day";
import { warehouse } from "@/lib/warehouse/read";
import { escapeHtml } from "@/lib/telegram/links";
import { deliver, type Alert } from "./deliver";
import { actionButtons } from "@/lib/antireject/bot";
import { listAds, tgId } from "@/lib/tgads/api";

// Антиотклон, часть первая: заметить отклонённое объявление и прислать причину.
// Логика «что считать отклонённым» — из Genesis Manager Артёма: DISAPPROVED
// всегда, WITH_ISSUES — только если у объявления есть замечания ревью
// (иначе это любая техническая мелочь вроде проблем с пикселем).
//
// Смотрим только живые кабинеты: в заблокированном отклонения уже не важны.
// Ключ на каждый кабинет приходит из проверки кабинетов — тот, что его видит.
// Кабинеты баера на Dolphin читаются из Dolphin, по той же логике (Decision 064).
// Telegram Ads — статус «declined» с причиной, алерт владельцу ключа (Decision 075).

const FIELDS = "id,name,account_id,effective_status,ad_review_feedback,issues_info,campaign{name},adset{name}";
const FILTER = JSON.stringify([{ field: "effective_status", operator: "IN", value: ["DISAPPROVED", "WITH_ISSUES"] }]);
// Пачка отклонений за раз (модерация прошлась по кабинету) — не повод
// присылать сорок сообщений. Сверх лимита — одно итоговое.
const MAX_ALERTS = 15;
// Сторожевая строка: таблица заполнялась хотя бы раз. Пустая таблица без неё —
// «первый прогон, только запомнить»; с ней — «отклонений просто нет».
const SENTINEL = "__initialized__";

interface MetaAd {
  id: string;
  name?: string;
  account_id?: string;
  effective_status: string;
  // { global: { код: текст }, placement_specific: { площадка: { код: текст } } }
  ad_review_feedback?: Record<string, unknown>;
  issues_info?: { error_message?: string; error_summary?: string; error_code?: number }[];
  campaign?: { name?: string };
  adset?: { name?: string };
}

export interface RejectedAd {
  adId: string;
  accountId: string;
  adName: string | null;
  campaignName: string | null;
  adsetName: string | null;
  status: string;
  reason: string | null;
}

// Замечания ревью плоским списком «путь: текст». Глубина у Meta разная:
// у global — код → текст, у placement_specific — площадка → код → текст.
// Плоский разбор (как в Genesis Manager) печатал бы «[object Object]».
function feedbackRows(node: unknown, path: string[] = []): string[] {
  if (node && typeof node === "object") {
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => feedbackRows(v, [...path, k]));
  }
  const text = String(node ?? "").trim();
  if (!text) return [];
  // «global» не печатаем: это и есть обычное замечание.
  const scope = path[0] === "global" ? "" : `${path[0]} · `;
  return [`${scope}${path.slice(1).join(" · ")}: ${text}`];
}

const hasFeedback = (ad: MetaAd) => feedbackRows(ad.ad_review_feedback ?? {}).length > 0;

export function isRejected(ad: MetaAd): boolean {
  return ad.effective_status === "DISAPPROVED" || (ad.effective_status === "WITH_ISSUES" && hasFeedback(ad));
}

export function reasonOf(ad: MetaAd): string | null {
  const rows = feedbackRows(ad.ad_review_feedback ?? {});
  for (const i of ad.issues_info ?? []) {
    const m = (i.error_message || i.error_summary || "").trim();
    if (m) rows.push(m);
  }
  return rows.length ? [...new Set(rows)].join("\n").slice(0, 1400) : null;
}

// У Dolphin замечания плоские: «правило → текст». Это ровно global у Meta.
export function fromDolphin(a: DolphinAdStatus): MetaAd {
  return {
    id: a.adId, name: a.name, account_id: a.accountId, effective_status: a.effectiveStatus,
    ad_review_feedback: a.feedback ? { global: a.feedback } : undefined,
    campaign: { name: a.campaignName }, adset: { name: a.adsetName },
  };
}

export function toRejected(ad: MetaAd, accountId: string): RejectedAd {
  return {
    adId: ad.id, accountId, adName: ad.name ?? null,
    campaignName: ad.campaign?.name ?? null, adsetName: ad.adset?.name ?? null,
    status: ad.effective_status, reason: reasonOf(ad),
  };
}

export function tgRejectionText(r: RejectedAd, accountName: string | null): string {
  const e = (s: string | null) => escapeHtml(s || "—");
  return [
    "<b>⛔ Отклонено объявление TG Ads</b>",
    `Кабинет: ${e(accountName)}`,
    `Объявление: <b>${e(r.adName)}</b>`,
    `Причина: ${r.reason ? escapeHtml(r.reason) : "Telegram не вернул причину"}`,
    `ID: <code>${r.adId.split(":").pop()}</code>`,
  ].join("\n");
}

export function rejectionText(r: RejectedAd, accountName: string | null): string {
  const e = (s: string | null) => escapeHtml(s || "—");
  return [
    "<b>⛔ Отклонено объявление</b>",
    `Кабинет: CAB${r.accountId.slice(-4)} · ${e(accountName)}`,
    `Кампания: ${e(r.campaignName)}`,
    `Адсет: ${e(r.adsetName)}`,
    `Объявление: <b>${e(r.adName)}</b>`,
    `Статус: ${r.status}`,
    `Причина: ${r.reason ? escapeHtml(r.reason) : "Meta не вернула причину"}`,
    `ID: <code>${r.adId}</code>`,
  ].join("\n");
}

// Чистая функция: что новое (алерт), что держать, что забыть (одобрили).
export function diffRejected(known: Set<string>, current: RejectedAd[], checkedAccounts: Set<string>, knownAccount: Map<string, string>) {
  const fresh = current.filter((r) => !known.has(r.adId));
  const still = new Set(current.map((r) => r.adId));
  // Забываем только объявления из кабинетов, которые в этот раз прочитались:
  // не прочитался кабинет — это не значит, что его отклонения одобрили.
  const gone = [...known].filter((id) => !still.has(id) && checkedAccounts.has(knownAccount.get(id) ?? ""));
  return { fresh, gone };
}

export interface RejectedCheckResult {
  accounts: number;
  failedAccounts: number;
  rejected: number;
  fresh: number;
  sent: number;
  firstRun: boolean;
}

export interface TgadsKey { token: string; accountId: string; accountTitle: string; userId: string }

export async function checkRejectedAds(
  tokenFor: Map<string, string>, dolphinFor: Map<string, string> = new Map(),
  fbtoolFor: Map<string, { key: string; account: string }> = new Map(), tgads: TgadsKey[] = [],
): Promise<RejectedCheckResult> {
  const db = warehouse();
  const current: RejectedAd[] = [];
  const checked = new Set<string>();
  let failedAccounts = 0;

  // По одному кабинету за раз: лимит приложения общий (Decision 042), а отклонённых
  // обычно единицы — запрос с фильтром дешёвый.
  for (const [accountId, token] of tokenFor) {
    try {
      const ads = await fetchEdgePaged<MetaAd>(token, `act_${accountId}`, "ads", FIELDS, 200, { filtering: FILTER });
      for (const ad of ads) if (isRejected(ad)) current.push(toRejected(ad, accountId));
      checked.add(accountId);
    } catch (e) {
      failedAccounts++;
      console.warn(`rejected: кабинет …${accountId.slice(-4)} не прочитался:`, e instanceof Error ? e.message : e);
    }
  }

  // Dolphin: один список на ключ, а не запрос на кабинет — фильтра по кабинету у него нет.
  const byDolphin = new Map<string, Set<string>>();
  for (const [accountId, token] of dolphinFor) byDolphin.set(token, (byDolphin.get(token) ?? new Set()).add(accountId));
  for (const [token, accounts] of byDolphin) {
    try {
      for (const a of await dolphinProblemAds(token, mskDay())) {
        const ad = fromDolphin(a);
        if (accounts.has(a.accountId) && isRejected(ad)) current.push(toRejected(ad, a.accountId));
      }
      for (const id of accounts) checked.add(id);
    } catch (e) {
      failedAccounts += accounts.size;
      console.warn("rejected: Dolphin не прочитался:", e instanceof Error ? e.message : e);
    }
  }

  // FB Tool (Decision 071): один запрос на аккаунт, сразу с фильтром отклонённых.
  // Причины FB Tool не отдаёт — алерт придёт со статусом, без причины.
  const byFbtool = new Map<string, { key: string; account: string; cabinets: Set<string> }>();
  for (const [accountId, f] of fbtoolFor) {
    const k = `${f.key}|${f.account}`;
    const cur = byFbtool.get(k) ?? { ...f, cabinets: new Set<string>() };
    cur.cabinets.add(accountId);
    byFbtool.set(k, cur);
  }
  for (const f of byFbtool.values()) {
    try {
      for (const a of await fbtoolProblemAds(f.key, f.account, mskDay())) {
        const ad = fromDolphin(a);
        if (f.cabinets.has(a.accountId) && isRejected(ad)) current.push(toRejected(ad, a.accountId));
      }
      for (const id of f.cabinets) checked.add(id);
    } catch (e) {
      failedAccounts += f.cabinets.size;
      console.warn("rejected: FB Tool не прочитался:", e instanceof Error ? e.message : e);
    }
  }

  // TG Ads: один список объявлений на ключ. Кабинета нет в wh_account_owners —
  // он того, чей ключ, поэтому владелец едет в строку (owner_user_id).
  const tg = new Map<string, TgadsKey>();
  for (const k of tgads) {
    try {
      for (const a of await listAds(k.token)) {
        if (a.status !== "declined") continue;
        current.push({
          adId: tgId(k.accountId, a.ad_id), accountId: k.accountId, adName: a.title, campaignName: null, adsetName: null,
          status: "declined", reason: a.decline_reason?.text?.trim() || null,
        });
      }
      checked.add(k.accountId);
      tg.set(k.accountId, k);
    } catch (e) {
      failedAccounts++;
      console.warn(`rejected: TG Ads «${k.accountTitle}» не прочитался:`, e instanceof Error ? e.message : e);
    }
  }

  const { data: knownRows, error } = await db.from("wh_rejected_ads").select("ad_id, account_id");
  if (error) throw new Error(`wh_rejected_ads: ${error.message}`);
  const firstRun = !(knownRows ?? []).some((r) => r.ad_id === SENTINEL);
  // Новый кабинет TG в первый раз только запоминается, как таблица целиком в первый прогон:
  // иначе все давние отклонения пришли бы алертами разом. Отметка — своя на кабинет.
  const tgSeen = new Set((knownRows ?? []).filter((r) => (r.ad_id as string).startsWith(`${SENTINEL}:`)).map((r) => r.account_id as string));
  const tgNew = [...tg.keys()].filter((id) => !tgSeen.has(id));
  const rows = (knownRows ?? []).filter((r) => !(r.ad_id as string).startsWith(SENTINEL));
  const known = new Set(rows.map((r) => r.ad_id as string));
  const knownAccount = new Map(rows.map((r) => [r.ad_id as string, r.account_id as string]));

  const diff = diffRejected(known, current, checked, knownAccount);
  const { gone } = diff;
  const silent = (r: RejectedAd) => firstRun || tgNew.includes(r.accountId);
  const fresh = diff.fresh.filter((r) => !silent(r));

  if (diff.fresh.length || firstRun || tgNew.length) {
    const insert = diff.fresh.map((r) => ({
      ad_id: r.adId, account_id: r.accountId, ad_name: r.adName, campaign_name: r.campaignName,
      adset_name: r.adsetName, status: r.status, reason: r.reason, owner_user_id: tg.get(r.accountId)?.userId ?? null,
      // Первый прогон только запоминает — это не алерт, и в сводку он не идёт.
      alerted_at: silent(r) ? null : new Date().toISOString(),
    }));
    const mark = (ad_id: string, account_id: string) =>
      ({ ad_id, account_id, ad_name: null, campaign_name: null, adset_name: null, status: "-", reason: null, owner_user_id: null, alerted_at: null });
    if (firstRun) insert.push(mark(SENTINEL, ""));
    for (const id of tgNew) insert.push(mark(`${SENTINEL}:${id}`, id));
    const { error: e } = await db.from("wh_rejected_ads").upsert(insert, { onConflict: "ad_id" });
    if (e) throw new Error(`wh_rejected_ads: ${e.message}`);
  }
  for (let i = 0; i < gone.length; i += 200) {
    const { error: e } = await db.from("wh_rejected_ads").delete().in("ad_id", gone.slice(i, i + 200));
    if (e) throw new Error(`wh_rejected_ads: ${e.message}`);
  }

  let sent = 0;
  if (!firstRun && fresh.length) {
    const { data: names } = await db.from("wh_cabinet_states").select("account_id, name")
      .in("account_id", [...new Set(fresh.map((r) => r.accountId))]);
    const nameOf = new Map((names ?? []).map((n) => [n.account_id as string, n.name as string | null]));

    const alerts: Alert[] = fresh.slice(0, MAX_ALERTS).map((r): Alert => tg.has(r.accountId) ? {
      accountId: r.accountId, ownerId: tg.get(r.accountId)!.userId,
      text: tgRejectionText(r, tg.get(r.accountId)!.accountTitle),
    } : {
      accountId: r.accountId,
      text: rejectionText(r, nameOf.get(r.accountId) ?? null),
      extra: { reply_markup: { inline_keyboard: [
        [{ text: "Открыть в Ads Manager", url: `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${r.accountId}&selected_ad_ids=${r.adId}` }],
        // Кнопки антиотклона — только кабинетам на Meta: у Dolphin писать нечем (Decision 067).
        ...(tokenFor.has(r.accountId) ? actionButtons(r.adId) : []),
      ] } },
    });
    // Остаток — одной сводкой на кабинет, чтобы не потерять ни одного.
    const rest = new Map<string, number>();
    for (const r of fresh.slice(MAX_ALERTS)) rest.set(r.accountId, (rest.get(r.accountId) ?? 0) + 1);
    for (const [accountId, n] of rest) {
      const k = tg.get(accountId);
      if (k) {
        alerts.push({ accountId, ownerId: k.userId, text: `<b>⛔ Ещё ${n} отклонённых объявлений TG Ads</b>\nКабинет: ${escapeHtml(k.accountTitle)}` });
        continue;
      }
      alerts.push({
        accountId,
        text: `<b>⛔ Ещё ${n} отклонённых объявлений</b>\nКабинет: CAB${accountId.slice(-4)} · ${escapeHtml(nameOf.get(accountId) || "—")}\nСписок — в Ads Manager.`,
        extra: { reply_markup: { inline_keyboard: [[{ text: "Открыть в Ads Manager", url: `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${accountId}` }]] } },
      });
    }
    sent = await deliver(alerts, "ad_rejected");
  }

  return { accounts: tokenFor.size + dolphinFor.size + fbtoolFor.size + tgads.length, failedAccounts, rejected: current.length, fresh: fresh.length, sent, firstRun };
}
