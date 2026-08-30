-- ============================================================================
--  Склад данных. Выполнить после 008_uploads.sql. Скрипт идемпотентный.
-- ============================================================================
--
--  Зачем: сейчас каждый открытый отчёт обходит все рекламные кабинеты и тянет
--  выгрузки целиком. Лимит Meta тратится пропорционально тому, как часто люди
--  смотрят отчёты. Со складом он тратится пропорционально времени: один обход
--  по крону, сколько бы человек ни смотрело (Decision 040).
--
--  Правила, на которых построены эти таблицы:
--   - только базовые числа, никаких ROMI и CPM: производные считаются из сумм
--     на чтении, иначе вернётся болезнь формул в Google-таблицах (Decision 024);
--   - охватов нет вовсе: reach не складывается по дням, а склад суммирует
--     дневные строки за период (Decision 039);
--   - клики Meta и клики Torro лежат в РАЗНЫХ таблицах и не могут слипнуться:
--     это клик по объявлению против клика на лендинге (Decision 039);
--   - депозиты — четыре числа, обычные и повторные раздельно (Decision 039);
--   - загрузка всегда upsert по скользящему окну, никогда не append: депозиты
--     дозревают около восьми дней и меняют прошлые дни задним числом.

-- ─── Meta: объявления по дням ────────────────────────────────────────────────
-- Самая мелкая нужная гранулярность. Разрезы по адсетам и кампаниям — это
-- group by по этой же таблице, без единого дополнительного вызова API.
create table if not exists public.wh_ad_days (
  -- Чьими ключами добыта строка. У двух баеров с общим кабинетом будут свои
  -- строки на одно объявление — и это верно: каждый видит свою картину.
  user_id       uuid not null references public.profiles(id) on delete cascade,
  date          date not null,
  ad_id         text not null,
  -- Имя хранится как есть, без нормализации: оно же ключ стыка с CRM
  -- (Decision 020). Разбор кода происходит на чтении.
  ad_name       text not null,
  adset_id      text,
  adset_name    text,
  campaign_id   text,
  campaign_name text,
  account_id    text,
  account_name  text,
  spend         numeric(14,2) not null default 0,
  clicks        integer       not null default 0,
  impressions   bigint        not null default 0,
  updated_at    timestamptz   not null default now(),
  primary key (user_id, date, ad_id)
);

create index if not exists wh_ad_days_by_name on public.wh_ad_days (user_id, ad_name, date);
create index if not exists wh_ad_days_by_campaign on public.wh_ad_days (user_id, campaign_id, date);

-- ─── Meta: кампании по дням ──────────────────────────────────────────────────
-- Не второй равноправный источник, а дешёвая сверка полноты: один вызов на
-- кабинет против многих на уровне объявлений.
--
-- Замер 31.08.2026 на живых данных (27 кабинетов, неделя, $13 300): разница с
-- суммой по объявлениям — ноль. Документация Meta говорит, что архивные и
-- удалённые объявления выпадают из выдачи уровня ad, оставаясь в агрегате
-- кампании; на этих данных команда ставит на паузу, а не архивирует. Пока
-- разница ноль — это доказательство полноты. Станет не ноль — увидим сразу,
-- а не потеряем тихо (Decision 041).
create table if not exists public.wh_campaign_days (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  date          date not null,
  campaign_id   text not null,
  campaign_name text,
  account_id    text,
  spend         numeric(14,2) not null default 0,
  clicks        integer       not null default 0,
  impressions   bigint        not null default 0,
  updated_at    timestamptz   not null default now(),
  primary key (user_id, date, campaign_id)
);

