-- ============================================================================
--  Доступ баера к «Легаси крео» (/library). Выполнить после 054_mcp_changes.sql.
--  Идемпотентный.
-- ============================================================================
--
--  Правило планёрки 09.11.2026: новый баер не льёт легаси-крео, пока не покажет
--  10–15 своих. Раздел баеру открывает владелец на «Команде». Владелец и тимлид
--  видят его всегда — колонка у них не читается.
--
--  Колонка добавляется с default true, чтобы все, кто уже есть, сохранили доступ,
--  а затем default меняется на false — новые профили приходят с закрытым разделом.
--  Повторный запуск колонку не трогает, значит и открытый/закрытый доступ тоже.
--
--  Прямого update колонки у authenticated нет (гранты 001: только name и свои
--  настройки), меняется она только через admin_update_profile, как роль и код.

alter table public.profiles add column if not exists legacy_access boolean not null default true;
alter table public.profiles alter column legacy_access set default false;

-- Новый аргумент p_legacy. create or replace не меняет список аргументов —
-- снимаем прежнюю версию (015), иначе вызов по именам станет неоднозначным.
drop function if exists public.admin_update_profile(uuid, public.user_role, text, text, boolean, text, boolean, text, boolean);

create or replace function public.admin_update_profile(
  p_id            uuid,
  p_role          public.user_role default null,
  p_buyer_code    text            default null,
  p_status        text            default null,
  p_clear_code    boolean         default false,
  p_gr_sheet      text            default null,
  p_clear_gr      boolean         default false,
  p_gr4_sheet     text            default null,
  p_clear_gr4     boolean         default false,
  p_legacy        boolean         default null
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
    gr4_spreadsheet_id = case when p_clear_gr4 then null else coalesce(p_gr4_sheet, gr4_spreadsheet_id) end,
    legacy_access      = coalesce(p_legacy, legacy_access)
  where id = p_id
  returning * into v_target;

  return v_target;
exception
  when unique_violation then
    raise exception 'Код % уже занят другим человеком', p_buyer_code;
end $$;

revoke all     on function public.admin_update_profile(uuid, public.user_role, text, text, boolean, text, boolean, text, boolean, boolean) from public, anon;
grant  execute on function public.admin_update_profile(uuid, public.user_role, text, text, boolean, text, boolean, text, boolean, boolean) to authenticated;
