-- История чеков (Decision 082): что и когда ушло в Telegram — кнопкой из Checks
-- и по расписанию. Как «История чеков» у Артёма. Скрипт идемпотентный.
create table if not exists public.check_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null check (kind in ('manual', 'schedule')),
  text        text not null,           -- HTML, как ушло в Telegram
  sent        int not null default 0,  -- в сколько чатов
  created_at  timestamptz not null default now()
);
create index if not exists check_log_by_user on public.check_log (user_id, created_at desc);
alter table public.check_log enable row level security;
revoke all on public.check_log from anon, authenticated;
