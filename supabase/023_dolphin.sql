-- ============================================================================
--  Dolphin Cloud как источник расхода (Decision 063). Выполнить после
--  022_account_conflicts.sql. Скрипт идемпотентный.
-- ============================================================================
--
--  Ключ API Dolphin — свой у каждого баера, шифротекстом, как ключи Meta.
--  Источник расхода у человека один (Decision 061): spend_source = 'dolphin'.
--
--  Даты создания у Dolphin нет (у объявлений одна заглушка на всех), поэтому
--  догрузка истории останавливается, когда несколько кусков подряд пустые.

alter table public.buyer_connections
  add column if not exists dolphin_token_enc  text,
  add column if not exists dolphin_token_hint text,
  add column if not exists dolphin_set_at     timestamptz,
  -- Сколько кусков догрузки подряд оказались пустыми.
  add column if not exists spend_backfill_empty integer not null default 0;
