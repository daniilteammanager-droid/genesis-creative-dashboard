-- ============================================================================
--  Последнее известное состояние рекламных кабинетов — для алертов в Telegram.
--  Выполнить после 017_telegram.sql. Скрипт идемпотентный.
-- ============================================================================
--
--  Алерт — это смена состояния: был ACTIVE, стал DISABLED. Чтобы заметить смену,
--  надо помнить, что было в прошлый прогон. Здесь и помним.
--
--  Первый прогон только заполняет таблицу и ничего не шлёт: иначе каждый уже
--  давно заблокированный кабинет пришёл бы алертом как новость.

create table if not exists public.wh_cabinet_states (
  -- id кабинета без act_, как в wh_ad_days и wh_account_owners.
  account_id     text primary key,
  name           text,
  -- ACTIVE, DISABLED, UNSETTLED, IN_GRACE_PERIOD, ... и MISSING — кабинет
  -- пропал из выдачи всех ключей сразу.
  status         text not null,
  disable_reason integer,
  currency       text,
  -- Сумма в валюте кабинета, не в центах. У предоплаченного — остаток,
  -- у постоплатного — сколько набежало к оплате.
  balance        numeric(14,2),
  prepay         boolean,
  seen_at        timestamptz not null default now(),
  changed_at     timestamptz not null default now()
);

alter table public.wh_cabinet_states enable row level security;
revoke all on public.wh_cabinet_states from anon, authenticated;
