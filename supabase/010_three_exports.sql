-- ============================================================================
--  Три выгрузки Torro вместо двух. Выполнить после 009_warehouse.sql.
--  Скрипт идемпотентный.
-- ============================================================================
--
--  Что изменилось и почему.
--
--  1. Все три выгрузки теперь дневные Google-таблицы, то есть КЛЮЧИ ТАБЛИЦ, а не
--     ссылки на XLSX. Поле кампаний было ссылкой — переименовано.
--  2. Добавилась третья: объявления по id. Строка выгрузки по имени
--     предагрегирована по имени и между объявлениями не делится, поэтому депозиты
--     на конкретном объявлении и на адсете берутся только отсюда.
--
--  Таблица подключений пуста (проверено 31.08.2026), поэтому переименование
--  ничего не теряет.

alter table public.buyer_connections
  rename column crm_campaigns_url to crm_campaigns_sheet_id;

alter table public.buyer_connections
  add column if not exists crm_ads_by_id_sheet_id text;

comment on column public.buyer_connections.crm_campaigns_sheet_id  is 'Дневная выгрузка Torro по кампаниям, ключ Google-таблицы';
comment on column public.buyer_connections.crm_ads_sheet_id        is 'Дневная выгрузка Torro по объявлениям, ключ по НАЗВАНИЮ объявления';
comment on column public.buyer_connections.crm_ads_by_id_sheet_id  is 'Дневная выгрузка Torro по объявлениям, ключ по ID объявления';
