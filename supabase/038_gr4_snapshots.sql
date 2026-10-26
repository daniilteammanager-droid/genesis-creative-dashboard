-- General 4.0 из своей базы (Decision 084): каждая таблица GR4 (общая и таблицы
-- баеров) раз в 15 минут перечитывается по Sheets API и лежит здесь разобранной.
-- Страница читает отсюда — без похода в Google на каждое открытие.
-- ponytail: таблица целиком одним jsonb — тысячи строк, читаются разом; отдельные
-- строки в таблице понадобятся, если отчёт начнёт фильтровать на стороне базы.
-- Скрипт идемпотентный.
create table if not exists public.gr4_snapshots (
  spreadsheet_id text primary key,
  kind           text not null check (kind in ('main', 'buyer')),
  rows           jsonb not null default '[]',
  targets        jsonb,
  synced_at      timestamptz not null default now(),
  error          text            -- последняя ошибка чтения; снимок при этом прежний
);
alter table public.gr4_snapshots enable row level security;
revoke all on public.gr4_snapshots from anon, authenticated;