-- ─── Torro: объявления за период ─────────────────────────────────────────────
-- Ключ здесь ПЕРИОД, а не день, и это не временное упрощение.
--
-- Выгрузка Torro отдаёт лист на период: сегодня это неделя, дневных выгрузок
-- пока не существует. Хранить недельное число как дневное значило бы придумать
-- данные. Когда выгрузки станут дневными, period_start = period_end, и ни схема,
-- ни запросы не меняются.
--
-- В выгрузках есть служебные листы «download» и «All Data» — они не периоды и
-- при загрузке пропускаются. Имя листа дневной выгрузки — дата (2026-08-31),
-- недельной — диапазон (2026-08-24_2026-08-30).
--
-- Следствие для интерфейса: если запрошенный диапазон разрезает период CRM
-- пополам, депозиты за него показать НЕЛЬЗЯ. Расход показывается точно, а на
-- месте депозитов — прочерк с объяснением. Разложить недельное число по дням
-- пропорционально — ровно тот способ получить правдоподобную и неверную цифру,
-- от которого мы уходим во всём проекте.
create table if not exists public.wh_crm_ad_periods (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  period_start  date not null,
  period_end    date not null,
  ad_name       text not null,
  -- Колонки НЕ not null, и это принципиально. Набор колонок у выгрузок разный:
  -- в дневной по крео есть клики и регистрации, но нет отписок; в дневной по
  -- кампаниям нет ни кликов, ни регистраций; в недельных наоборот. Замерено
  -- 31.08.2026.
  --
  -- Значит null и 0 — разные вещи: null это «колонки не было в выгрузке»,
  -- 0 это «выгрузили и там ноль». Записать ноль вместо отсутствия значило бы
  -- утверждать, что регистраций не было, хотя про них просто не спрашивали.
  clicks        integer,        -- клик на лендинге, НЕ клик по объявлению
  subscribers   integer,
  dialogs       integer,
  registrations integer,
  dep_count     integer,
  dep_sum       numeric(14,2),
  redep_count   integer,
  redep_sum     numeric(14,2),
  unsubscribes  integer,
  updated_at    timestamptz not null default now(),
  primary key (user_id, period_start, ad_name)
);

-- ─── Torro: объявления по id за период ───────────────────────────────────────
-- Отдельная таблица, а не колонка рядом с by-name: у выгрузок разная гранулярность.
-- Строка by-name предагрегирована по имени и между объявлениями не делится, поэтому
-- депозиты на конкретном объявлении и на адсете можно получить ТОЛЬКО отсюда.
--
-- Две таблицы дают ещё и сверку: сумма by-id, сгруппированная по имени, должна
-- сойтись со строкой by-name. Расхождение — это либо переименование объявления в
-- кабинете (by-name ломается молча, by-id переживает), либо пропущенный прогон.
create table if not exists public.wh_crm_ad_id_periods (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  period_start  date not null,
  period_end    date not null,
  ad_id         text not null,
  clicks        integer,
  subscribers   integer,
  dialogs       integer,
  registrations integer,
  dep_count     integer,
  dep_sum       numeric(14,2),
  redep_count   integer,
  redep_sum     numeric(14,2),
  updated_at    timestamptz not null default now(),
  primary key (user_id, period_start, ad_id)
);

-- ─── Torro: кампании за период ───────────────────────────────────────────────
create table if not exists public.wh_crm_campaign_periods (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  period_start  date not null,
  period_end    date not null,
  campaign_id   text not null,
  campaign_name text,
  -- Те же правила про null, что и в таблице выше.
  clicks        integer,
  subscribers   integer,
  dialogs       integer,
  registrations integer,
  dep_count     integer,
  dep_sum       numeric(14,2),
  redep_count   integer,
  redep_sum     numeric(14,2),
  updated_at    timestamptz not null default now(),
  primary key (user_id, period_start, campaign_id)
);

-- ─── Журнал прогонов ─────────────────────────────────────────────────────────
-- Без него молчаливый отказ крона неотличим от «данных не было». А отличать
-- надо: пустой отчёт и сломанная загрузка выглядят одинаково (Decision 018).
create table if not exists public.wh_ingest_runs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.profiles(id) on delete cascade,
  kind          text not null check (kind in ('today', 'window')),
  since         date,
  until         date,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  ad_rows       integer,
  campaign_rows integer,
  crm_rows      integer,
  -- Сколько кабинетов не прочиталось. Ненулевое значение означает неполные
  -- данные, и такой прогон не должен выдавать себя за успешный.
  failed_accounts integer,
  error         text
);

create index if not exists wh_ingest_runs_recent on public.wh_ingest_runs (user_id, started_at desc);

-- ─── Доступ ──────────────────────────────────────────────────────────────────
-- Склад недостижим из браузера вообще: читают его серверные роуты сервисным
-- ключом, они же решают, кому что положено (Decision 035). Политики строк тут
-- не нужны — прав нет ни у кого.
alter table public.wh_ad_days              enable row level security;
alter table public.wh_campaign_days        enable row level security;
alter table public.wh_crm_ad_periods       enable row level security;
alter table public.wh_crm_ad_id_periods    enable row level security;
alter table public.wh_crm_campaign_periods enable row level security;
alter table public.wh_ingest_runs          enable row level security;

revoke all on public.wh_ad_days              from anon, authenticated;
revoke all on public.wh_campaign_days        from anon, authenticated;
revoke all on public.wh_crm_ad_periods       from anon, authenticated;
revoke all on public.wh_crm_ad_id_periods    from anon, authenticated;
revoke all on public.wh_crm_campaign_periods from anon, authenticated;
revoke all on public.wh_ingest_runs          from anon, authenticated;
