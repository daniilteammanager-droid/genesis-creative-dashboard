-- ============================================================================
--  Статистика переживает удаление профиля. После 010. Идемпотентный.
-- ============================================================================
--
--  Вопрос владельца 31.08.2026: «если мы теряем доступ к токену баера или
--  отключаем баера, его статистика ведь остаётся?»
--
--  Отключение и потеря токена — да, остаётся: отключение меняет только status,
--  а без токена загрузка просто пропускает человека, ранее собранное не трогая.
--
--  А вот УДАЛЕНИЕ профиля унесло бы с собой весь склад по этому человеку:
--  внешние ключи стояли on delete cascade. Профили мы не удаляем принципиально
--  (Decision 033), но правило, которое держится на памяти людей, однажды
--  нарушат — а месяцы статистики исчезнут молча, одной командой.
--
--  Меняем на restrict: удалить профиль, по которому есть данные, теперь просто
--  не получится. База откажет с ошибкой вместо тихой потери.

do $$
declare
  t text;
begin
  foreach t in array array[
    'wh_ad_days', 'wh_campaign_days',
    'wh_crm_ad_periods', 'wh_crm_ad_id_periods', 'wh_crm_campaign_periods'
  ] loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_user_id_fkey');
    execute format(
      'alter table public.%I add constraint %I foreign key (user_id) references public.profiles(id) on delete restrict',
      t, t || '_user_id_fkey'
    );
  end loop;
end $$;

-- Журнал прогонов — не данные, а история запусков: его можно и отпустить.
-- user_id там необязательный, поэтому обнуляем, а не запрещаем удаление.
alter table public.wh_ingest_runs drop constraint if exists wh_ingest_runs_user_id_fkey;
alter table public.wh_ingest_runs
  add constraint wh_ingest_runs_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete set null;
