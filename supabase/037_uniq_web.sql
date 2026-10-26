-- Уникализация из веба (Decision 083): задание из библиотеки — без объявления и без
-- чата (результат — ссылкой на странице «Антиотклон»). Скрипт идемпотентный.
alter table public.video_variant_jobs alter column ad_id drop not null;
alter table public.video_variant_jobs alter column account_id drop not null;
alter table public.video_variant_jobs alter column chat_id drop not null;
