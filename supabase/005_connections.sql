-- ============================================================================
--  Личные подключения баеров. Выполнить после 004_status.sql.
--  Скрипт идемпотентный.
--
--  ВАЖНО: если когда-нибудь понадобится прогнать 003_admin.sql заново — прогони
--  после него и этот файл. 003 создаёт admin_update_profile со старым списком
--  аргументов, и рядом с новой версией получатся две перегрузки. Вызов по именам
--  станет неоднозначным, и страница «Команда» перестанет сохранять.
-- ============================================================================

-- Отчёты работали на общих ключах из env: один ключ Meta и одни выгрузки Торро
-- на всю команду. Значит новый баер = правка конфига и деплой, а разграничить
-- данные было нечем — все цифры добыты одними и теми же ключами.
create table if not exists public.buyer_connections (
  user_id           uuid primary key references public.profiles(id) on delete cascade,

  -- Шифротекст, а не сам токен. Ключ Meta умеет тратить деньги, открытым текстом
  -- в базе ему не место. Расшифровка только на сервере (lib/connections/crypto.ts).
  meta_token_enc    text,
  -- Последние символы ключа — чтобы человек узнал свой, не читая его целиком.
  meta_token_hint   text,
  meta_token_set_at timestamptz,

  -- Выгрузки Torro CRM. Ссылка на XLSX для режима «Кампании» и ключ таблицы для
  -- режима «Объявления» — ровно то, что сейчас лежит в MVP_CAMPAIGN_WEEKLY_XLSX_URL
  -- и GR_SPREADSHEET_ADS_BY_NAME, только своё у каждого.
  crm_campaigns_url text,
  crm_ads_sheet_id  text,

  updated_at        timestamptz not null default now()
);

-- Таблица недостижима из браузера вообще: у PostgREST нет на неё прав, поэтому
-- никакая политика RLS её и не спасает — и не нужна. Ходит сюда только сервер,
-- сервисным ключом, через /api/connections.
--
-- Почему не «RLS: свою строку можно» — потому что «свою строку» включало бы
-- чтение шифротекста в браузер. Секрет, который доехал до клиента, уже не секрет.
alter table public.buyer_connections enable row level security;
revoke all on public.buyer_connections from anon, authenticated;

-- ─── Таблица General 3.0 живёт в профиле, а не в подключениях ────────────────
-- Её заводит и шарит на сервисный аккаунт владелец, баеру там нечего вводить.
-- Значит и поле должно быть там, где владелец правит профиль, а не у баера.
alter table public.profiles add column if not exists gr_spreadsheet_id text;

-- Сигнатура функции меняется, поэтому старую надо снять: create or replace
-- умеет менять тело, но не список аргументов.
drop function if exists public.admin_update_profile(uuid, public.user_role, text, text, boolean);

create or replace function public.admin_update_profile(
  p_id            uuid,
  p_role          public.user_role default null,
  p_buyer_code    text            default null,
  p_status        text            default null,
  p_clear_code    boolean         default false,
  p_gr_sheet      text            default null,
  p_clear_gr      boolean         default false
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
    role             = coalesce(p_role, role),
    buyer_code       = case when p_clear_code then null else coalesce(p_buyer_code, buyer_code) end,
    status           = coalesce(p_status, status),
    gr_spreadsheet_id = case when p_clear_gr then null else coalesce(p_gr_sheet, gr_spreadsheet_id) end
  where id = p_id
  returning * into v_target;

  return v_target;
exception
  when unique_violation then
    -- Единственное уникальное поле здесь — код баера.
    raise exception 'Код % уже занят другим человеком', p_buyer_code;
end $$;

revoke all     on function public.admin_update_profile(uuid, public.user_role, text, text, boolean, text, boolean) from public, anon;
grant  execute on function public.admin_update_profile(uuid, public.user_role, text, text, boolean, text, boolean) to authenticated;
