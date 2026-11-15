-- Тема интерфейса (Настройки → Профиль): тёмная, светлая или как в системе.
-- null — тёмная, как у всех до этой настройки. Своя настройка и ничего не открывает,
-- поэтому правка своей строки разрешена, как у стартовой страницы. Скрипт идемпотентный.
alter table public.profiles add column if not exists theme text;
alter table public.profiles drop constraint if exists profiles_theme_check;
alter table public.profiles add constraint profiles_theme_check check (theme in ('dark', 'light', 'system'));
grant update (theme) on public.profiles to authenticated;
