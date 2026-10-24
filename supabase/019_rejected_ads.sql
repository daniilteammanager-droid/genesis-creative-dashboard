-- ============================================================================
--  Антиотклон: уже известные отклонённые объявления. Выполнить после
--  018_cabinet_states.sql. Скрипт идемпотентный.
-- ============================================================================
--
--  Алерт приходит один раз — когда объявление впервые замечено отклонённым.
--  Строка живёт, пока объявление отклонено. Одобрили — строка удаляется, и
--  повторное отклонение снова придёт алертом.
--
--  Первый прогон только заполняет таблицу: старые отклонения не новость.

create table if not exists public.wh_rejected_ads (
  ad_id          text primary key,
  account_id     text not null,
  ad_name        text,
  campaign_name  text,
  adset_name     text,
  status         text not null,       -- DISAPPROVED или WITH_ISSUES
  reason         text,
  first_seen_at  timestamptz not null default now()
);

create index if not exists wh_rejected_ads_by_account on public.wh_rejected_ads (account_id);

alter table public.wh_rejected_ads enable row level security;
revoke all on public.wh_rejected_ads from anon, authenticated;
