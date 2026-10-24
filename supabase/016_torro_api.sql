-- ============================================================================
--  Torro по API (MCP) вместо выгрузок в таблицы. Выполнить после 015_gr4.sql.
--  Скрипт идемпотентный.
-- ============================================================================
--
--  Выгрузки в Google-таблицы остаются запасным путём: склад берёт API, если он
--  подключён, и таблицы — если нет. Оба сразу не читаются, иначе один и тот же
--  день лёг бы в склад дважды.

alter table public.buyer_connections
  add column if not exists torro_token_enc    text,
  add column if not exists torro_token_hint   text,
  add column if not exists torro_token_set_at timestamptz,
  -- id баера в Torro. Им режется каждый запрос: ключ с широкими правами без
  -- фильтра отдал бы цифры всей команды.
  add column if not exists torro_buyer_id     integer;

-- Один id Torro — один человек в дашборде. Иначе два баера вписали бы себе
-- один и тот же id, и цифры одного легли бы в склад обоим.
create unique index if not exists buyer_connections_torro_buyer_unique
  on public.buyer_connections (torro_buyer_id)
  where torro_buyer_id is not null;

-- Предупреждение прогона, которое не ошибка: например, имена из Torro, которым
-- не нашлось однозначного id в Meta. В error ему не место — прогон успешный.
alter table public.wh_ingest_runs add column if not exists note text;

comment on column public.buyer_connections.torro_token_enc is 'Ключ Torro MCP, шифротекст (lib/connections/crypto.ts)';
comment on column public.buyer_connections.torro_buyer_id  is 'id баера в Torro, фильтр buyer_ids каждого запроса';
