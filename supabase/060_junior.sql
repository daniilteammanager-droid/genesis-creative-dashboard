-- ============================================================================
--  Джун под баером (24.11.2026, Даниил). Выполнить после 059_mcp_revoke_on_disable.sql.
--  Идемпотентный.
-- ============================================================================
--
--  Джун — человек баера без своих подключений: видит кабинеты, цифры и крео своего баера
--  (getSeat в lib/auth/server.ts) в тех разделах, что ему открыли владелец или сам баер.
--  Баер у джуна ровно один — поэтому колонка profiles.junior_of, а не teamlead_buyers
--  (та — «многие ко многим» и в коде не используется).
--
--  Роль 'junior' в enum: app_role() отдаёт её как есть, политики «владелец / тимлид» джуна не
--  пускают, свои строки он видит по auth.uid(), как все. Данные баера джуну отдаёт только
--  сервер — новых политик не нужно. Литерал 'junior' ниже живёт только в телах plpgsql:
--  новое значение enum нельзя использовать в той же транзакции, где оно добавлено.

alter type public.user_role add value if not exists 'junior';

alter table public.profiles
  add column if not exists junior_of    uuid references public.profiles(id) on delete set null,
  -- Разделы джуна (адреса из lib/nav.ts). null — по умолчанию: всё, кроме General 4.0 и Пополнений.
  -- Видит он пересечение с разделами баера, это считается при чтении, а не здесь.
  add column if not exists junior_areas text[],
  -- Свой Claude или Codex по MCP — по умолчанию выключен.
  add column if not exists junior_mcp   boolean not null default false;
create index if not exists profiles_junior_of on public.profiles (junior_of) where junior_of is not null;

-- Приглашение джуна сразу к баеру: по нему регистрируются только джуном к этому баеру.
alter table public.invites add column if not exists junior_of uuid references public.profiles(id) on delete cascade;

-- Кто сделал: задание пишется на баера (его кабинеты, ключ, папка), а нажал — джун.
alter table public.autoupload_jobs    add column if not exists actor_id uuid references public.profiles(id) on delete set null;
alter table public.video_variant_jobs add column if not exists actor_id uuid references public.profiles(id) on delete set null;

-- Уведомление баеру: джун поставил на паузу, запустил или поменял бюджет в Live Manager.
update public.telegram_links set events = array_append(events, 'junior_changes')
where not ('junior_changes' = any(events));

-- ─── Владелец: роль, баер джуна, разделы, AI-доступ ─────────────────────────
-- Новые аргументы — снимаем прежнюю версию (055), иначе вызов по именам станет неоднозначным.
drop function if exists public.admin_update_profile(uuid, public.user_role, text, text, boolean, text, boolean, text, boolean, boolean);

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
  p_legacy        boolean         default null,
  p_junior_of     uuid            default null,
  p_areas         text[]          default null,
  p_reset_areas   boolean         default false,
  p_junior_mcp    boolean         default null
)
returns public.profiles
language plpgsql
security definer set search_path = public
as $$
declare
  v_target public.profiles;
  v_mains  integer;
  v_role   public.user_role;
  v_buyer  uuid;
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

  if p_areas is not null and cardinality(p_areas) > 30 then
    raise exception 'Слишком много разделов';
  end if;

  -- Джун без баера ничего не видит — роль и баер ставятся вместе. Не джуну баер не нужен.
  v_role  := coalesce(p_role, v_target.role);
  v_buyer := case when v_role = 'junior' then coalesce(p_junior_of, v_target.junior_of) end;
  if v_role = 'junior' then
    if v_buyer is null then
      raise exception 'Выбери баера джуна';
    end if;
    if v_buyer = p_id or not exists (select 1 from public.profiles where id = v_buyer and role = 'buyer') then
      raise exception 'Джуна можно привязать только к баеру';
    end if;
  end if;

  update public.profiles set
    role               = v_role,
    buyer_code         = case when p_clear_code then null else coalesce(p_buyer_code, buyer_code) end,
    status             = coalesce(p_status, status),
    gr_spreadsheet_id  = case when p_clear_gr  then null else coalesce(p_gr_sheet,  gr_spreadsheet_id)  end,
    gr4_spreadsheet_id = case when p_clear_gr4 then null else coalesce(p_gr4_sheet, gr4_spreadsheet_id) end,
    legacy_access      = coalesce(p_legacy, legacy_access),
    junior_of          = v_buyer,
    junior_areas       = case when p_reset_areas then null else coalesce(p_areas, junior_areas) end,
    junior_mcp         = coalesce(p_junior_mcp, junior_mcp)
  where id = p_id
  returning * into v_target;

  return v_target;
