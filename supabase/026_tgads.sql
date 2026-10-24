-- Telegram Ads источником расхода (Decision 068).
--
-- Как с ключами Meta: кабинетов TG Ads у баера несколько, у каждого свой ключ
-- API, все работают одновременно. Строка = название, которое дал баер, + ключ.
create table if not exists public.tgads_keys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  name          text not null,
  token_enc     text not null,
  token_hint    text,
  -- Что за кабинет — из getCurrentAccount при подключении.
  account_id    text not null,
  account_title text,
  currency      text not null,               -- TON, EUR или XTR
  last_error    text,
  last_ok_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists tgads_keys_by_user on public.tgads_keys (user_id);
-- Один кабинет — один ключ на весь дашборд, иначе расход сложится дважды.
create unique index if not exists tgads_keys_account on public.tgads_keys (account_id);
alter table public.tgads_keys enable row level security;
revoke all on public.tgads_keys from anon, authenticated;

alter table public.buyer_connections drop constraint if exists buyer_connections_spend_source_check;
alter table public.buyer_connections add constraint buyer_connections_spend_source_check
  check (spend_source in ('meta', 'fbtool', 'dolphin', 'tgads'));
