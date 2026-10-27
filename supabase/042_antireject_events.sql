-- История антиотклона (Decision 091): новые отклонения и действия — из бота и со страницы.
-- Как «История антиотклона» у Артёма. Только сервер. Идемпотентный.
create table if not exists public.antireject_events (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  kind          text not null check (kind in ('rejected', 'action')),
  ad_id         text not null,
  account_id    text,
  ad_name       text,
  campaign_name text,
  owner_user_id uuid references public.profiles(id) on delete set null,   -- чей кабинет
  actor         text,      -- кто нажал: имя в дашборде или «Telegram»
  text          text,      -- причина отклонения или что поменяли
  ok            boolean,   -- для действий: приняла ли Meta
  status        text       -- статус Meta после действия
);
create index if not exists antireject_events_owner on public.antireject_events (owner_user_id, created_at desc);
alter table public.antireject_events enable row level security;
revoke all on public.antireject_events from anon, authenticated;
