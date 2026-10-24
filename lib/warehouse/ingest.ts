import { fetchActiveAccounts, fetchAdDays, fetchCampaignDays, fetchAdSetTargeting, fetchAdSetTargetingByIds, type AccountScope } from "@/lib/reports-live/metaApi";
import { getConnection } from "@/lib/connections/store";
import { markMetaKey, metaTokensOf } from "@/lib/connections/metaKeys";
import { notify, escapeHtml } from "@/lib/telegram/links";
import { mskDay } from "@/lib/day";
import { warehouse } from "./read";
import { ingestTorro } from "./torroIngest";
import { dolphinAdDays, dolphinCabinets } from "@/lib/dolphin/api";

// Сбор склада для одного человека (Decision 061).
//
// Расход — из его источника (сейчас Meta: все его ключи сразу), Torro — по API.
// Склад расхода — одна строка на «день + объявление»: дублей между ключами и
// людьми не бывает, смена источника перезаписывает те же строки.
//
// Кабинет принадлежит тому, чей ключ его видит. Первый увидел — его; видит
// второй — расход второму не пишется, владельцу дашборда приходит алерт.
// Ключи владельца не видели кабинет два дня — кабинет свободен.

// Окно перечитывания: Meta правит цифры задним числом (замер 31.08.2026 — за
// несколько часов расход закрытой недели изменился на $0.56).
const WINDOW_DAYS = 14;
// Догрузка истории кусками за прогон: Meta по две недели, Torro по неделе —
// у Torro запрос на каждый день.
const META_CHUNK_DAYS = 14;
const TORRO_CHUNK_DAYS = 7;
// Глубже Meta Insights не отдаёт: 37 месяцев.
const MAX_HISTORY_DAYS = 37 * 30;
const OWNER_STALE_MS = 2 * 24 * 3600_000;
// Dolphin: шесть пустых кусков подряд (12 недель) — история кончилась.
const DOLPHIN_EMPTY_CHUNKS = 6;

// Все кабинеты ключа — и выданные напрямую, и через Business Manager
// (Decision 062): у Артёма только прямые, и часть кабинетов терялась. Чужое,
// если ключ его видит, ловит закрепление — конфликт, а не тихий чужой расход.
// В любом статусе: у заблокированного кабинета расход был настоящий.
const SCOPE: AccountScope = { includeBusinesses: true, anyStatus: true };

export type IngestKind = "today" | "window";

export interface IngestResult {
  userId: string;
  kind: IngestKind;
  since: string;
  until: string;
  adRows: number;
  campaignRows: number;
  crmRows: number;
  adsetRows: number;
  failedAccounts: number;
  conflicts?: number;
  backfill?: string;
  skipped?: string;
  note?: string;
}

const db = () => warehouse();

