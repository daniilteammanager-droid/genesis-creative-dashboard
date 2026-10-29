-- Алерт «крео прошло границу теста без депов» (Decision 100). Какие крео уже объявлены —
-- алерт уходит один раз на крео в стране. Только сервер (service role), RLS без политик.
-- Скрипт идемпотентный.
create table if not exists public.wh_test_alerts (
  user_id     uuid not null references public.profiles(id) on delete restrict,
  geo         text not null,
  creo        text not null,
  spend       numeric not null,          -- спенд за 30 дней на момент алерта, $
  alerted_at  timestamptz not null default now(),
  primary key (user_id, geo, creo)
);
alter table public.wh_test_alerts enable row level security;
revoke all on public.wh_test_alerts from anon, authenticated;

-- Новое уведомление включается всем привязкам: выключить лишнее проще, чем догадаться
-- включить (новые привязки получают всё и так — DEFAULT_EVENTS).
update public.telegram_links l
   set events = array_append(l.events, 'test_limit')
 where not ('test_limit' = any(l.events));
