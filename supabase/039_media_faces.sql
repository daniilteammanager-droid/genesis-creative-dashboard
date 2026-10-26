-- Лицо креатива (Decision 086): Роман или Рики — как «владелец библиотеки» в Genesis
-- Manager Артёма. Ставится при загрузке в Медиатеку, по нему вкладки в автозаливе.
-- По ключу R2, а не по коду крео: строку creative_uploads переписывает любой, кто
-- запросил ссылку с тем же кодом. Переименование и удаление в Медиатеке ведут строку следом.
-- Только сервер (service role). Скрипт идемпотентный.
create table if not exists public.media_faces (
  object_key text primary key,
  face       text not null check (face in ('ROMAN', 'RICKY')),
  set_by     uuid references public.profiles(id) on delete set null,
  set_at     timestamptz not null default now()
);
alter table public.media_faces enable row level security;
revoke all on public.media_faces from anon, authenticated;
