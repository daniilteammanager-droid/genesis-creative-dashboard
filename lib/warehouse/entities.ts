import { warehouse } from "./read";
import { fetchEdgePaged } from "@/lib/reports-live/metaApi";
import { fromMinor } from "@/lib/alerts/cabinets";
import { usdRate } from "@/lib/fx";
import { mskDay } from "@/lib/day";
import { listAds, tgId, tonUsd } from "@/lib/tgads/api";
import { fbtoolEntities } from "@/lib/fbtool/api";

// Последнее известное состояние кампаний, адсетов и объявлений (Decision 089): статус и
// бюджет. Склад расхода хранит деньги по дням, а это — «как оно стояло». Пропал кабинет —
// его строки не трогаются и остаются последним, что мы о нём знали. Объект перестал
// приходить из живого кабинета (удалили) — missing = true, строка тоже остаётся.

export interface EntityState {
  id: string; level: "campaign" | "adset" | "ad"; accountId: string;
  campaignId: string | null; adsetId: string | null; name: string | null;
  status: string | null; effective: string | null;
  daily: number | null; lifetime: number | null;   // в долларах
}

const db = () => warehouse();

// Записать увиденное; у прочитанных кабинетов всё, что в этот раз не пришло, — missing.
export async function saveEntities(source: "meta" | "fbtool" | "tgads", accounts: string[], items: EntityState[]): Promise<number> {
  const now = new Date().toISOString();
  const rows = [...new Map(items.map((e) => [e.id, e])).values()].map((e) => ({
    entity_id: e.id, level: e.level, account_id: e.accountId, campaign_id: e.campaignId, adset_id: e.adsetId, name: e.name,
    status: e.status, effective_status: e.effective, daily_budget: e.daily, lifetime_budget: e.lifetime,
    source, missing: false, seen_at: now, updated_at: now,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db().from("wh_entities").upsert(rows.slice(i, i + 500), { onConflict: "entity_id" });
    if (error) throw new Error(`wh_entities: ${error.message}`);
  }
  if (accounts.length) {
    await db().from("wh_entities").update({ missing: true, updated_at: now })
      .eq("source", source).in("account_id", accounts).lt("seen_at", now).eq("missing", false);
  }
  return rows.length;
}

type MetaObj = { id: string; name?: string; status?: string; effective_status?: string; campaign_id?: string; adset_id?: string; daily_budget?: string; lifetime_budget?: string };

// Meta: три выборки на кабинет. Бюджеты — в минимальных единицах валюты кабинета.
export async function metaEntities(token: string, accountId: string, currency: string | null): Promise<EntityState[]> {
  const act = `act_${accountId}`, cur = currency || "USD";
  const rate = await usdRate(cur, mskDay());
  const usd = (v?: string) => { const x = fromMinor(v, cur); return x === null ? null : Math.round(x * rate * 100) / 100; };
  const [campaigns, adsets, ads] = await Promise.all([
    fetchEdgePaged<MetaObj>(token, act, "campaigns", "id,name,status,effective_status,daily_budget,lifetime_budget", 500),
    fetchEdgePaged<MetaObj>(token, act, "adsets", "id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget", 500),
    fetchEdgePaged<MetaObj>(token, act, "ads", "id,name,status,effective_status,campaign_id,adset_id", 500),
  ]);
  const one = (level: EntityState["level"], o: MetaObj): EntityState => ({
    id: o.id, level, accountId, campaignId: level === "campaign" ? o.id : o.campaign_id ?? null,
    adsetId: level === "ad" ? o.adset_id ?? null : level === "adset" ? o.id : null,
    name: o.name ?? null, status: o.status ?? null, effective: o.effective_status ?? null,
    daily: usd(o.daily_budget), lifetime: usd(o.lifetime_budget),
  });
  return [...campaigns.map((o) => one("campaign", o)), ...adsets.map((o) => one("adset", o)), ...ads.map((o) => one("ad", o))];
}

// TG Ads: объявление — оно же кампания (Decision 068), id как в складе расхода.
export async function tgadsEntities(key: { token: string; accountId: string }): Promise<EntityState[]> {
  const rate = await tonUsd(mskDay());
  return (await listAds(key.token)).map((a) => {
    const id = tgId(key.accountId, a.ad_id);
    return {
      id, level: "ad", accountId: key.accountId, campaignId: id, adsetId: id, name: a.title,
      status: a.is_paused ? "PAUSED" : a.status, effective: a.status,
      daily: a.daily_budget_limit ? Math.round(a.daily_budget_limit * rate * 100) / 100 : null, lifetime: null,
    };
  });
}

// Прогон состояний одного человека: свои кабинеты, живые — у Meta (неживые не меняются,
// их строки и есть последнее, что мы знаем). Упавший кабинет не трогаем — ни новых
// строк, ни missing. Возвращает число записанных объектов.
export async function syncEntities(userId: string, src: {
  metaTokens: string[]; fbtool: { key: string; accounts: string[] } | null; tgads: { token: string; accountId: string }[];
}): Promise<{ saved: number; failed: number }> {
  const { data: own } = await db().from("wh_account_owners").select("account_id").eq("owner_user_id", userId);
  const owned = new Set((own ?? []).map((o) => o.account_id as string));
  if (!owned.size) return { saved: 0, failed: 0 };
  const { data: st } = await db().from("wh_cabinet_states").select("account_id, status, currency").in("account_id", [...owned]);
  const state = new Map((st ?? []).map((s) => [s.account_id as string, s]));
  let saved = 0, failed = 0;

  if (src.metaTokens.length) {
    const tg = new Set(src.tgads.map((k) => k.accountId));
    const live = [...owned].filter((id) => !tg.has(id) && (state.get(id)?.status ?? "ACTIVE") === "ACTIVE");
    for (const id of live) {
      let items: EntityState[] | null = null;
      for (const token of src.metaTokens) {
        items = await metaEntities(token, id, (state.get(id)?.currency as string) ?? null).catch(() => null);
        if (items) break;
      }
      if (items) saved += await saveEntities("meta", [id], items); else failed++;
    }
  }
  if (src.fbtool) {
    for (const acc of src.fbtool.accounts) {
      try {
        const r = await fbtoolEntities(src.fbtool.key, acc, mskDay());
        const mine = r.accounts.filter((a) => owned.has(a));
        saved += await saveEntities("fbtool", mine, r.items.filter((e) => owned.has(e.accountId)));
      } catch { failed++; }
    }
  }
  for (const k of src.tgads.filter((k) => owned.has(k.accountId))) {
    try { saved += await saveEntities("tgads", [k.accountId], await tgadsEntities(k)); } catch { failed++; }
  }
  return { saved, failed };
}