const shift = (day: string, days: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export function windowFrom(latestDay: string, kind: IngestKind): { since: string; until: string } {
  if (kind === "today") return { since: latestDay, until: latestDay };
  return { since: shift(latestDay, -(WINDOW_DAYS - 1)), until: latestDay };
}

// Следующий кусок догрузки, идя назад от from. null — история кончилась.
export function nextChunk(from: string, floor: string, chunkDays: number): { since: string; until: string } | null {
  const until = shift(from, -1);
  if (until < floor) return null;
  const since = shift(from, -chunkDays);
  return { since: since < floor ? floor : since, until };
}

// ─── Кабинеты человека ──────────────────────────────────────────────────────

interface SeenAccount { name: string; created: string | null }

// Все кабинеты со всех ключей. Упавший ключ не роняет остальные — он отмечается
// в «Интеграциях» своей ошибкой.
async function accountsOf(tokens: { id: string; token: string }[]) {
  const seen = new Map<string, SeenAccount>();
  let failedKeys = 0;
  for (const k of tokens) {
    try {
      for (const a of await fetchActiveAccounts(k.token, SCOPE)) {
        const id = a.id.replace(/^act_/, "");
        if (!seen.has(id)) seen.set(id, { name: a.name, created: a.created_time?.slice(0, 10) ?? null });
      }
      await markMetaKey(k.id, null);
    } catch (e) {
      failedKeys++;
      await markMetaKey(k.id, e instanceof Error ? e.message : String(e));
    }
  }
  return { seen, failedKeys };
}

// Чьи из увиденных кабинетов — этого человека. Свободные и свои закрепляются за
// ним, занятые другим (чьи ключи видели кабинет недавно) — конфликт.
async function claimAccounts(userId: string, seen: Map<string, SeenAccount>) {
  const ids = [...seen.keys()];
  const allowed = new Set<string>();
  if (ids.length === 0) return { allowed, conflicts: 0 };

  const { data: rows, error } = await db().from("wh_account_owners")
    .select("account_id, owner_user_id, seen_at, conflict_user_id, assigned_at").in("account_id", ids);
  if (error) throw new Error(`wh_account_owners: ${error.message}`);
  const byId = new Map((rows ?? []).map((r) => [r.account_id as string, r]));

  const now = new Date().toISOString();
  const upserts: Record<string, unknown>[] = [];
  const newConflicts: { accountId: string; ownerId: string }[] = [];
  let conflicts = 0;

  for (const id of ids) {
    const r = byId.get(id);
    const owner = r?.owner_user_id as string | null | undefined;
    const fresh = r?.seen_at && Date.now() - new Date(r.seen_at as string).getTime() < OWNER_STALE_MS;
    if (!owner || owner === userId || !fresh) {
      allowed.add(id);
      // Все поля в каждой строке: в пакетном upsert пропущенное поле становится
      // значением по умолчанию, и дата закрепления сбрасывалась бы каждый прогон.
      upserts.push({
        account_id: id, account_name: seen.get(id)!.name, owner_user_id: userId, seen_at: now, conflict_user_id: null,
        assigned_by: null, assigned_at: owner === userId && r?.assigned_at ? r.assigned_at : now,
      });
    } else {
      conflicts++;
      if (r?.conflict_user_id !== userId) newConflicts.push({ accountId: id, ownerId: owner });
    }
  }
  for (let i = 0; i < upserts.length; i += 500) {
    const { error: e } = await db().from("wh_account_owners").upsert(upserts.slice(i, i + 500), { onConflict: "account_id" });
    if (e) throw new Error(`wh_account_owners: ${e.message}`);
  }
  if (newConflicts.length) await reportConflicts(userId, newConflicts, seen);
  return { allowed, conflicts };
}

// Один раз на конфликт — владельцу дашборда и тимлидам. Баерам незачем.
async function reportConflicts(userId: string, list: { accountId: string; ownerId: string }[], seen: Map<string, SeenAccount>) {
  const { data: people } = await db().from("profiles").select("id, name, email, role, status")
    .in("id", [userId, ...list.map((c) => c.ownerId)]);
  const nameOf = (id: string) => {
    const p = (people ?? []).find((x) => x.id === id);
    return escapeHtml((p?.name as string) || (p?.email as string) || id);
  };
  const lines = list.map((c) => `• CAB${c.accountId.slice(-4)} · ${escapeHtml(seen.get(c.accountId)?.name ?? c.accountId)} — у ${nameOf(c.ownerId)}`);
  const text = `<b>⚠️ Кабинет виден ключам двух человек</b>\nКлючи ${nameOf(userId)} видят чужие кабинеты:\n${lines.join("\n")}\n\nРасход по ним остаётся за прежним владельцем. Так быть не должно — проверь доступы в БМ.`;

  const { data: leads } = await db().from("profiles").select("id").in("role", ["main", "teamlead"]).eq("status", "active");
  for (const l of leads ?? []) {
    try { await notify(l.id as string, "cabinet_status", text); } catch { /* алерт не важнее загрузки */ }
  }
  for (const c of list) {
    await db().from("wh_account_owners").update({ conflict_user_id: userId }).eq("account_id", c.accountId);
  }
}

// ─── Расход ─────────────────────────────────────────────────────────────────

async function put(table: string, conflict: string, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db().from(table).upsert(rows.slice(i, i + 500), { onConflict: conflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function writeSpend(userId: string, tokens: { id: string; token: string }[], since: string, until: string, allowed: Set<string>) {
  const ads = new Map<string, Record<string, unknown>>();
  const campaigns = new Map<string, Record<string, unknown>>();
  const seenAdsets = new Set<string>();
  let failedAccounts = 0;
  const now = new Date().toISOString();

  // Два ключа одного человека могут видеть один кабинет — строки совпадут,
  // берём первую. В одной пачке upsert двух одинаковых ключей не примет.
  for (const k of tokens) {
    const [a, c] = await Promise.all([
      fetchAdDays(k.token, since, until, SCOPE, allowed),
      fetchCampaignDays(k.token, since, until, SCOPE, allowed),
    ]);
    failedAccounts += a.failedAccounts + c.failedAccounts;
    for (const r of a.items) {
      if (r.adsetId) seenAdsets.add(r.adsetId);
      const key = `${r.date}|${r.adId}`;
      if (!ads.has(key)) ads.set(key, {
        user_id: userId, source: "meta", date: r.date, ad_id: r.adId, ad_name: r.adName,
        adset_id: r.adsetId || null, adset_name: r.adsetName || null,
        campaign_id: r.campaignId || null, campaign_name: r.campaignName || null,
        account_id: r.accountId, account_name: r.accountName,
        spend: r.spend, clicks: r.clicks, impressions: r.impressions, updated_at: now,
      });
    }
    for (const r of c.items) {
      const key = `${r.date}|${r.campaignId}`;
      if (!campaigns.has(key)) campaigns.set(key, {
        user_id: userId, source: "meta", date: r.date, campaign_id: r.campaignId, campaign_name: r.campaignName || null,
        account_id: r.accountId, spend: r.spend, clicks: r.clicks, impressions: r.impressions, updated_at: now,
      });
    }
  }

  await put("wh_ad_days", "date,ad_id", [...ads.values()]);
  await put("wh_campaign_days", "date,campaign_id", [...campaigns.values()]);
  return { adRows: ads.size, campaignRows: campaigns.size, failedAccounts, seenAdsets };
}

async function upsertAdsets(items: { adsetId: string; adsetName: string; accountId: string; countries: string[] }[]) {
  const rows = items.map((a) => ({
    adset_id: a.adsetId, adset_name: a.adsetName || null, account_id: a.accountId || null,
    countries: a.countries, updated_at: new Date().toISOString(),
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db().from("wh_adsets").upsert(rows.slice(i, i + 500), { onConflict: "adset_id" });
    if (error) throw new Error(`wh_adsets: ${error.message}`);
  }
  return rows.length;
}

// Расход из Dolphin (Decision 063): те же строки склада, что и от Meta, — id
// настоящие. Кампании — сумма объявлений за день, отдельного запроса не нужно.
// Страны таргета Dolphin не отдаёт — адсету пишется страна из нейминга.
async function writeDolphinSpend(userId: string, token: string, since: string, until: string, allowed: Set<string>) {
  const now = new Date().toISOString();
  const rows = (await dolphinAdDays(token, since, until)).filter((r) => allowed.has(r.accountId));
  const ads = new Map<string, Record<string, unknown>>();
  const campaigns = new Map<string, Record<string, unknown> & { spend: number; clicks: number; impressions: number }>();
  const adsets = new Map<string, { adsetId: string; adsetName: string; accountId: string; countries: string[] }>();
  for (const r of rows) {
    ads.set(`${r.date}|${r.adId}`, {
      user_id: userId, source: "dolphin", date: r.date, ad_id: r.adId, ad_name: r.adName,
      adset_id: r.adsetId || null, adset_name: r.adsetName || null,
      campaign_id: r.campaignId || null, campaign_name: r.campaignName || null,
      account_id: r.accountId, account_name: r.accountName,
      spend: r.spend, clicks: r.clicks, impressions: r.impressions, updated_at: now,
    });
    if (r.campaignId) {
      const key = `${r.date}|${r.campaignId}`;
      const c = campaigns.get(key) ?? {
        user_id: userId, source: "dolphin", date: r.date, campaign_id: r.campaignId, campaign_name: r.campaignName || null,
        account_id: r.accountId, spend: 0, clicks: 0, impressions: 0, updated_at: now,
      };
      c.spend += r.spend; c.clicks += r.clicks; c.impressions += r.impressions;
      campaigns.set(key, c);
    }
    if (r.adsetId && r.countries.length) {
      adsets.set(r.adsetId, { adsetId: r.adsetId, adsetName: r.adsetName, accountId: r.accountId, countries: r.countries });
    }
  }
  await put("wh_ad_days", "date,ad_id", [...ads.values()]);
  await put("wh_campaign_days", "date,campaign_id", [...campaigns.values()]);
  const adsetRows = adsets.size ? await upsertAdsets([...adsets.values()]) : 0;
  return { adRows: ads.size, campaignRows: campaigns.size, adsetRows };
}

// Страны таргета: полный обход на окне, на частом прогоне — только новые адсеты
// (замер 04.09.2026: без этого у Андрея пропали все LATAM-адсеты, $305 расхода).
async function writeTargeting(kind: IngestKind, tokens: { token: string }[], seenAdsets: Set<string>) {
  if (kind === "window") {
    let n = 0;
    for (const k of tokens) n += await upsertAdsets((await fetchAdSetTargeting(k.token, SCOPE)).items);
    return n;
  }
  if (seenAdsets.size === 0 || tokens.length === 0) return 0;
  const ids = [...seenAdsets];
  const { data: known } = await db().from("wh_adsets").select("adset_id").in("adset_id", ids);
  const have = new Set((known ?? []).map((k) => k.adset_id as string));
  const missing = ids.filter((id) => !have.has(id));
  if (missing.length === 0) return 0;
  let n = 0;
  for (const k of tokens) n += await upsertAdsets(await fetchAdSetTargetingByIds(k.token, missing));
  return n;
}

// ─── Прогон ─────────────────────────────────────────────────────────────────

export async function ingestForUser(
  userId: string, kind: IngestKind, opts: { backfill?: boolean } = {}
): Promise<IngestResult> {
  const today = mskDay();
  const { since, until } = windowFrom(today, kind);
  const result: IngestResult = { userId, kind, since, until, adRows: 0, campaignRows: 0, crmRows: 0, adsetRows: 0, failedAccounts: 0 };

  const [conn, tokens] = await Promise.all([getConnection(userId), metaTokensOf(userId)]);
  const torro = conn?.torroToken && conn.torroBuyerId ? { token: conn.torroToken, buyerId: conn.torroBuyerId } : null;
  const dolphin = conn?.spendSource === "dolphin" ? conn.dolphinToken : null;
  if (tokens.length === 0 && !dolphin && !torro) return { ...result, skipped: "нет подключений" };

  const { data: progress } = await db().from("buyer_connections")
    .select("spend_backfilled_from, spend_backfill_done, spend_backfill_empty, torro_backfilled_from, torro_backfill_done")
    .eq("user_id", userId).maybeSingle();

  const runId = crypto.randomUUID();
  await db().from("wh_ingest_runs").insert({ id: runId, user_id: userId, kind, since, until });
  const notes: string[] = [];

  try {
    // ─── Расход: один источник (Decision 061) ──────────────────────────────
    let floor = shift(today, -MAX_HISTORY_DAYS);
    if (dolphin) {
      const seen = new Map((await dolphinCabinets(dolphin, today)).map((c) => [c.id, { name: c.name, created: null }]));
      const { allowed, conflicts } = await claimAccounts(userId, seen);
      if (conflicts) { result.conflicts = conflicts; notes.push(`чужих кабинетов: ${conflicts}`); }
      if (allowed.size) {
        const w = await writeDolphinSpend(userId, dolphin, since, until, allowed);
        Object.assign(result, w);
        if (opts.backfill && !progress?.spend_backfill_done) {
          const chunk = nextChunk(progress?.spend_backfilled_from ?? since, floor, META_CHUNK_DAYS);
          let empty = progress?.spend_backfill_empty ?? 0;
          if (chunk) {
            const b = await writeDolphinSpend(userId, dolphin, chunk.since, chunk.until, allowed);
            result.adRows += b.adRows;
            result.campaignRows += b.campaignRows;
            result.backfill = `Dolphin ${chunk.since}…${chunk.until}`;
            empty = b.adRows ? 0 : empty + 1;
          }
          // Даты создания у Dolphin нет: история кончилась, когда кусков подряд пусто.
          await db().from("buyer_connections").update({
            spend_backfilled_from: chunk?.since ?? progress?.spend_backfilled_from ?? since,
            spend_backfill_empty: empty,
            spend_backfill_done: !chunk || chunk.since <= floor || empty >= DOLPHIN_EMPTY_CHUNKS,
          }).eq("user_id", userId);
        }
      }
    } else if (tokens.length) {
      const { seen, failedKeys } = await accountsOf(tokens);
      if (failedKeys) notes.push(`не прочитались ключи Meta: ${failedKeys}`);
      const { allowed, conflicts } = await claimAccounts(userId, seen);
      if (conflicts) { result.conflicts = conflicts; notes.push(`чужих кабинетов: ${conflicts}`); }

      // Раньше создания самого старого кабинета истории нет — дальше не ходим.
      const created = [...allowed].map((id) => seen.get(id)?.created).filter((d): d is string => Boolean(d)).sort()[0];
      if (created && created > floor) floor = created;

      if (allowed.size) {
        const w = await writeSpend(userId, tokens, since, until, allowed);
        Object.assign(result, { adRows: w.adRows, campaignRows: w.campaignRows, failedAccounts: w.failedAccounts });
        result.adsetRows = await writeTargeting(kind, tokens, w.seenAdsets);

        if (opts.backfill && !progress?.spend_backfill_done) {
          const chunk = nextChunk(progress?.spend_backfilled_from ?? since, floor, META_CHUNK_DAYS);
          if (chunk) {
            const b = await writeSpend(userId, tokens, chunk.since, chunk.until, allowed);
            result.adRows += b.adRows;
            result.campaignRows += b.campaignRows;
            result.failedAccounts += b.failedAccounts;
            result.backfill = `Meta ${chunk.since}…${chunk.until}`;
          }
          // Кусок с упавшими кабинетами не засчитываем — повторим его в следующий раз.
          if (!chunk || result.failedAccounts === 0) {
            await db().from("buyer_connections").update({
              spend_backfilled_from: chunk?.since ?? progress?.spend_backfilled_from ?? since,
              spend_backfill_done: !chunk || chunk.since <= floor,
            }).eq("user_id", userId);
          }
        }
      }
    }

    // ─── Torro — после Meta: id кампаний и объявлений берутся из расхода ──
    if (torro) {
      const t = await ingestTorro(db(), userId, torro.token, torro.buyerId, since, until);
      result.crmRows = t.crmRows;
      if (t.unmatchedCampaigns || t.unmatchedAds) {
        notes.push(`Torro без id в Meta — кампаний ${t.unmatchedCampaigns}, объявлений ${t.unmatchedAds}`);
      }
      if (opts.backfill && !progress?.torro_backfill_done) {
        const chunk = nextChunk(progress?.torro_backfilled_from ?? since, floor, TORRO_CHUNK_DAYS);
        if (chunk) {
          const b = await ingestTorro(db(), userId, torro.token, torro.buyerId, chunk.since, chunk.until);
          result.crmRows += b.crmRows;
          result.backfill = [result.backfill, `Torro ${chunk.since}…${chunk.until}`].filter(Boolean).join(", ");
        }
        await db().from("buyer_connections").update({
          torro_backfilled_from: chunk?.since ?? progress?.torro_backfilled_from ?? since,
          torro_backfill_done: !chunk || chunk.since <= floor,
        }).eq("user_id", userId);
      }
    }

    if (result.failedAccounts) notes.push(`не прочиталось кабинетов: ${result.failedAccounts}`);
    if (notes.length) result.note = notes.join("; ");
    await db().from("wh_ingest_runs").update({
      finished_at: new Date().toISOString(),
      ad_rows: result.adRows, campaign_rows: result.campaignRows, crm_rows: result.crmRows,
      failed_accounts: result.failedAccounts, note: result.note ?? null,
    }).eq("id", runId);
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Прогон с ошибкой обязан остаться в журнале с текстом (Decision 018).
    await db().from("wh_ingest_runs").update({ finished_at: new Date().toISOString(), error: message }).eq("id", runId);
    throw e;
  }
}

// Все, у кого есть хоть одно подключение: ключ Meta, Dolphin или Torro.
export async function usersToIngest(): Promise<string[]> {
  const [{ data: keys, error: e1 }, { data: torro, error: e2 }] = await Promise.all([
    db().from("meta_keys").select("user_id"),
    db().from("buyer_connections").select("user_id").or("torro_token_enc.not.is.null,dolphin_token_enc.not.is.null"),
  ]);
  if (e1) throw new Error(e1.message);
  if (e2) throw new Error(e2.message);
  return [...new Set([...(keys ?? []), ...(torro ?? [])].map((r) => r.user_id as string))];
}
