-- ============================================================================
--  Одноразовые приглашения. Выполнить после 001_auth.sql.
--  Скрипт идемпотентный, повторный запуск ничего не ломает.
-- ============================================================================

create table if not exists public.invites (
  token      text primary key,
  -- Какую роль получит приглашённый. Обычно buyer.
  role       public.user_role not null default 'buyer',
  -- Для кого выписано: «Новый баер, выходит с понедельника». Для глаз, не для логики.
  note       text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  used_at    timestamptz,
  used_by    uuid references auth.users(id) on delete set null
);

create index if not exists invites_unused on public.invites (token) where used_at is null;

-- ─── Запрет регистрации без приглашения ──────────────────────────────────────
-- Проверка стоит В БАЗЕ, а не только в нашем route. Причина: anon-ключ лежит в
-- браузере у всех на виду, поэтому обратиться в Supabase напрямую может кто
-- угодно, минуя приложение. Здесь его остановит триггер: исключение откатывает
-- вставку в auth.users целиком, аккаунт не создаётся.
--
-- Единственное исключение — самый первый аккаунт. Пока таблица профилей пуста,
-- приглашение не требуется: иначе выписать первое приглашение было бы некому.
-- Как только появился первый профиль, лазейка закрывается сама, и про неё не
-- нужно помнить.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_token    text := nullif(new.raw_user_meta_data ->> 'invite', '');
  v_role     public.user_role := 'buyer';
  v_is_first boolean;
begin
  select count(*) = 0 into v_is_first from public.profiles;

  if not v_is_first then
    -- for update: два человека с одним токеном в одну секунду не пройдут оба.
    select i.role into v_role
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
    -- Код баера только тем, кто льёт. Владельцу и тимлиду он не нужен, и
    -- тратить на них номер из последовательности незачем.
    case when v_role = 'buyer' then 'b' || nextval('public.buyer_code_seq') else null end
  )
  on conflict (id) do nothing;

  return new;
end $$;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table public.invites enable row level security;

-- Приглашения видит и выписывает только владелец. Приглашённый свой токен не
-- читает — он получает его ссылкой от того, кто пригласил.
drop policy if exists invites_main_all on public.invites;
create policy invites_main_all on public.invites for all
  using (public.app_is_main()) with check (public.app_is_main());

-- ============================================================================
--  После запуска:
--
--  1. Зарегистрируйся в дашборде. Поле «код приглашения» оставь пустым —
--     первый аккаунт заводится без него и сразу становится владельцем.
--
--  2. Убери REGISTRATION_INVITE_CODE из .env.local и из Vercel — общий код
--     больше не используется.
--
--  3. Дальше приглашения выписываются на странице /admin/invites.
-- ============================================================================
