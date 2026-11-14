-- AI-доступ к дашборду по MCP (Decision 116): баер подключает свой Claude или Codex,
-- входит аккаунтом дашборда (OAuth 2.1) и читает то же, что видит на страницах.
-- Пишут и читают таблицы только роуты сервера ключом service role; браузеру они закрыты.

-- Клиенты, зарегистрированные сами (DCR, RFC 7591). Клиент по CIMD сюда не пишется:
-- его client_id — https-адрес документа, его читаем при входе.
create table if not exists public.mcp_oauth_clients (
  client_id     text primary key,
  client_name   text,
  redirect_uris text[] not null,
  created_at    timestamptz not null default now()
);

-- Одноразовые коды авторизации: живут 5 минут, хранится только хэш.
create table if not exists public.mcp_oauth_codes (
  code_hash      text primary key,
  client_id      text not null,
  client_name    text,
  user_id        uuid not null references public.profiles(id) on delete restrict,
  redirect_uri   text not null,
  code_challenge text not null,
  scope          text not null,
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now()
);

-- Подключение = строка: OAuth-клиент (access + refresh, refresh вращается) или личный ключ
-- для терминала (client_id 'personal', без срока, пока не отозван). Токены — только хэши.
create table if not exists public.mcp_tokens (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete restrict,
  client_id          text not null,
  client_name        text,
  scope              text not null,
  access_hash        text unique,
  access_expires_at  timestamptz,
  refresh_hash       text unique,
  refresh_expires_at timestamptz,
  created_at         timestamptz not null default now(),
  last_used_at       timestamptz,
  revoked_at         timestamptz
);
create index if not exists mcp_tokens_user on public.mcp_tokens (user_id, created_at desc);

-- Журнал вызовов: кто, каким инструментом, сколько длилось — видеть нагрузку и разбирать споры.
create table if not exists public.mcp_calls (
  id         bigserial primary key,
  user_id    uuid not null references public.profiles(id) on delete restrict,
  token_id   uuid references public.mcp_tokens(id) on delete set null,
  tool       text not null,
  args       jsonb,
  ok         boolean not null,
  error      text,
  ms         integer,
  created_at timestamptz not null default now()
);
create index if not exists mcp_calls_user on public.mcp_calls (user_id, created_at desc);

alter table public.mcp_oauth_clients enable row level security;
alter table public.mcp_oauth_codes   enable row level security;
alter table public.mcp_tokens        enable row level security;
alter table public.mcp_calls         enable row level security;
revoke all on public.mcp_oauth_clients, public.mcp_oauth_codes, public.mcp_tokens, public.mcp_calls from anon, authenticated;
