import { createClient } from "@supabase/supabase-js";
import { fetchAdDays, fetchCampaignDays } from "@/lib/reports-live/metaApi";
import { listSheetTitles, fetchSheetValues } from "@/lib/general-report/googleSheets";
import { toPeriods, type Period } from "@/lib/reports-live/periods";
import { getConnection } from "@/lib/connections/store";
import { parseCrmSheet, type CrmRow } from "./parseCrm";

// Сбор склада для одного человека.
//
// Порядок важен: сначала выгрузки Torro, потом Meta. Границы Meta задают даты,
// которые есть в выгрузках, а не наоборот (Decision 037). Иначе в складе окажется
// расход за дни без единой цифры дохода — а это выглядит как провал, хотя на
// деле просто нет второй половины данных.

// Окно перечитывания. Раньше здесь стояли три недели «потому что депозиты
// дозревают». Это оказалось неверно: Torro пишет депозит в день, когда он
// сделан, и прошлые дни выгрузки не переписывает. Окно нужно только ради Meta,
// которая правит цифры задним числом — замерено 31.08.2026: за несколько часов
// расход закрытой недели изменился на $0.56.
const WINDOW_DAYS = 14;

export type IngestKind = "today" | "window";

export interface IngestResult {
  userId: string;
  kind: IngestKind;
  since: string;
  until: string;
  adRows: number;
  campaignRows: number;
  crmRows: number;
  failedAccounts: number;
  skipped?: string;
}

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Не заданы NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

