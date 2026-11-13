-- Пополнения (13.11.2026): монета и сеть — два поля, новые монеты USDC, BTC, TRX и сеть BTC;
-- «В работе» — кто из платёжного чата взял заявку платить, чтобы второй не перевёл туда же.
-- Какая монета ходит в какой сети — проверяет код (PAIRS в lib/topups/chain.ts). Скрипт идемпотентный.

alter table public.topup_requests drop constraint if exists topup_requests_asset_check;
alter table public.topup_requests add constraint topup_requests_asset_check
  check (asset in ('USDT', 'USDC', 'BTC', 'GRAM', 'TRX'));

alter table public.topup_requests drop constraint if exists topup_requests_network_check;
alter table public.topup_requests add constraint topup_requests_network_check
  check (network in ('TRC20', 'ERC20', 'BEP20', 'BTC', 'TON'));

-- Кто в Telegram нажал «Беру в работу» и когда. Пусто — никто не взял.
alter table public.topup_requests add column if not exists taken_by text;
alter table public.topup_requests add column if not exists taken_at timestamptz;
