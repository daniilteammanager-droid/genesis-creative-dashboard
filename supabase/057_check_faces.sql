-- Авточек «лица → площадки → страны» (чат менеджмента, 15.11.2026): пятый разрез расписания. Идемпотентный.
alter table public.telegram_links drop constraint if exists telegram_links_check_group_check;
alter table public.telegram_links add constraint telegram_links_check_group_check
  check (check_group in ('campaign', 'creative', 'country', 'artem', 'faces'));
