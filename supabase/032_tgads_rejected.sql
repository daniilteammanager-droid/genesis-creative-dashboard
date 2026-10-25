-- Отклонённые объявления Telegram Ads (Decision 075). Кабинет TG не лежит в
-- wh_account_owners — он принадлежит владельцу ключа, поэтому владелец пишется
-- в саму строку. У кабинетов Facebook колонка пустая: владелец — из wh_account_owners.
-- Скрипт идемпотентный.
alter table public.wh_rejected_ads add column if not exists owner_user_id uuid references public.profiles(id) on delete set null;
