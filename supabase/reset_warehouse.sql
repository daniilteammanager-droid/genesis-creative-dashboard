-- ============================================================================
--  Очистка склада. НЕ миграция — операция, выполняется руками по решению.
--  Имя без номера намеренно: файл не должен попасть в очередь миграций.
-- ============================================================================
--
--  Когда нужна: склад собран не теми ключами и цифры в нём смешаны. Так было
--  03.09.2026 — токены баеров были сняты с аккаунта владельца и видели все 78
--  кабинетов команды, поэтому каждому баеру записался расход всей команды
--  (Decision 050).
--
--  ПОРЯДОК ВАЖЕН. Чистить имеет смысл только после того, как подключения
--  исправлены, иначе ближайший прогон крона положит те же данные обратно:
--
--    1. Каждому баеру — системный пользователь в Business Manager с назначенными
--       ему кабинетами, токен от него.
--    2. Проверить, что подключение видит единицы кабинетов, а не десятки.
--    3. Выполнить этот скрипт.
--    4. Дёрнуть загрузку: POST /api/ingest?kind=window с заголовком x-ingest-secret.
--
--  ЧТО ВОССТАНОВИТСЯ. Загрузка перечитывает окно в 14 дней от самой свежей даты
--  в выгрузках Torro. История глубже окна не вернётся — её просто неоткуда взять.
--  Пока складу несколько дней, терять нечего.
--
--  Заметки, избранное, транскрипции, профили, подключения и файлы в R2 этот
--  скрипт не трогает вообще.

begin;

-- Дневная статистика Meta
delete from public.wh_ad_days;
delete from public.wh_campaign_days;

-- Выгрузки Torro
delete from public.wh_crm_ad_periods;
delete from public.wh_crm_ad_id_periods;
delete from public.wh_crm_campaign_periods;

-- Таргет адсетов: состояние «сейчас», перечитывается прогоном
delete from public.wh_adsets;

-- Журнал прогонов
delete from public.wh_ingest_runs;

commit;

-- Проверка: всё должно быть по нулям.
select 'wh_ad_days' t, count(*) from public.wh_ad_days
union all select 'wh_campaign_days', count(*) from public.wh_campaign_days
union all select 'wh_crm_ad_periods', count(*) from public.wh_crm_ad_periods
union all select 'wh_crm_ad_id_periods', count(*) from public.wh_crm_ad_id_periods
union all select 'wh_crm_campaign_periods', count(*) from public.wh_crm_campaign_periods
union all select 'wh_adsets', count(*) from public.wh_adsets
union all select 'wh_ingest_runs', count(*) from public.wh_ingest_runs;
