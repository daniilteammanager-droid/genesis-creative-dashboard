-- Склад хранит больше и ничего не забывает (Decision 089). Скрипт идемпотентный.

-- 1. Дневные строки: клики по ссылке отдельно от всех кликов, охват за день и
-- результаты (у нас — подписки на сайте, «results» Meta). Пусто — источник не отдал.
-- Охват дня не складывается в охват периода: один человек за неделю не семь человек.
alter table public.wh_ad_days       add column if not exists link_clicks integer, add column if not exists reach integer, add column if not exists results integer;
alter table public.wh_campaign_days add column if not exists link_clicks integer, add column if not exists reach integer, add column if not exists results integer;

-- 2. Кабинет: последний настоящий статус (status пишет MISSING, когда кабинет пропал, —
-- а каким он был до пропажи, теперь не теряется) и часовой пояс.
alter table public.wh_cabinet_states add column if not exists last_status text, add column if not exists timezone text;
update public.wh_cabinet_states set last_status = status where last_status is null and status <> 'MISSING';

-- 3. Последнее известное состояние кампаний, адсетов и объявлений: статус, бюджет.
-- Пропал кабинет — строки остаются как были; missing = объект больше не пришёл из живого кабинета.
create table if not exists public.wh_entities (
  entity_id        text primary key,
  level            text not null check (level in ('campaign', 'adset', 'ad')),
  account_id       text,
  campaign_id      text,
  adset_id         text,
  name             text,
  status           text,            -- как поставили (ACTIVE / PAUSED / …)
  effective_status text,            -- что на деле (с учётом родителя и проверки)
  daily_budget     numeric,         -- в долларах
  lifetime_budget  numeric,
  source           text not null,   -- meta | fbtool | tgads
  missing          boolean not null default false,
  seen_at          timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists wh_entities_account on public.wh_entities (account_id);
alter table public.wh_entities enable row level security;
revoke all on public.wh_entities from anon, authenticated;
