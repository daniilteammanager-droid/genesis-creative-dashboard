-- Авточек в формате Артёма (Decision 090): четвёртый разрез расписания. Идемпотентный.
alter table public.telegram_links drop constraint if exists telegram_links_check_group_check;
alter table public.telegram_links add constraint telegram_links_check_group_check
  check (check_group in ('campaign', 'creative', 'country', 'artem'));
