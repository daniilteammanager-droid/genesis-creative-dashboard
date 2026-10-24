-- FB Tool источником расхода Facebook (Decision 071).
--
-- Ключ API FB Tool один на баера; в нём несколько аккаунтов FB, у каждого свои
-- кабинеты. Ходим только в API FB Tool: токены аккаунтов, которые он отдаёт в
-- get-accounts, с нашего сервера не трогаем никогда — у баеров свои прокси.
alter table public.buyer_connections
  add column if not exists fbtool_key_enc  text,
  add column if not exists fbtool_key_hint text,
  add column if not exists fbtool_set_at   timestamptz,
  -- Последнее известное состояние аккаунтов FB Tool: { "<id>": "ok" | "<ошибка>" } —
  -- память для алерта «аккаунт разлогинен» и «снова в строю».
  add column if not exists fbtool_accounts jsonb;
