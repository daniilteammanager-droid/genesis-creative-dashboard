-- BM кабинета (18.11.2026): на каком Business Manager лежит кабинет — Даниил ведёт вериф кабинетов.
-- Пишет проверка кабинетов (lib/alerts/cabinets.ts, прогон склада раз в 15 минут) из Meta: BM-владелец
-- (business{id,name}), иначе BM, через который ключ видит кабинет. Dolphin и FB Tool BM не отдают — пусто.
-- Читает get_cabinets в AI-доступе. Скрипт идемпотентный.
alter table public.wh_cabinet_states
  add column if not exists bm_id text,
  add column if not exists bm_name text;
