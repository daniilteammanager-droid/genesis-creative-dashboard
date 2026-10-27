-- Отдельное приложение Meta для автозалива (Decision 093): статистика и алерты ходят ключами
-- из «Интеграций», а автозалив — своим приложением, чтобы залив не делил лимит со складом.
-- Как профили Meta API у Артёма: ключ + необязательный App Secret (appsecret_proof). Один на человека.
-- Только сервер. Идемпотентный.
create table if not exists public.autoupload_keys (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  name        text not null,
  token_enc   text not null,
  token_hint  text,
  secret_enc  text,                 -- App Secret, если в приложении включено «требовать секрет»
  app_id      text,
  app_name    text,
  scopes      text[] not null default '{}',
  expires_at  timestamptz,
  last_error  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.autoupload_keys enable row level security;
revoke all on public.autoupload_keys from anon, authenticated;
