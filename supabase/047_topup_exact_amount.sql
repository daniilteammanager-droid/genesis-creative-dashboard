-- Сумма заявки — до последнего знака (29.10.2026). numeric(14, 2) округлял 1000.4531 до
-- 1000.45, а платёжки узнают перевод по точной сумме. 9 знаков — у GRAM (TON), у USDT 6.
-- Расширение типа старые значения не меняет. Скрипт идемпотентный.

alter table public.topup_requests
  alter column amount type numeric(24, 9),
  alter column fee type numeric(24, 9),
  alter column paid_amount type numeric(24, 9);