exception
  when unique_violation then
    raise exception 'Код % уже занят другим человеком', p_buyer_code;
end $$;

revoke all     on function public.admin_update_profile(uuid, public.user_role, text, text, boolean, text, boolean, text, boolean, boolean, uuid, text[], boolean, boolean) from public, anon;
grant  execute on function public.admin_update_profile(uuid, public.user_role, text, text, boolean, text, boolean, text, boolean, boolean, uuid, text[], boolean, boolean) to authenticated;

-- ─── Баер: разделы и AI-доступ своих джунов ─────────────────────────────────
-- Только своим и только это: роль, привязку и статус меняет владелец.
create or replace function public.buyer_update_junior(
  p_id          uuid,
  p_areas       text[]  default null,
  p_reset_areas boolean default false,
  p_mcp         boolean default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if public.app_role() is distinct from 'buyer' then
    raise exception 'Джунов настраивает их баер';
  end if;
  if p_areas is not null and cardinality(p_areas) > 30 then
    raise exception 'Слишком много разделов';
  end if;
  update public.profiles set
    junior_areas = case when p_reset_areas then null else coalesce(p_areas, junior_areas) end,
    junior_mcp   = coalesce(p_mcp, junior_mcp)
  where id = p_id and role = 'junior' and junior_of = auth.uid();
  if not found then
    raise exception 'Это не твой джун';
  end if;
end $$;

revoke all     on function public.buyer_update_junior(uuid, text[], boolean, boolean) from public, anon;
grant  execute on function public.buyer_update_junior(uuid, text[], boolean, boolean) to authenticated;

-- Баер выписывает ссылку джуну к себе. Приглашения баеру закрыты политикой (002) — поэтому функция.
create or replace function public.junior_invite(p_note text default null, p_days integer default 7)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_token text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 20);
begin
  if public.app_role() is distinct from 'buyer' then
    raise exception 'Ссылку джуну выписывает баер';
  end if;
  insert into public.invites (token, role, note, created_by, expires_at, junior_of)
  values (v_token, 'junior', nullif(trim(p_note), ''), auth.uid(),
          now() + make_interval(days => least(greatest(coalesce(p_days, 7), 1), 30)), auth.uid());
  return v_token;
end $$;

revoke all     on function public.junior_invite(text, integer) from public, anon;
grant  execute on function public.junior_invite(text, integer) to authenticated;

-- Баер джуна — для панели и middleware (свою строку джун читает, строку баера политика не даёт).
-- Только то, что нужно, чтобы решить, что джуну видно; не джуну — пусто.
create or replace function public.junior_buyer()
returns table (id uuid, name text, buyer_code text, status text, role public.user_role, legacy_access boolean)
language plpgsql stable
security definer set search_path = public
as $$
begin
  return query
    select b.id, b.name, b.buyer_code, b.status, b.role, b.legacy_access
      from public.profiles j join public.profiles b on b.id = j.junior_of
     where j.id = auth.uid() and j.role = 'junior';
end $$;

revoke all     on function public.junior_buyer() from public, anon;
grant  execute on function public.junior_buyer() to authenticated;

-- ─── Регистрация по приглашению джуна ───────────────────────────────────────
-- Как 003, плюс junior_of из приглашения. Кода баера джуну не выдаём.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_token    text := nullif(new.raw_user_meta_data ->> 'invite', '');
  v_role     public.user_role := 'buyer';
  v_code     text;
  v_junior   uuid;
  v_is_first boolean;
begin
  select count(*) = 0 into v_is_first from public.profiles;

  if not v_is_first then
    select i.role, i.buyer_code, i.junior_of into v_role, v_code, v_junior
      from public.invites i
     where i.token = v_token
       and i.used_at is null
       and i.expires_at > now()
       for update;

    if not found then
      raise exception 'Приглашение недействительно, просрочено или уже использовано';
    end if;
    if v_role = 'junior' and v_junior is null then
      raise exception 'В приглашении джуна нет баера';
    end if;

    update public.invites
       set used_at = now(), used_by = new.id
     where token = v_token;
  else
    v_role := 'main';
  end if;

  insert into public.profiles (id, email, name, role, buyer_code, junior_of)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'name', ''),
    v_role,
    case
      when v_role <> 'buyer' then null
      when v_code is not null then v_code
      else 'b' || nextval('public.buyer_code_seq')
    end,
    case when v_role = 'junior' then v_junior end
  )
  on conflict (id) do nothing;

  return new;
end $$;
