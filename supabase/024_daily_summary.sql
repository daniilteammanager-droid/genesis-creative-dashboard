-- Утренняя сводка владельцу и тимлиду (Decision 066).
--
-- Какой слот сводки уже отправлен в эту привязку: «2026-10-25 10:00». Как
-- check_sent_slot у авточека — повторный прогон в ту же четверть часа второй
-- сводки не шлёт.
alter table public.telegram_links
  add column if not exists summary_sent_slot text;

-- Когда по строке последний раз был алерт о проблеме. Сводка считает именно их:
-- первое заполнение таблицы и новый баер со старыми банами — не события «за сутки».
alter table public.wh_cabinet_states
  add column if not exists alerted_at timestamptz;
alter table public.wh_rejected_ads
  add column if not exists alerted_at timestamptz;

-- Сводка вместо моментальных алертов — значит у владельца и тимлидов она должна
-- включиться сама, без похода в настройки. Остальные события не трогаем.
update public.telegram_links l
   set events = array_append(l.events, 'daily_summary')
  from public.profiles p
 where p.id = l.user_id and p.role in ('main', 'teamlead')
   and not ('daily_summary' = any(l.events));
