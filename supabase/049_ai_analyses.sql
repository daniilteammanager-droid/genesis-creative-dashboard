-- ============================================================================
--  AI-разборы крео (Decision 101). Выполнить после 048_traffic_favorites.sql. Идемпотентный.
-- ============================================================================
--
--  1. ai_creo_analyses — разбор крео баера моделью Claude: вердикт, текст, токены и цена.
--     Он же очередь: автоматические разборы (алерт «за границей теста», первые депы)
--     встают в queued, крон kind=ai их делает и шлёт баеру в Telegram.
--     charged — идёт в месячный лимит баера (его кнопка и автоматические); разбор,
--     который запросил владелец или тимлид, — из общего бюджета.
--  2. ai_budgets — месячный лимит баера в долларах. Нет строки — лимит по умолчанию из кода.
--  3. ai_summaries — недельная сводка по баерам и команде для владельца и тимлида.
--
--  Только сервер (ключ сервиса): RLS включён, у anon и authenticated прав нет.

create table if not exists public.ai_creo_analyses (
  id            uuid primary key default gen_random_uuid(),
  buyer_id      uuid not null references public.profiles(id) on delete restrict,
  creo          text not null,
  trigger       text not null check (trigger in ('manual', 'test_limit', 'first_deps')),
  requested_by  uuid references public.profiles(id) on delete set null,
  charged       boolean not null default true,
  status        text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  verdict       text,
  text          text,
  data_hash     text,
  model         text,
  input_tokens  integer,
  output_tokens integer,
  cost_usd      numeric(10, 5) not null default 0,
  error         text,
  created_at    timestamptz not null default now(),
  done_at       timestamptz
);
create index if not exists ai_creo_analyses_creo on public.ai_creo_analyses (buyer_id, creo, created_at desc);
create index if not exists ai_creo_analyses_queue on public.ai_creo_analyses (created_at) where status in ('queued', 'running');

create table if not exists public.ai_budgets (
  buyer_id    uuid primary key references public.profiles(id) on delete cascade,
  monthly_usd numeric(8, 2) not null check (monthly_usd >= 0),
  updated_at  timestamptz not null default now()
);

create table if not exists public.ai_summaries (
  id            uuid primary key default gen_random_uuid(),
  week          date not null unique,          -- понедельник недели, за которую сводка
  text          text not null,
  model         text not null,
  input_tokens  integer,
  output_tokens integer,
  cost_usd      numeric(10, 5) not null default 0,
  created_at    timestamptz not null default now()
);

alter table public.ai_creo_analyses enable row level security;
alter table public.ai_budgets       enable row level security;
alter table public.ai_summaries     enable row level security;
revoke all on public.ai_creo_analyses from anon, authenticated;
revoke all on public.ai_budgets       from anon, authenticated;
revoke all on public.ai_summaries     from anon, authenticated;

-- Новые уведомления — во все привязки, как test_limit в 046: выключить проще, чем
-- догадаться включить. Недельная сводка — только владельцу и тимлиду.
update public.telegram_links l
   set events = array_append(l.events, 'ai_analysis')
 where not ('ai_analysis' = any(l.events));
update public.telegram_links l
   set events = array_append(l.events, 'ai_weekly')
  from public.profiles p
 where p.id = l.user_id and p.role in ('main', 'teamlead') and not ('ai_weekly' = any(l.events));