// «Сегодня» НЕ берётся с часов сервера. Сервер живёт в UTC, кабинеты Meta и
// выгрузки Torro — в своих поясах, и на границе суток они расходятся: замерено
// 31.08.2026, когда UTC был ещё на 30-м и единственный лист выгрузки по крео за
// 31-е не попал бы в окно вовсе — раздел собрался бы нулём.
//
// Поэтому опорная дата берётся из самих данных: самый свежий лист выгрузки. Что
// выгружено, то и грузим; какой у кого пояс — перестаёт иметь значение.
export function windowFrom(latestDay: string, kind: IngestKind): { since: string; until: string } {
  if (kind === "today") return { since: latestDay, until: latestDay };
  const from = new Date(`${latestDay}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - (WINDOW_DAYS - 1));
  return { since: from.toISOString().slice(0, 10), until: latestDay };
}

// Листы выгрузки, попадающие в окно. Служебные листы отбрасывает toPeriods.
function periodsInWindow(titles: string[], since: string, until: string): Period[] {
  return toPeriods(titles).filter((p) => p.until >= since && p.since <= until);
}

async function loadCrm(sheetId: string, since: string, until: string) {
  const titles = await listSheetTitles(sheetId);
  const periods = periodsInWindow(titles, since, until);
  if (periods.length === 0) return { periods, rows: new Map<string, CrmRow[]>() };

  const values = await fetchSheetValues(sheetId, periods.map((p) => p.key));
  const rows = new Map<string, CrmRow[]>();
  for (const p of periods) rows.set(p.key, parseCrmSheet(values.get(p.key) ?? []));
  return { periods, rows };
}

// Дни, которые реально покрыты выгрузкой. Только за них имеет смысл тянуть Meta.
function coveredDays(periods: Period[]): { since: string; until: string } | null {
  if (periods.length === 0) return null;
  const all = periods.flatMap((p) => [p.since, p.until]).sort();
  return { since: all[0], until: all[all.length - 1] };
}

export async function ingestForUser(userId: string, kind: IngestKind): Promise<IngestResult> {
  const db = admin();
  const empty = { userId, kind, since: "", until: "", adRows: 0, campaignRows: 0, crmRows: 0, failedAccounts: 0 };

  const conn = await getConnection(userId);
  if (!conn?.metaToken) return { ...empty, skipped: "нет ключа Meta" };

  const sheets = [conn.crmCampaignsSheetId, conn.crmAdsSheetId, conn.crmAdsByIdSheetId]
    .filter((v): v is string => Boolean(v));
  if (sheets.length === 0) return { ...empty, skipped: "не подключена ни одна выгрузка" };

  // Опорная дата — самый свежий лист среди всех подключённых выгрузок.
  const titles = await Promise.all(sheets.map((id) => listSheetTitles(id).catch(() => [] as string[])));
  const latest = titles.flatMap((t) => toPeriods(t)).map((p) => p.until).sort().pop();
  if (!latest) return { ...empty, skipped: "в выгрузках нет ни одного листа-периода" };

  const { since, until } = windowFrom(latest, kind);
  const base: IngestResult = { ...empty, since, until };

  const runId = crypto.randomUUID();
  await db.from("wh_ingest_runs").insert({ id: runId, user_id: userId, kind, since, until });

  try {
    // ─── Выгрузки Torro ──────────────────────────────────────────────────────
    const [campaigns, adsByName, adsById] = await Promise.all([
      conn.crmCampaignsSheetId ? loadCrm(conn.crmCampaignsSheetId, since, until) : null,
      conn.crmAdsSheetId ? loadCrm(conn.crmAdsSheetId, since, until) : null,
      conn.crmAdsByIdSheetId ? loadCrm(conn.crmAdsByIdSheetId, since, until) : null,
    ]);

    let crmRows = 0;

    for (const [src, table, keyCol] of [
      [campaigns, "wh_crm_campaign_periods", "campaign_id"],
      [adsByName, "wh_crm_ad_periods", "ad_name"],
      [adsById, "wh_crm_ad_id_periods", "ad_id"],
    ] as const) {
      if (!src) continue;
      for (const p of src.periods) {
        const rows = (src.rows.get(p.key) ?? []).map((r) => ({
          user_id: userId,
          period_start: p.since,
          period_end: p.until,
          [keyCol]: r.key,
          ...(table === "wh_crm_campaign_periods" ? { campaign_name: r.campaignName ?? null } : {}),
          clicks: r.clicks, subscribers: r.subscribers, dialogs: r.dialogs,
          registrations: r.registrations,
          dep_count: r.depCount, dep_sum: r.depSum,
          redep_count: r.redepCount, redep_sum: r.redepSum,
          ...(table === "wh_crm_ad_periods" ? { unsubscribes: r.unsubscribes } : {}),
          updated_at: new Date().toISOString(),
        }));
        if (rows.length === 0) continue;
        // Upsert, никогда не append: тот же день, собранный второй раз, должен
        // заменить прежние цифры, а не удвоить их.
        const { error } = await db.from(table).upsert(rows, { onConflict: `user_id,period_start,${keyCol}` });
        if (error) throw new Error(`${table}: ${error.message}`);
        crmRows += rows.length;
      }
    }

    // ─── Meta, только за дни, покрытые выгрузками ────────────────────────────
    const adWindow = coveredDays(adsByName?.periods ?? adsById?.periods ?? []);
    const campaignWindow = coveredDays(campaigns?.periods ?? []);

    let adRows = 0, campaignRows = 0, failedAccounts = 0;

    if (adWindow) {
      const { items, failedAccounts: f } = await fetchAdDays(conn.metaToken, adWindow.since, adWindow.until);
      failedAccounts += f;
      const rows = items.map((r) => ({
        user_id: userId, date: r.date, ad_id: r.adId, ad_name: r.adName,
        adset_id: r.adsetId || null, adset_name: r.adsetName || null,
        campaign_id: r.campaignId || null, campaign_name: r.campaignName || null,
        account_id: r.accountId, account_name: r.accountName,
        spend: r.spend, clicks: r.clicks, impressions: r.impressions,
        updated_at: new Date().toISOString(),
      }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await db.from("wh_ad_days").upsert(rows.slice(i, i + 500), { onConflict: "user_id,date,ad_id" });
        if (error) throw new Error(`wh_ad_days: ${error.message}`);
      }
      adRows = rows.length;
    }

    if (campaignWindow) {
      const { items, failedAccounts: f } = await fetchCampaignDays(conn.metaToken, campaignWindow.since, campaignWindow.until);
      failedAccounts += f;
      const rows = items.map((r) => ({
        user_id: userId, date: r.date, campaign_id: r.campaignId, campaign_name: r.campaignName || null,
        account_id: r.accountId, spend: r.spend, clicks: r.clicks, impressions: r.impressions,
        updated_at: new Date().toISOString(),
      }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await db.from("wh_campaign_days").upsert(rows.slice(i, i + 500), { onConflict: "user_id,date,campaign_id" });
        if (error) throw new Error(`wh_campaign_days: ${error.message}`);
      }
      campaignRows = rows.length;
    }

    const result = { ...base, adRows, campaignRows, crmRows, failedAccounts };
    await db.from("wh_ingest_runs").update({
      finished_at: new Date().toISOString(),
      ad_rows: adRows, campaign_rows: campaignRows, crm_rows: crmRows, failed_accounts: failedAccounts,
    }).eq("id", runId);
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Прогон с ошибкой обязан остаться в журнале с текстом. Молча упавший крон
    // неотличим от «данных не было» (Decision 018).
    await db.from("wh_ingest_runs").update({ finished_at: new Date().toISOString(), error: message }).eq("id", runId);
    throw e;
  }
}

// Все, у кого есть подключения. Кабинеты у баеров свои, поэтому один кабинет
// обходится ровно один раз за прогон — дублей быть не может.
export async function usersToIngest(): Promise<string[]> {
  const { data, error } = await admin()
    .from("buyer_connections")
    .select("user_id")
    .not("meta_token_enc", "is", null);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.user_id as string);
}
