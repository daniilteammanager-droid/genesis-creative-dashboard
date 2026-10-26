-- Автозалив (Decision 081): задания создания кампаний в Meta.
-- План — что создать (собран и проверен до запуска), state — что уже создано
-- (id кампаний, адсетов, объявлений, загруженные медиа): по нему проходы
-- продолжают с места остановки, а отмена удаляет созданное. Скрипт идемпотентный.
create table if not exists public.autoupload_jobs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  plan        jsonb not null,
  -- creating → created | failed; cancelling → cancelled
  status      text not null default 'creating',
  state       jsonb,
  stage       text,
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists autoupload_jobs_by_user on public.autoupload_jobs (user_id, created_at desc);
create index if not exists autoupload_jobs_open on public.autoupload_jobs (status) where status = 'creating';
alter table public.autoupload_jobs enable row level security;
revoke all on public.autoupload_jobs from anon, authenticated;
-- Аренда прохода: пока не истекла, второй проход (крон или повторный клик) задание не берёт —
-- иначе два прохода создали бы одну кампанию дважды.
alter table public.autoupload_jobs add column if not exists lease_until timestamptz;
