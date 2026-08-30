-- ============================================================================
--  Авторизация и роли Genesis Creative Dashboard
--  Выполнить один раз: Supabase → SQL Editor → Run.
--  Скрипт идемпотентный, повторный запуск ничего не ломает.
-- ============================================================================

-- ─── Роли ────────────────────────────────────────────────────────────────────
do $$ begin
  create type public.user_role as enum ('main', 'teamlead', 'buyer');
exception when duplicate_object then null;
end $$;

-- ─── Выдача кода баера ───────────────────────────────────────────────────────
-- Последовательность, а не max()+1. Номера НИКОГДА не переиспользуются: ушёл
-- человек — его номер остаётся за ним навсегда, следующий получает следующий
-- свободный. Дыры в нумерации (1, 7, 15, 25) — это ожидаемо и правильно.
--
-- Стартуем с 5: b1–b4 уже выданы Артёму, Матвею, Андрею и Саяну.
create sequence if not exists public.buyer_code_seq start with 5;

-- ─── Профили ─────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  email        text not null,
  name         text,
  role         public.user_role not null default 'buyer',

  -- 'b5'. У main и тимлида обычно пустой — они не льют. Если код успели выдать,
  -- а человек стал тимлидом, номер просто остаётся неиспользованным: вернуть
  -- его в оборот нельзя.
  buyer_code   text unique,

  -- Числовой id из ссылки залива. В код креатива не идёт, нужен для сверки
  -- «buyer_id в ссылке соответствует владельцу кабинета».
  crm_buyer_id text,
  notion_url   text,

  status       text not null default 'active' check (status in ('active', 'disabled')),
  created_at   timestamptz not null default now()
);

-- ─── Кто из баеров закреплён за тимлидом ─────────────────────────────────────
create table if not exists public.teamlead_buyers (
  teamlead_id uuid not null references public.profiles(id) on delete cascade,
  buyer_id    uuid not null references public.profiles(id) on delete cascade,
  primary key (teamlead_id, buyer_id)
);

-- ─── Профиль заводится сам при регистрации ───────────────────────────────────
-- Все приходят баерами и сразу получают код. Роль меняет main вручную.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, buyer_code)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'name', ''),
    'b' || nextval('public.buyer_code_seq')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── Роль текущего пользователя ──────────────────────────────────────────────
-- security definer, иначе политики на profiles рекурсивно вызовут сами себя.
create or replace function public.app_role()
returns public.user_role
language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.app_is_main()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(public.app_role() = 'main', false) $$;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table public.profiles       enable row level security;
alter table public.teamlead_buyers enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (
  id = auth.uid()                                   -- свой профиль видно всегда
  or public.app_is_main()                           -- main видит всех
  or exists (                                       -- тимлид — своих подопечных
    select 1 from public.teamlead_buyers tb
    where tb.teamlead_id = auth.uid() and tb.buyer_id = public.profiles.id
  )
);

-- ВАЖНО: RLS ограничивает СТРОКИ, но не КОЛОНКИ. Одной политики «правь свою
-- строку» недостаточно — с ней любой баер выполнил бы
--     update public.profiles set role = 'main' where id = auth.uid();
-- и стал бы владельцем. Колонки режутся правами уровня Postgres, а не RLS.
revoke update on public.profiles from anon, authenticated;
grant  update (name) on public.profiles to authenticated;

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- Роль, код баера и статус через API не меняются вообще: гранта на эти колонки
-- нет ни у кого, включая main. Меняются из SQL Editor — роль postgres обходит и
-- RLS, и гранты. Когда появится админка ролей, сюда встанет отдельная
-- security definer функция, но не раньше, чем она реально понадобится.
drop policy if exists profiles_update_main on public.profiles;

drop policy if exists tb_select on public.teamlead_buyers;
create policy tb_select on public.teamlead_buyers for select
  using (teamlead_id = auth.uid() or public.app_is_main());

drop policy if exists tb_write on public.teamlead_buyers;
create policy tb_write on public.teamlead_buyers for all
  using (public.app_is_main()) with check (public.app_is_main());

-- ============================================================================
--  ПОСЛЕ ЗАПУСКА — два шага руками, оба разовые.
--
--  1. Себя сделать main. Зарегистрируйся в дашборде, потом здесь:
--       update public.profiles set role = 'main', buyer_code = null
--       where email = 'твоя@почта';
--
--  2. Четырём действующим баерам проставить их коды, когда зарегистрируются.
--     Автовыдача даст им b5, b6… — это не те номера. Из словаря БАЙЕРЫ:
--       update public.profiles set buyer_code = 'b1', crm_buyer_id = '5183'
--       where email = 'почта Артёма';
--       -- b2 Матвей 6159 · b3 Андрей 9567 · b4 Саян 10502
--
--  Личный ключ Meta здесь СОЗНАТЕЛЬНО не хранится. Токен умеет не только
--  читать, но и тратить, поэтому он появится отдельным шагом вместе с
--  шифрованием, а не просто колонкой в таблице.
-- ============================================================================
