-- Стартовая страница: куда ведёт https://…/ после входа (Настройки → Профиль).
-- null — Главная. Своя настройка и ничего не открывает, поэтому правка своей строки
-- разрешена, как у имени и обучалки. Скрипт идемпотентный.
alter table public.profiles add column if not exists start_page text;
grant update (start_page) on public.profiles to authenticated;
