-- Пополнения (27.11.2026, Decision 132): комиссия процентом — «из суммы» (платёжка снимает с перевода) или «сверху»
-- (агент добавляет к бюджету). amount — по-прежнему сколько переводим (по нему ищется перевод), fee — комиссия суммой,
-- зайдёт / на бюджет = amount − fee. Пусто — комиссия без процента, как у всех заявок до 27.11.2026. Скрипт идемпотентный.

alter table public.topup_requests add column if not exists fee_mode text;
alter table public.topup_requests add column if not exists fee_pct numeric;
alter table public.topup_requests drop constraint if exists topup_requests_fee_mode_check;
alter table public.topup_requests add constraint topup_requests_fee_mode_check
  check (fee_mode is null or (fee_mode in ('deduct', 'top') and fee_pct > 0 and fee_pct < 100));
