-- Избранные крео в «Отчётах» (29.10.2026). Личные: у каждого свой список. Отметка — на крео
-- баера (одно и то же крео у двух баеров — две разные отметки), во всех странах сразу.
-- Только сервер (service role), RLS без политик. Скрипт идемпотентный.
create table if not exists public.traffic_favorites (
  user_id     uuid not null references public.profiles(id) on delete cascade,   -- чья отметка
  buyer_id    uuid not null references public.profiles(id) on delete restrict,  -- чьё крео
  creo        text not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, buyer_id, creo)
);
alter table public.traffic_favorites enable row level security;
revoke all on public.traffic_favorites from anon, authenticated;
