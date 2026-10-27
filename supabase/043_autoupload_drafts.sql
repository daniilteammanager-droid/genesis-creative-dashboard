-- Сохранённые сборки автозалива (Decision 092) — как «Сохранённые сборки» у Артёма: форма целиком
-- под своим названием, открыть на любом устройстве. Только сервер. Идемпотентный.
create table if not exists public.autoupload_drafts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  name       text not null,
  form       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);
alter table public.autoupload_drafts enable row level security;
revoke all on public.autoupload_drafts from anon, authenticated;
