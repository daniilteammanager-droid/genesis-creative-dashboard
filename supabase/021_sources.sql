-- ============================================================================
--  Источники расхода с чистого листа (Decision 061). Выполнить после
--  020_autocheck.sql. Скрипт идемпотентный, но ЧИСТИТ склад — см. ниже.
-- ============================================================================
--
--  Что меняется.
--
--  1. Ключей Meta у человека может быть несколько (у Артёма шесть приложений,
--     каждое на свою пачку БМ). Отдельная таблица вместо одного поля.
--
--  2. Склад расхода — одна строка на «день + объявление», без «чей ключ».
--     FB Tool и Dolphin — надстройки над той же Meta с теми же id, поэтому
--     смена источника перезаписывает те же строки, а дублей не бывает вовсе.
--     user_id остаётся — это владелец кабинета на момент записи, source — откуда.
--
--  3. Кабинет принадлежит тому, чей ключ его видит. Ручной раздачи больше нет:
--     wh_account_owners заполняет загрузка. seen_at — когда ключи владельца
--     видели кабинет в последний раз; не видели два дня — кабинет свободен.
--
--  4. Torro только по API. Колонки выгрузок остаются в таблице (ничего не
--     ломают), но код их больше не читает, и значения обнуляются.
--
--  5. Склад чистится целиком: в нём тройные копии расхода всей команды из
--     ключей, снятых с аккаунта владельца. Историю заново догрузят интеграции.
--     Не трогаются: wh_cabinet_states, wh_rejected_ads, wh_adsets, Telegram,
--     профили, заметки, файлы.

-- ─── Ключи Meta ─────────────────────────────────────────────────────────────
create table if not exists public.meta_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  name         text not null,
  token_enc    text not null,
  token_hint   text,
  app_id       text,
  -- Права токена из debug_token: без ads_management не работают кнопки
  -- антиотклона и Live Manager.
  scopes       text[] not null default '{}',
  expires_at   timestamptz,
  last_error   text,
  last_ok_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists meta_keys_by_user on public.meta_keys (user_id);
alter table public.meta_keys enable row level security;
revoke all on public.meta_keys from anon, authenticated;

-- Один и тот же токен дважды — у одного человека или у двух — это одна и та же
-- выборка. Ловим по хвосту и приложению на сервере, здесь не уникальность.

-- ─── Источник расхода у человека: ровно один ────────────────────────────────
alter table public.buyer_connections
  add column if not exists spend_source text
    check (spend_source in ('meta', 'fbtool', 'dolphin')),
  -- Докуда догружена история. null — догрузка ещё не начиналась.
  add column if not exists spend_backfilled_from date,
  add column if not exists spend_backfill_done   boolean not null default false,
  add column if not exists torro_backfilled_from date,
  add column if not exists torro_backfill_done   boolean not null default false;

-- Старый одиночный ключ больше не читается. Если он ещё есть — переносим в
-- новую таблицу, чтобы никто не остался без подключения.
insert into public.meta_keys (user_id, name, token_enc, token_hint)
select user_id, 'Основной ключ', meta_token_enc, meta_token_hint
from public.buyer_connections b
where meta_token_enc is not null
  and not exists (select 1 from public.meta_keys k where k.user_id = b.user_id);
update public.buyer_connections set spend_source = 'meta'
where spend_source is null and exists (select 1 from public.meta_keys k where k.user_id = buyer_connections.user_id);
update public.buyer_connections set meta_token_enc = null, meta_token_hint = null, meta_token_set_at = null;

-- Выгрузки Torro в таблицы — больше не путь в склад.
update public.buyer_connections
set crm_campaigns_sheet_id = null, crm_ads_sheet_id = null, crm_ads_by_id_sheet_id = null;

-- ─── Владение кабинетом ─────────────────────────────────────────────────────
alter table public.wh_account_owners
  add column if not exists seen_at timestamptz;

-- ─── Чистка склада ──────────────────────────────────────────────────────────
delete from public.wh_ad_days;
delete from public.wh_campaign_days;
delete from public.wh_crm_ad_periods;
delete from public.wh_crm_ad_id_periods;
delete from public.wh_crm_campaign_periods;
delete from public.wh_account_owners;
delete from public.wh_ingest_runs;

-- ─── Ключ склада: день + объявление ─────────────────────────────────────────
alter table public.wh_ad_days drop constraint if exists wh_ad_days_pkey;
alter table public.wh_ad_days add primary key (date, ad_id);
alter table public.wh_ad_days add column if not exists source text not null default 'meta';

alter table public.wh_campaign_days drop constraint if exists wh_campaign_days_pkey;
alter table public.wh_campaign_days add primary key (date, campaign_id);
alter table public.wh_campaign_days add column if not exists source text not null default 'meta';

-- Чтение режется по кабинету, а не по тому, кто записал.
create index if not exists wh_ad_days_by_account_date on public.wh_ad_days (account_id, date);
