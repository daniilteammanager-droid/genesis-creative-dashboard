-- ============================================================================
--  Управление профилями из интерфейса. Выполнить после 002_invites.sql.
--  Скрипт идемпотентный.
-- ============================================================================

-- Роль, код баера и статус закрыты грантами (Decision 030): прямого update на эти
-- колонки нет ни у кого, включая владельца. Это защита от того, чтобы баер одной
-- командой назначил себя владельцем — и снимать её нельзя.
--
-- Значит менять их можно только через функцию, которая сама проверяет, кто зовёт.
-- security definer выполняет её от владельца схемы, поэтому гранты ей не мешают.
create or replace function public.admin_update_profile(
  p_id         uuid,
  p_role       public.user_role default null,
  p_buyer_code text            default null,
  p_status     text            default null,
  p_clear_code boolean         default false
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

  -- Последнего владельца разжаловать нельзя: администрировать станет некому, а
  -- вернуть роль будет можно только из SQL-редактора. Себя отключить тоже нельзя
  -- по той же причине.
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
    role       = coalesce(p_role, role),
    buyer_code = case when p_clear_code then null else coalesce(p_buyer_code, buyer_code) end,
    status     = coalesce(p_status, status)
  where id = p_id
  returning * into v_target;

  return v_target;
exception
  when unique_violation then
    -- Единственное уникальное поле здесь — код баера.
    raise exception 'Код % уже занят другим человеком', p_buyer_code;
end $$;

revoke all     on function public.admin_update_profile(uuid, public.user_role, text, text, boolean) from public, anon;
grant  execute on function public.admin_update_profile(uuid, public.user_role, text, text, boolean) to authenticated;

-- ─── Номер баера прямо в приглашении ─────────────────────────────────────────
-- Четверым действующим баерам нужны их настоящие b1–b4, а последовательность
-- выдаёт следующий свободный. Пусть номер задаётся при выписке приглашения:
-- тогда после регистрации ничего править руками не придётся.
alter table public.invites add column if not exists buyer_code text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_token    text := nullif(new.raw_user_meta_data ->> 'invite', '');
  v_role     public.user_role := 'buyer';
  v_code     text;
  v_is_first boolean;
begin
  select count(*) = 0 into v_is_first from public.profiles;

  if not v_is_first then
    select i.role, i.buyer_code into v_role, v_code
      from public.invites i
     where i.token = v_token
       and i.used_at is null
       and i.expires_at > now()
       for update;

    if not found then
      raise exception 'Приглашение недействительно, просрочено или уже использовано';
    end if;

    update public.invites
       set used_at = now(), used_by = new.id
     where token = v_token;
  else
    -- Первый в системе становится владельцем: раздавать приглашения больше некому.
    v_role := 'main';
  end if;

  insert into public.profiles (id, email, name, role, buyer_code)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'name', ''),
    v_role,
    -- Номер из приглашения, если он там задан; иначе следующий по очереди.
    -- Владельцу и тимлиду номер не нужен и тратить его на них незачем.
    case
      when v_role <> 'buyer' then null
      when v_code is not null then v_code
      else 'b' || nextval('public.buyer_code_seq')
    end
  )
  on conflict (id) do nothing;

  return new;
end $$;
