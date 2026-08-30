-- ============================================================================
--  Таблицы General Report 3.0 переезжают из env в базу.
--  Выполнить после 005_connections.sql. Скрипт идемпотентный.
-- ============================================================================

-- Общие таблицы (EU, LATAM, WA и любые новые) были заданы переменными
-- GR_SPREADSHEET_*: новая таблица означала правку конфига и деплой. Плюс из env
-- невозможно понять, чья таблица чья, — а значит нечем и разграничивать.
--
-- Байерские таблицы здесь НЕ живут: они привязаны к человеку и лежат в
-- profiles.gr_spreadsheet_id, где их правит владелец на странице «Команда».
create table if not exists public.gr_spreadsheets (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  spreadsheet_id text not null,
  -- У WA-таблиц другая раскладка колонок и свой парсер. Ошибиться типом значит
  -- добавить таблицу, которая разберётся молча и неверно.
  kind           text not null default 'country' check (kind in ('country', 'wa')),
  sort           integer not null default 0,
  created_at     timestamptz not null default now()
);

alter table public.gr_spreadsheets enable row level security;

-- Видят владелец и тимлид — это общие таблицы команды. Баеру они не положены:
-- у него своя, из профиля (Decision 035).
drop policy if exists gr_spreadsheets_read on public.gr_spreadsheets;
create policy gr_spreadsheets_read on public.gr_spreadsheets for select
  using (public.app_role() = any (array['main', 'teamlead']::public.user_role[]));

-- Заводит и удаляет только владелец.
drop policy if exists gr_spreadsheets_write on public.gr_spreadsheets;
create policy gr_spreadsheets_write on public.gr_spreadsheets for all
  using (public.app_is_main()) with check (public.app_is_main());

-- ============================================================================
--  После запуска: Настройки → Интеграции → «Таблицы General Report 3.0».
--  Пока список пуст, отчёт продолжает читать GR_SPREADSHEET_* — ничего не
--  ломается. Как только добавлена первая таблица, источником становится база,
--  и переменные можно удалять.
-- ============================================================================
