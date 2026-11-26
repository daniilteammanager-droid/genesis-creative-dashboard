-- Когда объект создан в Meta (26.11.2026): дата создания кампании, адсета и объявления — в get_campaigns AI-доступа
-- (попросил баер). Пишет часовой прогон объектов (lib/warehouse/entities.ts, created_time из Meta); у FB Tool и TG Ads — пусто.
-- Выполнить после 060_junior.sql и до кода, который её пишет. Идемпотентный.
alter table public.wh_entities add column if not exists created_time timestamptz;
