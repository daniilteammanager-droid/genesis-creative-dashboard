-- Обучалка по дашборду (Decision 078). null — ещё не проходил: обучалка откроется
-- при входе. Новая колонка пустая у всех — значит, уже работающие увидят её один раз.
-- Человек сам отмечает, что прошёл, и сам сбрасывает для повтора — флаг
-- ничего не открывает, поэтому правка своей строки разрешена, как у имени.
-- Скрипт идемпотентный.
alter table public.profiles add column if not exists onboarded_at timestamptz;
grant update (onboarded_at) on public.profiles to authenticated;
