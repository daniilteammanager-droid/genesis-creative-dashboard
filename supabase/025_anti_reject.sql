-- Кнопки антиотклона в боте (Decision 067).
--
-- Изменение объявления — в два шага: выбрал → «подтвердить». Между шагами
-- готовое изменение лежит здесь под одноразовым кодом: в callback_data Telegram
-- влезает только 64 байта, ссылка лендинга туда не помещается. Живёт час.
create table if not exists public.anti_reject_pending (
  nonce       text primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  ad_id       text not null,
  preview     jsonb not null,
  created_at  timestamptz not null default now()
);

alter table public.anti_reject_pending enable row level security;
revoke all on public.anti_reject_pending from anon, authenticated;
