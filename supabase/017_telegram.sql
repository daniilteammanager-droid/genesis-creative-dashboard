-- ============================================================================
--  Общий Telegram-бот команды. Выполнить после 016_torro_api.sql.
--  Скрипт идемпотентный.
-- ============================================================================
--
--  Бот один на команду, токен в env. Человек привязывает к своему профилю
--  личный чат, группу или тему в группе — сколько угодно. В каждую привязку
--  бот шлёт только выбранные в ней уведомления.
--
--  Привязка идёт одноразовым кодом: дашборд выдаёт ссылку t.me/<бот>?start=<код>,
--  бот получает код и связывает чат с тем, кто его выписал. Чат id человек
--  руками не вводит и подделать чужой не может: код знает только он.

create table if not exists public.telegram_links (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  chat_id     bigint not null,
  -- Тема форум-группы. null — личный чат или группа без тем.
  thread_id   bigint,
  chat_type   text not null check (chat_type in ('private', 'group', 'supergroup')),
  title       text,
  -- Кто в Telegram нажал ссылку. Отвязать из чата может он или админ группы.
  tg_user_id  bigint,
  -- Какие уведомления слать сюда. Пустой массив — привязка молчит, но жива.
  events      text[] not null default '{}',
  created_at  timestamptz not null default now()
);

-- Одна и та же тема одного чата — одна привязка у человека. Повторная активация
-- обновляет её, а не плодит дубль, из-за которого каждое сообщение пришло бы дважды.
create unique index if not exists telegram_links_unique
  on public.telegram_links (user_id, chat_id, coalesce(thread_id, 0));

create index if not exists telegram_links_by_chat on public.telegram_links (chat_id);

create table if not exists public.telegram_link_codes (
  code        text primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

-- Только сервер, сервисным ключом: чат id и коды привязки браузеру не нужны.
alter table public.telegram_links      enable row level security;
alter table public.telegram_link_codes enable row level security;
revoke all on public.telegram_links      from anon, authenticated;
revoke all on public.telegram_link_codes from anon, authenticated;
