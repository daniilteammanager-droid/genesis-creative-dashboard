-- Telegram Ads — параллельно источнику Facebook, а не вместо него (Decision 069).
--
-- Правило «один источник расхода» (Decision 061) — про Facebook: Meta, FB Tool
-- и Dolphin видят одни и те же кабинеты, два сразу задвоили бы расход. TG Ads —
-- другая площадка, пересекаться там нечему. Поэтому у TG Ads своя догрузка
-- истории, а spend_source остаётся только про Facebook.
alter table public.buyer_connections
  add column if not exists tgads_backfilled_from date,
  add column if not exists tgads_backfill_done   boolean not null default false;

-- Прогресс TG Ads, накопленный в общих полях, переносим в свои.
update public.buyer_connections
   set tgads_backfilled_from = spend_backfilled_from, tgads_backfill_done = spend_backfill_done,
       spend_source = null, spend_backfilled_from = null, spend_backfill_done = false
 where spend_source = 'tgads';

alter table public.buyer_connections drop constraint if exists buyer_connections_spend_source_check;
alter table public.buyer_connections add constraint buyer_connections_spend_source_check
  check (spend_source in ('meta', 'fbtool', 'dolphin'));
