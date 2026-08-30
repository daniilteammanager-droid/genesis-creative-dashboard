-- ============================================================================
--  Заметки и избранное становятся личными. Выполнить после 006_spreadsheets.sql.
--  Скрипт идемпотентный.
-- ============================================================================

-- Раньше всё лежало в одной строке creative_notes с ключом по коду креатива:
-- и расшифровка, и заметка, и избранное. Но это факты разной природы.
--
--   расшифровка — свойство файла. Её пишет воркер, обходя R2, и про людей он не
--                 знает ничего. Повесить её на человека значит писать один и тот
--                 же текст столько раз, сколько людей смотрит на крео.
--   ignored     — свойство библиотеки: прячет битое имя из списка «не загружено».
--   заметка     — мысли конкретного человека о крео.
--   избранное   — тем более: у каждого своё.
--
-- Поэтому первые два остаются в creative_notes с прежним ключом, а вторые два
-- переезжают сюда, с ключом «человек + крео».
create table if not exists public.creative_user_notes (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  creative_code text not null,
  favorite      boolean not null default false,
  note          text,
  updated_at    timestamptz not null default now(),
  primary key (user_id, creative_code)
);

create index if not exists creative_user_notes_by_user on public.creative_user_notes (user_id);

alter table public.creative_user_notes enable row level security;

-- Своё — и только своё. Здесь RLS хватает: ограничение именно по строкам, а
-- колонок, которые нельзя трогать владельцу строки, тут нет (в отличие от
-- profiles, где пришлось резать грантами — Decision 030).
drop policy if exists creative_user_notes_own on public.creative_user_notes;
create policy creative_user_notes_own on public.creative_user_notes for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ─── Перенос накопленного ────────────────────────────────────────────────────
-- Всё, что заведено до этого момента, сделано владельцем — других аккаунтов
-- просто не было. Отдаём ему.
insert into public.creative_user_notes (user_id, creative_code, favorite, note, updated_at)
select
  (select id from public.profiles where role = 'main' order by created_at limit 1),
  n.creative_code,
  coalesce(n.favorite, false),
  n.note,
  coalesce(n.updated_at, now())
from public.creative_notes n
where (coalesce(n.favorite, false) or n.note is not null)
  and exists (select 1 from public.profiles where role = 'main')
on conflict (user_id, creative_code) do nothing;

-- ============================================================================
--  Колонки creative_notes.favorite и creative_notes.note намеренно НЕ удалены.
--  Код их больше не читает, данные перенесены — но пусть полежат, пока не станет
--  видно, что перенос прошёл верно. Удалять их отдельной миграцией, а не сейчас:
--  вернуть удалённое будет неоткуда.
-- ============================================================================
