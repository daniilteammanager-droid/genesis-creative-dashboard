-- Куда именно пополняем: вторая ступень после категории (Decision 072).
-- Скрипт идемпотентный.
alter table public.topup_requests add column if not exists target text not null default '';
