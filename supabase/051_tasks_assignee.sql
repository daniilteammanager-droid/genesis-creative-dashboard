-- Задачи, второй заход (02.11.2026): ответственный на общем холсте, правки по полям и напоминания.
-- Скрипт идемпотентный.

-- Ответственный — только на общем холсте (хозяин или участник). Пусто — задача хозяина холста.
alter table public.tasks add column if not exists assignee uuid references public.profiles(id) on delete set null;

-- Правки по полям: в строке меняется только то, что прислали (ключ есть в JSON), остальное
-- остаётся как есть. Так двое на общем холсте не затирают друг другу разные поля одной задачи.
-- Холст и права проверяет lib/tasks/store.ts; функция трогает только задачи этого холста.
create or replace function public.apply_task_patches(p_board uuid, p_rows jsonb) returns void
language plpgsql as $$
declare r jsonb;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    update public.tasks set
      parent_id  = case when r ? 'parent'   then (r->>'parent')::uuid   else parent_id end,
      title      = case when r ? 'title'    then r->>'title'            else title end,
      sort       = case when r ? 'sort'     then (r->>'sort')::int      else sort end,
      status     = case when r ? 'status'   then r->>'status'           else status end,
      color      = case when r ? 'color'    then r->>'color'            else color end,
      due        = case when r ? 'due'      then (r->>'due')::date      else due end,
      x          = case when r ? 'x'        then (r->>'x')::int         else x end,
      y          = case when r ? 'y'        then (r->>'y')::int         else y end,
      dx         = case when r ? 'dx'       then (r->>'dx')::int        else dx end,
      dy         = case when r ? 'dy'       then (r->>'dy')::int        else dy end,
      assignee   = case when r ? 'assignee' then (r->>'assignee')::uuid else assignee end,
      updated_at = now()
    where id = (r->>'id')::uuid and board_id = p_board;
  end loop;
end $$;
revoke execute on function public.apply_task_patches(uuid, jsonb) from public, anon, authenticated;

-- Напоминание о сроках уходит человеку раз в день: здесь отмечено, кому уже ушло.
create table if not exists public.task_reminders (
  user_id  uuid not null references public.profiles(id) on delete cascade,
  day      date not null,
  primary key (user_id, day)
);
alter table public.task_reminders enable row level security;
revoke all on public.task_reminders from anon, authenticated;

-- Новое уведомление «Задачи» — включено во всех привязках (выключить можно в Интеграциях).
update public.telegram_links set events = array_append(events, 'tasks') where not ('tasks' = any(events));
