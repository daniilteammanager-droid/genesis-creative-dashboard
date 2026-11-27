-- Пополнения (27.11.2026, Decision 131): настройки раздела, шаблоны частых заявок и кошелёк заявки.
-- Категории, «куда» и закреплённые кошельки правит владелец на вкладке «Настройки»; пока строки нет — в коде
-- список по умолчанию (DEFAULT в lib/topups/config.ts). Шаблоны — личные, у каждого свои. Скрипт идемпотентный.

-- Одна строка: категории → «куда» → кошельки, JSON (lib/topups/config.ts, тип Category).
create table if not exists public.topup_settings (
  id int primary key default 1 check (id = 1),
  categories jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Шаблоны: что подставить в форму. amount пусто — сумму вводят каждый раз; wallet — подпись закреплённого
-- кошелька (тогда asset, network, address берутся из настроек), иначе — свой адрес.
create table if not exists public.topup_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null,
  target text not null,
  wallet text,
  asset text,
  network text,
  address text,
  amount numeric,
  fee numeric not null default 0,
  minutes int,
  comment text,
  created_at timestamptz not null default now()
);
create index if not exists topup_templates_user on public.topup_templates (user_id, created_at);

-- Кошелёк заявки: wallet — подпись кошелька из настроек; manual_address — у «куда» есть кошельки, а адрес вбили руками.
-- У заявок до 27.11.2026 оба пустые.
alter table public.topup_requests add column if not exists wallet text;
alter table public.topup_requests add column if not exists manual_address boolean not null default false;

-- Как и заявки — закрыто от браузера, всё через роуты сервисным ключом.
alter table public.topup_settings  enable row level security;
alter table public.topup_templates enable row level security;
revoke all on public.topup_settings  from anon, authenticated;
revoke all on public.topup_templates from anon, authenticated;
