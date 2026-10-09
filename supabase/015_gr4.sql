-- ============================================================================
--  General Report 4.0. Выполнить после 014_account_names.sql. Идемпотентный.
-- ============================================================================
--
--  Новый формат таблиц: одна общая таблица (листы «Трафик», «Депы», «CRM итоги»)
--  и по таблице на баера (листы «Ввод» и «История»). Старые таблицы GR 3.0
--  остаются как были — оба отчёта живут рядом, пока 4.0 не проверен.
--
--  1. Общая таблица — строка в gr_spreadsheets с kind = 'v4'. GR 3.0 такие
--     строки пропускает: у них другой формат, и его парсер разобрал бы их молча
--     и неверно.
--  2. Таблица баера — своё поле в профиле, рядом с полем GR 3.0, а не вместо
--     него: иначе GR 3.0 у баера сломался бы в день переключения.

alter table public.gr_spreadsheets drop constraint if exists gr_spreadsheets_kind_check;
alter table public.gr_spreadsheets
  add constraint gr_spreadsheets_kind_check check (kind in ('country', 'wa', 'v4'));

alter table public.profiles add column if not exists gr4_spreadsheet_id text;

-- Функция профиля получает два новых аргумента. create or replace не умеет
-- менять список аргументов, поэтому старую версию снимаем — иначе рядом
-- окажутся две перегрузки, и вызов по именам станет неоднозначным (см. 005).
drop function if exists public.admin_update_profile(uuid, public.user_role, text, text, boolean, text, boolean);

create or replace function public.admin_update_profile(
  p_id            uuid,
  p_role          public.user_role default null,
  p_buyer_code    text            default null,
  p_status        text            default null,
  p_clear_code    boolean         default false,
  p_gr_sheet      text            default null,
  p_clear_gr      boolean         default false,
  p_gr4_sheet     text            default null,
  p_clear_gr4     boolean         default false
)
returns public.profiles
language plpgsql
security definer set search_path = public
as $$
declare
  v_target public.profiles;
  v_mains  integer;
begin
  if not public.app_is_main() then
    raise exception 'Менять профили может только владелец';
  end if;

  select * into v_target from public.profiles where id = p_id for update;
  if not found then
    raise exception 'Профиль не найден';
  end if;

  if p_role is not null and p_role <> 'main' and v_target.role = 'main' then
    select count(*) into v_mains from public.profiles where role = 'main';
    if v_mains <= 1 then
      raise exception 'Это последний владелец — сначала назначь другого';
    end if;
  end if;

  if p_status = 'disabled' and p_id = auth.uid() then
    raise exception 'Нельзя отключить самого себя';
  end if;

  if p_buyer_code is not null and p_buyer_code !~ '^b[0-9]+$' then
    raise exception 'Код баера должен быть вида b5';
  end if;

  if p_status is not null and p_status not in ('active', 'disabled') then
    raise exception 'Неизвестный статус: %', p_status;
  end if;

  update public.profiles set
    role               = coalesce(p_role, role),
    buyer_code         = case when p_clear_code then null else coalesce(p_buyer_code, buyer_code) end,
    status             = coalesce(p_status, status),
    gr_spreadsheet_id  = case when p_clear_gr  then null else coalesce(p_gr_sheet,  gr_spreadsheet_id)  end,
    gr4_spreadsheet_id = case when p_clear_gr4 then null else coalesce(p_gr4_sheet, gr4_spreadsheet_id) end
  where id = p_id
  returning * into v_target;

  return v_target;
exception
  when unique_violation then
    raise exception 'Код % уже занят другим человеком', p_buyer_code;
end $$;

revoke all     on function public.admin_update_profile(uuid, public.user_role, text, text, boolean, text, boolean, text, boolean) from public, anon;
grant  execute on function public.admin_update_profile(uuid, public.user_role, text, text, boolean, text, boolean, text, boolean) to authenticated;

-- ============================================================================
--  После запуска:
--   Настройки → Интеграции → «Таблицы General Report» → добавить общую таблицу
--   с типом «General 4.0»; Настройки → Команда → поле «General 4.0» у баеров.
-- ============================================================================
