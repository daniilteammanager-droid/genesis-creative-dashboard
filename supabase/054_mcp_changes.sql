-- AI-доступ, этап 2 (Decision 117): Claude или Codex баера ставит на паузу, запускает и меняет
-- дневной бюджет. Каждое изменение — строка: кто, каким подключением, что было и что стало.
-- По ней же считается лимит изменений в час. Браузеру закрыта, как и остальные mcp_*.

create table if not exists public.mcp_changes (
  id         bigserial primary key,
  user_id    uuid not null references public.profiles(id) on delete restrict,
  token_id   uuid references public.mcp_tokens(id) on delete set null,
  entity_id  text not null,
  level      text not null,
  account_id text,
  name       text,
  action     text not null,          -- pause | activate | budget
  before     jsonb,                   -- {status, budget} до изменения, как прочитали из кабинета
  after      jsonb,                   -- {status} или {budget}, которое просили
  ok         boolean not null,
  error      text,
  created_at timestamptz not null default now()
);
create index if not exists mcp_changes_user on public.mcp_changes (user_id, created_at desc);

alter table public.mcp_changes enable row level security;
revoke all on public.mcp_changes from anon, authenticated;

-- Уведомление «Изменения через AI» включено во всех уже привязанных чатах: новые привязки
-- получают все события сами (DEFAULT_EVENTS), а о том, что AI поменял кампанию, человек
-- должен узнать без захода в настройки.
update public.telegram_links set events = array_append(events, 'ai_changes')
where not ('ai_changes' = any(events));
