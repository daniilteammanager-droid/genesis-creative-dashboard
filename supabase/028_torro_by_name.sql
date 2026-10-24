-- Torro без опоры на кабинеты (Decision 070).
--
-- Torro не отдаёт id — только имена кампаний и объявлений. Раньше кампания Torro
-- писалась, лишь когда её имя нашлось в расходе: кампании из неподключённых
-- кабинетов терялись (у Артёма 24.10.2026 — все депозиты недели, $13 950).
-- Теперь кампания пишется по имени всегда; id — если нашёлся, для справки.

-- ─── Кампании: ключ — имя ──────────────────────────────────────────────────
alter table public.wh_crm_campaign_periods drop constraint if exists wh_crm_campaign_periods_pkey;
alter table public.wh_crm_campaign_periods alter column campaign_id drop not null;
update public.wh_crm_campaign_periods set campaign_name = campaign_id where campaign_name is null;
alter table public.wh_crm_campaign_periods alter column campaign_name set not null;
alter table public.wh_crm_campaign_periods add primary key (user_id, period_start, campaign_name);

-- ─── Квалификация A–E (сегменты CRM), как в General 4.0 ────────────────────
alter table public.wh_crm_campaign_periods
  add column if not exists qual_a integer, add column if not exists qual_b integer, add column if not exists qual_c integer,
  add column if not exists qual_d integer, add column if not exists qual_e integer;
alter table public.wh_crm_ad_periods
  add column if not exists qual_a integer, add column if not exists qual_b integer, add column if not exists qual_c integer,
  add column if not exists qual_d integer, add column if not exists qual_e integer;

-- ─── Связки «кампания × объявление» за день ────────────────────────────────
-- Torro группирует по одному признаку за раз, поэтому связка — это разбивка
-- каждого объявления по кампаниям отдельным запросом (~1 с). Прошлые дни Torro
-- не переписывает: день раскладывается один раз, сегодняшний — раз в час.
-- Адсета Torro не знает: он берётся из Meta по объявлению внутри кампании.
create table if not exists public.wh_crm_pairs (
  user_id       uuid not null references public.profiles(id) on delete restrict,
  period_start  date not null,
  campaign_name text not null,
  ad_name       text not null,
  clicks        integer,
  subscribers   integer,
  dialogs       integer,
  registrations integer,
  dep_count     integer,
  dep_sum       numeric(14,2),
  redep_count   integer,
  redep_sum     numeric(14,2),
  qual_a integer, qual_b integer, qual_c integer, qual_d integer, qual_e integer,
  updated_at    timestamptz not null default now(),
  primary key (user_id, period_start, campaign_name, ad_name)
);
alter table public.wh_crm_pairs enable row level security;
revoke all on public.wh_crm_pairs from anon, authenticated;

-- Прогресс связок у баера: до какого дня разложена история, и докуда дошла
-- раскладка текущего дня (по объявлениям, чтобы продолжать с места).
alter table public.buyer_connections
  add column if not exists pairs_backfilled_from date,
  add column if not exists pairs_backfill_done   boolean not null default false,
  add column if not exists pairs_cursor          jsonb;

-- Старый ключ (user_id, period_start, campaign_id) — уникальным индексом: код,
-- который пишет по нему, продолжает работать (NULL-ы в индексе не сталкиваются).
create unique index if not exists wh_crm_campaign_periods_by_id
  on public.wh_crm_campaign_periods (user_id, period_start, campaign_id);
