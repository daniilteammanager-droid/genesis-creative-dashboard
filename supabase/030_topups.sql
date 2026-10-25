-- Заявки на пополнение: кабинеты, платёжки, агенты (Decision 072).
--
-- Заявку создаёт любой в дашборде, она уходит отдельным ботом (Top-Up) в
-- платёжный чат владельцев. Там жмут «Оплачено», бот находит перевод по адресу
-- получателя в блокчейне и пишет хэш сюда; автору приходит ответ общим ботом.
-- Скрипт идемпотентный.

create table if not exists public.topup_requests (
  id            uuid primary key default gen_random_uuid(),
  number        bigserial unique,               -- «#12» в чате и в дашборде
  user_id       uuid not null references public.profiles(id) on delete cascade,
  kind          text not null,                  -- что пополняем: карты, агенты, расходники…
  amount        numeric(14, 2) not null check (amount > 0),
  fee           numeric(14, 2) not null default 0 check (fee >= 0),
  asset         text not null check (asset in ('USDT', 'GRAM')),
  network       text not null check (network in ('TRC20', 'TON', 'BEP20', 'ERC20')),
  address       text not null,
  comment       text,
  expires_at    timestamptz,                    -- null — без срока
  status        text not null default 'pending' check (status in ('pending', 'paid', 'rejected', 'expired')),
  -- Нажали «Оплачено», перевод ещё не найден — бот ищет каждую минуту.
  searching_since timestamptz,
  tx_hash       text unique,
  paid_amount   numeric(18, 6),
  paid_at       timestamptz,
  closed_by     text,                           -- кто в Telegram закрыл заявку
  -- Сообщения заявки в платёжном чате: [{chat_id, message_id}] — их бот правит.
  messages      jsonb not null default '[]',
  created_at    timestamptz not null default now()
);

create index if not exists topup_requests_by_user on public.topup_requests (user_id, created_at desc);
create index if not exists topup_requests_open on public.topup_requests (status) where status = 'pending';

-- Платёжный чат — один. Привязывает владелец ссылкой из дашборда.
create table if not exists public.topup_chat (
  id          int primary key default 1 check (id = 1),
  chat_id     bigint not null,
  thread_id   bigint,
  title       text,
  bound_by    uuid references public.profiles(id) on delete set null,
  bound_at    timestamptz not null default now()
);

alter table public.topup_requests enable row level security;
alter table public.topup_chat     enable row level security;
revoke all on public.topup_requests from anon, authenticated;
revoke all on public.topup_chat     from anon, authenticated;
