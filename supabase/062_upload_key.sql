-- Каким ключом заливает автозалив (26.11.2026, Decision 130). У баера несколько приложений Meta в «Интеграциях»
-- (у Артёма 8), у каждого свой часовой лимит, а автозалив брал первый ключ с ads_management. Отметка for_upload —
-- каким заливать; её ставит AI-доступ (set_autoupload_key), когда у приложения кончился лимит. Одна на человека.
-- Нет отметки — как раньше: своё приложение автозалива, иначе первый ключ с ads_management (lib/autoupload/key.ts).
-- Выполнить после 061_entities_created.sql и до кода, который её читает. Идемпотентный.
alter table public.meta_keys add column if not exists for_upload boolean not null default false;
create unique index if not exists meta_keys_one_upload on public.meta_keys (user_id) where for_upload;
