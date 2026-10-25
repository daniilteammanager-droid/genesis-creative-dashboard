-- Уникализация видео — четвёртая кнопка антиотклона (Decision 076).
--
-- Кнопка под алертом создаёт задание, выбор вставки и крайних кадров — в боте.
-- Монтирует воркер на VPS (FFmpeg, код Артёма): берёт задание через /api/uniq,
-- качает исходник v1 из R2 по подписанной ссылке, кладёт результат обратно в R2.
-- Дашборд загружает видео в кабинет и подменяет креатив в объявлении ключом
-- владельца. Скрипт идемпотентный.

create table if not exists public.video_variant_jobs (
  id            uuid primary key default gen_random_uuid(),
  ad_id         text not null,
  account_id    text not null,
  owner_id      uuid not null references public.profiles(id) on delete cascade,
  chat_id       bigint not null,
  thread_id     bigint,
  source_key    text not null,         -- исходник v1 в R2
  source_name   text not null,
  tail_type     text not null default 'nature',
  frame_type    text not null default 'nature',
  -- choosing → queued → processing → ready → replacing → done | failed
  status        text not null default 'choosing',
  stage         text,
  error         text,
  result_key    text,                  -- готовое видео в R2
  duration      numeric,
  bytes         bigint,
  meta          jsonb,                 -- что вышло в Meta: видео, креатив, статус
  -- Повторы не нужны: длительность и материалы прошлых результатов воркер помнит сам.
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists video_variant_jobs_open on public.video_variant_jobs (status, created_at)
  where status in ('queued', 'processing', 'ready', 'replacing');

alter table public.video_variant_jobs enable row level security;
revoke all on public.video_variant_jobs from anon, authenticated;
