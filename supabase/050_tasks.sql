-- Задачи (02.11.2026): холсты с майнд-картами и канбаном.
-- Личный холст — у каждого один, видит только хозяин. Общий — хозяин и те, кого он добавил.
-- Только сервер (service role), RLS без политик: кто что видит, решает lib/tasks/store.ts.
-- Скрипт идемпотентный.
create table if not exists public.task_boards (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id) on delete restrict,
  title       text not null,
  shared      boolean not null default false,
  created_at  timestamptz not null default now()
);
create unique index if not exists task_boards_personal on public.task_boards (owner_id) where not shared;

create table if not exists public.task_board_members (
  board_id  uuid not null references public.task_boards(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  primary key (board_id, user_id)
);
create index if not exists task_board_members_user on public.task_board_members (user_id);

-- Узел карты. Без родителя — сама карта (x, y — её место на холсте), под ней направления
-- (color), под ними задачи (status). dx, dy — свободный сдвиг от места в раскладке.
-- sort — порядок среди соседей: выше = важнее. id приходит из браузера.
create table if not exists public.tasks (
  id          uuid primary key,
  board_id    uuid not null references public.task_boards(id) on delete cascade,
  parent_id   uuid,
  title       text not null default '',
  sort        integer not null default 0,
  status      text check (status in ('todo', 'doing', 'done')),
  color       text,
  due         date,
  x           integer, y integer, dx integer, dy integer,
  updated_at  timestamptz not null default now()
);
create index if not exists tasks_board on public.tasks (board_id, sort);

alter table public.task_boards enable row level security;
alter table public.task_board_members enable row level security;
alter table public.tasks enable row level security;
revoke all on public.task_boards, public.task_board_members, public.tasks from anon, authenticated;
