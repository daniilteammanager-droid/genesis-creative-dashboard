-- ============================================================================
--  Кто загрузил креатив. Выполнить после 007_user_notes.sql. Идемпотентный.
-- ============================================================================

-- Принадлежность крео определяется фактом загрузки, а не кодом bN в имени
-- (Decision 034): bN печатает человек, и опечатка отдала бы крео чужому молча.
-- Дашборд знает, кто нажал кнопку, — вот это и записываем.
--
-- Отдельная таблица, а не колонка в creative_notes: там строку заводит воркер,
-- и Медиатека считает её появление признаком «файл обработан». Запись при
-- загрузке подделала бы этот признак — файл выглядел бы готовым, не будучи им.
create table if not exists public.creative_uploads (
  creative_code text primary key,
  object_key    text not null,
  user_id       uuid references public.profiles(id) on delete set null,
  -- Копия кода на момент загрузки. Человек может уйти, его строка обнулится по
  -- on delete set null — а знание «залил b3» должно пережить это.
  buyer_code    text,
  uploaded_at   timestamptz not null default now()
);

alter table public.creative_uploads enable row level security;

-- Читают все вошедшие: «кто залил» не секрет, и это нужно в интерфейсе, чтобы
-- показывать расхождение с кодом в имени.
drop policy if exists creative_uploads_read on public.creative_uploads;
create policy creative_uploads_read on public.creative_uploads for select
  using (auth.uid() is not null);

-- Записывает только тот, кто грузит, и только от своего имени. Перезалив чужого
-- файла разрешён — но тогда владельцем станет тот, кто перезалил, а не тот, кто
-- вписал себя в чужую строку.
drop policy if exists creative_uploads_write on public.creative_uploads;
create policy creative_uploads_write on public.creative_uploads for insert
  with check (user_id = auth.uid());

drop policy if exists creative_uploads_update on public.creative_uploads;
create policy creative_uploads_update on public.creative_uploads for update
  using (auth.uid() is not null) with check (user_id = auth.uid());
