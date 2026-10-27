# Genesis Creative Dashboard — AGENTS.md

This file contains project-specific development rules and has higher priority than generic framework assumptions.

---

# Project Overview

Genesis Creative Dashboard is an internal web application for the Genesis Academy media buying team.

Its purpose is to centralize creative assets, performance analytics, internal knowledge and operational tools into a single workspace.

This project is an internal production tool, not a public SaaS.

Long-term vision:

Genesis Creative Dashboard → Creative Intelligence Platform → Media Buying OS.

---

# Current Project Status

Status: Production MVP v2

Implemented:

- Creative Library
- Analytics Dashboard
- Check Module (Forex Check)
- Reports — дерево кампания → адсет → объявление и таблица по креативам (из склада)
- Креативы — новая картотека на складе, фильтры по баеру и стране
- Checks — живой чек (Meta за сегодня, склад за прошлое) и ручной по XLSX
- Склад данных (`wh_*`) и загрузка по крону через `/api/ingest`
- Авторизация, роли, приглашения, подключения баеров
- General Report 3.0 (Google Sheets API)
- General Report 4.0 — плоский формат таблиц: общая таблица и таблицы баеров
- Upload Module (bulk upload в R2 через presigned URL)
- Медиатека (rename / delete / диагностика "не загружено")
- Favorites
- Notes
- Transcriptions
- Charts (recharts)
- Virtualized Grid
- Branded Loading Screen
- Supabase Integration
- Cloudflare R2 Integration

Currently in development:

- Первые подключения баеров — склад пока пуст
- Автозапись General Report 3.0 в основную таблицу
- Creative Automation

Handled outside this repo:

- Сжатие видео, генерация thumbnails и RU-транскрипции делает отдельный worker,
  который сам опрашивает R2 по крону. Дашборд только загружает исходный файл.

---

# Tech Stack

Frontend

- Next.js (App Router)
- React
- TypeScript
- TailwindCSS

Backend

- Next.js API Routes

Storage

- Cloudflare R2
- Supabase

Deployment

- Vercel

---

# Main Modules

## Оболочка приложения

`components/Shell.tsx` в `app/layout.tsx`.

Слева рабочие области — Легаси крео, Креативы, Checks, Reports, General 4.0, Автозалив, Антиотклон, Уникализация, Пополнения. General 3.0 из
панели убран (им не пользуются, 26.10.2026), роут `/general-report` живой.
Баеру на «Легаси крео» не показывается Медиатека — его Медиатека в Креативах (Decision 077).
Внизу кнопка аккаунта, она ведёт в `/settings`.

Поверх оболочки — обучалка-тур (`components/Onboarding.tsx`, шаги в `lib/onboarding/steps.ts`): подсвечивает
блок с `data-tour="…"`, рядом подсказка; «нажми»-шаг ждёт клика по блоку (раздел в меню — переход), остальные —
«Дальше». Открывается, пока в профиле пустой `onboarded_at` (новые и все, кто был до неё, — один раз).
Повтор — Настройки → Профиль. Новая рабочая область — шаги в steps.ts и `data-tour` на её блоки (Decision 078).

Правило: в панели только рабочие области. Всё служебное — вкладкой в настройках,
а не пунктом в панели. Страница своё меню не рисует.

---

## Settings

Route: `/settings`

Всё, что за кнопкой аккаунта:

- Профиль — имя, смена пароля, повтор обучалки, выход
- Интеграции — источник расхода Facebook (ровно один: Meta с несколькими ключами, Dolphin Cloud
  или FB Tool) и параллельно Telegram Ads (кабинет на строку: название + ключ, лицо — в названии),
  Torro по API (ключ и id баера), Telegram
  (привязки чатов и выбор уведомлений), таблица GR3 (пока заглушка)
- Команда — роли, коды баеров, отключение (только владелец)
- Приглашения — одноразовые ссылки (только владелец)

Проверка роли стоит на сервере в самих страницах. Скрытая вкладка — не защита.

---

## Creative Dashboard (легаси)

Route: `/`

Main workspace.

Contains:

- Creative Library
- Search
- Filters
- Favorites
- Notes
- Transcriptions
- Creative Modal
- Media Preview

---

## Креативы (новая картотека)

Route: `/creatives`

Два вида переключателем: **Плитка** (по умолчанию) и **Таблица**.

- Плитка — то же, что легаси-библиотека, но за выбранный период: превью из R2,
  poster вместо видео, клик открывает общий модал с расшифровкой и заметкой.
- Таблица — та же, что в Reports «По креативам», для сравнения цифр столбцом.
  Как в «Дашборде» Артёма: склейка «Как есть / Склеить версии / Версии и GEO вместе» (вся связка креатива одной
  строкой, клик раскрывает «код · GEO · лицо»), поиск по коду, сортировка кликом по заголовку, карточки
  «расход / ПДП и цена / ДИА и цена / депы и цена депа / сумма депов и профит / ROMI и ROAS».

Файл к строке ищется по всему бакету (Decision 036): старым форматом льют до сих
пор. Кроме папок других баеров — их баеру не видно (Decision 077). Нет файла —
строка помечается «файл не загружен», на цифры это не влияет.

Собирается по коду крео из расхода источника, Torro по API и файлов в R2.
Ждёт склада данных. Легаси-библиотека на `/` не трогается.

---

## Analytics

Contains:

- Summary Cards
- Charts
- Winners
- Losers
- Tests
- Spend
- Revenue
- ROMI
- Deposits

---

## Check Module

Independent module.

Route: `/check`. Два режима переключателем:

- **Живой** — чек за период в трёх разрезах (кампании, креативы, страны) плюс
  готовый текст для телеги. Всегда поделён по лицам из имени кампании: блок лица
  с итогом, внутри — строки разреза (Decision 065). Над лицами — площадка (Facebook,
  TG Ads), если подключено больше одной; подключена без расхода — «расхода нет» (Decision 069). Сегодня — живая Meta по подключениям, другой период —
  склад (Decision 040). «Сегодня» считается по Москве (Decision 046).
- Под блоком Facebook — общие резы: Испания, Латам и весь FB (регион — по стране разреза или гео в имени кампании / креатива).
  Упавший источник (ключ Meta, FB Tool, Torro баера) не роняет чек целиком — его цифр нет, это сказано в предупреждении.
- «Формат Артёма» (Decision 090, разрез по кампаниям, `lib/warehouse/checkArtem.ts`): блоки Латам / Испания TG / WA /
  Другие GEO с бюджетом «постоянный + тест», внутри «Страна · Лицо» и разделы «Активные / Проблемные активные
  (Причина: пороги) / Стопнутые / Бан», итоги блоков с ПДП/ДИА, общий итог, TG Ads, «Неразобранное (Торро)»,
  «Только активные». Статус — живой из Meta или последний из `wh_entities`, бан — по кабинету. Есть и в расписании авточека.
- «Отправить в Telegram» — готовый чек в свои чаты с уведомлением «Чек по расписанию»; «История чеков» —
  всё отправленное, кнопкой и по расписанию (`check_log`, Decision 082).
- **Ручной** — сверка загруженных руками XLSX: FB Tool, MVP, диагностика
  несовпадений. Работает целиком в браузере и ни от чего не зависит — поэтому и
  остаётся запасным путём.

Ручной режим должен оставаться независимым от склада и подключений.

---

## Reports

Route: `/reports`

Аналог FB Tool, читает **только склад** — в Meta и Sheets на открытие отчёта не ходит.

Два вида:

- **По кампаниям** — дерево кампания → адсет → объявление с разворачиванием. Столбцы — как в
  General 4.0, кроме CPA/IB. Torro клеится по имени: кампания — срезом Torro по имени, объявление —
  связкой «кампания × объявление» (`wh_crm_pairs`, свой крон `kind=pairs`); кампании только из Torro
  (кабинет не подключён) — внизу, в итог не идут (Decision 070).
- **Live Manager** в дереве кампаний (Decision 079): статус и дневной бюджет каждой строки — вживую из
  кабинета, переключатель запуска/паузы, галочки и «Запустить / Пауза / Бюджет» для выбранных, фильтры GEO
  и лицо, «Live» — автообновление, «Обновить сейчас» — свежий расход за сегодня в склад, выбор столбцов.
  Пишет `lib/reports-live/manage.ts`: Meta — ключом владельца кабинета с ads_management, Dolphin — его API;
  FB Tool не умеет. Менять может владелец кабинета и владелец дашборда. Это единственное место, где
  Reports ходит в Meta: статусы — живые, цифры — по-прежнему склад. Плюс, как у Артёма: уровни «Дерево /
  Кампании / Адсеты / Объявления», поиск (название, ID, кабинет), фильтр статуса, сортировка, карточки итогов
  видимого, лента кабинетов (закрепить, своё название, скрыть; пропавший — «ПРОПАЛ», строки с последним
  статусом «· история» из `wh_entities`), закреплённые строки, наборы столбцов (в браузере). Столбцы охвата,
  частоты, кликов по ссылке и результатов: охват за один день — из склада, за период — живьём из Meta (Decision 089).
- **По креативам** — таблица по имени объявления, общая с разделом Креативы. Столбцы те же, что в
  дереве (`app/reports/columns.ts`), Torro — по имени объявления.

Деления на Auto и Manual больше нет: ручная сверка живёт в Checks.

---

## General Report 3.0

Route: `/general-report`

Агрегация байерских и страновых Google-таблиц через Sheets API v4.

Два уровня переключателя источников:

- общие таблицы: EU, LATAM, WA;
- байерские: Сводная и по одной на баера — из поля таблицы в его профиле
  (страница «Команда»). В env байерских таблиц нет.

Гранулярность: день / неделя / месяц. Все производные метрики считаются из сумм,
а не берутся из формул таблицы.

---

## General Report 4.0

Route: `/general-report-4`

Читает **свою базу** (`gr4_snapshots`, Decision 084): каждая таблица (общая и таблицы баеров) раз в 15 минут
перечитывается по Sheets API кроном `kind=gr4`, кнопка «Обновить из таблиц» — сейчас. Последняя ошибка чтения
показывается, а на экране остаётся прежний снимок.

Две вкладки. **Отчёт** (владелец и тимлид — где есть общая таблица): как лист «Отчёт» общей таблицы —
период и фильтры, ключевые цифры со сравнением с прошлым периодом той же длины и целями из «Настроек»,
динамика спенда и дохода, баеры (спенд, Torro, доход по факту, ROMI, цены, CR, депы), разбивка по любому
разрезу. Выплаты из «Депов» (по направлению, без баера) раскладываются по баерам по их Torro внутри
направления «лицо + регион» — как «Факт выплат» финансовой таблицы (`allocate.ts`). Подсветка ячеек —
`tone.ts`: ROMI от 130% зелёный, 100–129% жёлтый, 100% и ниже красный; цены — к цели «Настроек», до +20% жёлтый.
**Таблица** — прежний вид ниже.

Новый плоский формат таблиц: одна строка = день × связка, разрезы — колонки
(лицо, язык, гео, регион, источник, площадка, воронка, баер). Читает общую таблицу
(`gr_spreadsheets`, `kind = 'v4'`: Трафик, Депы, CRM итоги) или таблицу баера
(`profiles.gr4_spreadsheet_id`: Ввод, История). Баер видит только свою.

Фильтры с мультивыбором, строки по дням / неделям / месяцам / за весь период,
разбивка внутри периода, сравнение с прошлым периодом, подсветка целей из листа
«Настройки». Суммы и производные — общий `computeTotals` из GR 3.0. Живёт рядом
с 3.0 (Decision 053).

Колонки листов ищутся по заголовку первой строки, а не по номеру: в таблицы вставляют
колонки. Квалификация A–E (сегменты CRM) — после депов и дохода: квалы, неквалы, A–E и
доли. «CRM итоги» заполняет автодобор из Torro вне этого репозитория (Decision 054).
Площадка — второй слой под источником (УБТ → YouTube/TikTok/Instagram), колонка «Площадка»;
пусто — у строки площадки нет.
«Сводная по баерам» (источник `buyers`, владельцу и тимлиду при ≥2 баерах): route склеивает таблицы всех
баеров (каждая из своего кэша), разрез «Баер» остаётся; доход — как внесли баеры.

---

## Пополнения

Route: `/topups`

Заявки на пополнение кабинетов, платёжек и агентов (Decision 072). Заявку создаёт любой, все поля
обязательны: категория → куда именно (список в `lib/topups/requests.ts`, «Другое» — чего нет в списке), сумма, комиссия (нет — 0), сеть (USDT TRC20/TON/BEP20/ERC20, GRAM), адрес получателя,
время на оплату, комментарий (нечего добавить — «-», и для «Другое» тоже). Она уходит **отдельным Top-Up ботом** (`TOPUP_BOT_TOKEN`) в один платёжный чат владельцев —
его привязывает владелец ссылкой со страницы. В чате «Оплачено» → бот ищет перевод на адрес
получателя на сумму с комиссией или без — всё без ключей: TRC20 — TronGrid, TON — toncenter, BEP20 —
узел BSC publicnode (с токеном `BSC_RPC_URL` — сутки назад, без него ~75 минут), ERC20 — Ethplorer; нашёл — заявка закрыта хэшем. Не нашёл —
хэш ответом на сообщение заявки. Хэш можно прислать и ссылкой
обозревателя — сумма перевода берётся из блокчейна. Ответом на заявку бот кладёт QR для оплаты (Decision 088): TON — ссылкой ton://transfer с суммой и монетой, остальные сети — только адрес. Заявка закрыта или срок вышел — QR удаляется. Срок вышел — адрес убирается из сообщения.
Бот работает только в платёжном чате: автору в Telegram ничего не шлём, статус, хэш и ссылка на
транзакцию — в списке на странице (Decision 073). Владелец видит все заявки, остальные — свои. Крон `kind=topups` раз в минуту: сроки и поиск.

---

## Антиотклон

Route: `/antireject` (Decision 083)

Как вкладка Артёма (Decision 091): отклонённые объявления своих кабинетов (владелец и тимлид — все) с причиной
и ссылкой в Ads Manager; у каждого — замена ссылки (лендинги Torro той же воронки на другом домене), ФП и
Multi-advertiser прямо здесь: варианты → изменение под одноразовым кодом → «Подтвердить» (`lib/antireject/web.ts`,
тот же путь, что кнопки в боте); уникализация с заменой видео в объявлении. «Проверить сейчас» — поиск отклонённых
по своим кабинетам Meta, не дожидаясь прогона. История — новые отклонения и все действия из бота, со страницы и
уникализации (`antireject_events`, `lib/antireject/events.ts`). Список лендингов Torro.

## Уникализация

Route: `/uniquify` (Decision 091) — видео из своей Медиатеки: лицо, поиск, «только исходники v1», предпросмотр,
вставка и кадры; задания из дашборда и Telegram с «Скачать» и «Повторить». Очередь та же, что у бота (Decision 076).

---

## Автозалив

Route: `/autoupload` (Decision 081)

Сборщик кампаний Meta один в один с Genesis Manager Артёма (Decision 087): свои живые кабинеты (за кем
закреплены; только ACTIVE без ограничений, «Обновить кабинеты» — статусы вживую из Meta, Decision 085),
общий пиксель (есть во всех выбранных), FP по умолчанию, дата, нумерация, бюджет по умолчанию, 1‑1‑1,
«на паузе». Общий набор адсетов (BROAD / INT / RETARGET, метка) с креативами из своей Медиатеки (окно как
у Артёма: вкладки Роман / Рики, папки «подход → версия») уходит в каждую кампанию. У каждой кампании свои
GEO, лицо, воронка, маркер, лендинг, ссылка MVP (последние пять своей серии Torro: Рики / Испания / Латам),
FP, бюджет (CBO), bid cap, время старта на каждый кабинет и шаблоны имён кампании и адсетов. В 1‑1‑1
строки — сеты: по кампании на «адсет × креатив», кампании сета раскрываются, правятся по отдельности
(правка сета доезжает до неправленых полей) и убираются; сет дублируется целиком (`sets.ts`). Чек-лист
готовности, черновик формы в браузере.
Нейминг: `CAB####_ДД.ММ_ВОРОНКА_МАРКЕР_GEO_ЛЕНДИНГ_ЛИЦО_N` или свой шаблон с `{{CAB}} {{GEO}} {{N}}…`, адсет
`GEO_АУДИТОРИЯ[_МЕТКА]_TEST1`, объявление — код креатива с хвостом гео под страну (старые имена — как есть).
К ссылке — трекинг: id Torro баера, пиксель, макросы. Сборка — `lib/autoupload/plan.ts` (чистая, с
самопроверкой), создание — `launch.ts` проходами с арендой (`jobs.ts`, крон `kind=autoupload` раз в
минуту): видео уходят в Meta по ссылке R2 (оригинал из originals/), объекты создаются по одному и
записываются; оборванный запрос перед повтором ищет объект по имени, временный сбой Meta — до 3 повторов.
Bid cap — `LOWEST_COST_WITH_BID_CAP` на кампании и адсете, сумма на адсете в валюте кабинета; Instagram
страницы — в объявление. «Отменить и удалить» удаляет созданные кампании. Ключ — Meta с ads_management.

---

## Upload & Media Library

Загрузка крео напрямую в R2 по presigned PUT URL и Медиатека для управления
уже загруженными файлами.

---

# Current Architecture

Application structure:

Dashboard

↓

Analytics

↓

Check Module

↓

Business Logic (/lib)

↓

Cloudflare R2
Supabase
Google Sheets API
Meta Marketing API
CSV Analytics

Current performance features:

- TanStack Virtual
- React.memo
- useMemo
- useCallback
- Lazy Loading
- Poster Thumbnails
- Branded Loading Screen
- Graceful Supabase Fallback

---

# Architecture Rules

Business logic should be implemented inside `/lib` whenever practical.

React components should focus on rendering and interaction, not data processing.

Do NOT place:

- parsing
- matching
- aggregation
- heavy calculations

inside UI components.

Every major feature should become its own module.

---

# Folder Responsibilities

app/

Application pages and API routes.

components/

Reusable UI components.

lib/

Business logic. Одна папка на модуль:

- `lib/auth/` — сессия, профиль, проверка роли (`getProfile`, `requireRole`)
- `lib/creatives/` — код крео, CSV легаси-библиотеки, матчинг медиа
- `lib/forex-check/` — ручной чек
- `lib/warehouse/` — склад: загрузка (`ingest`), чтение, крео, дерево отчёта, чек
- `lib/connections/` — подключения баеров, шифрование токена, проверка доступа
- `lib/dolphin/` — Dolphin Cloud как источник расхода (только API самого Dolphin)
- `lib/fbtool/` — FB Tool как источник расхода Facebook: только API FB Tool, токены аккаунтов не трогаем;
  статистика вживую через аккаунты, разлогиненный — без данных и с алертом баеру
- `lib/fx.ts` — курс валют к доллару на день (TON, EUR) для расхода в складе
- `lib/tgads/` — Telegram Ads как источник расхода: расход по 5-минутным блокам в московские сутки,
  TON → USD по курсу Coinbase своего дня, страна из имени объявления
- `lib/reports-live/` — клиент Meta API, периоды, конфиг источников
- `lib/torro/` — клиент Torro MCP: статистика по дням, обход потолка в 100 строк
- `lib/telegram/` — общий бот команды: Bot API, привязки чатов, вебхук, `notify()` для уведомлений
- `lib/alerts/` — алерты в Telegram: состояние кабинетов, антиотклон (отклонённые объявления Facebook и
  TG Ads — статус «declined», алерт владельцу ключа) и
  авточек по расписанию привязки, утренняя сводка владельцу и тимлиду (`summary.ts`) — всё на прогоне
  склада «сегодня» (раз в 15 минут); `deliver.ts` — кому слать: алерты только баеру, чей кабинет
- `lib/antireject/` — кнопки антиотклона в боте: замена ссылки (лендинги Torro), ФП и Multi-advertiser,
  с подтверждением; пишет ключом Meta владельца кабинета с `ads_management`
- `lib/uniq/` — уникализация видео, четвёртая кнопка антиотклона (Decision 076): меню в боте
  (`bot.ts`), исходник v1 из R2 (`source.ts`), загрузка видео в кабинет и подмена креатива (`replace.ts`).
  Монтирует воркер на VPS (`/opt/genesis-uniq`, монтаж — код Артёма), очередь — `/api/uniq`
- `lib/autoupload/` — автозалив: сборка и нейминг (`plan.ts`), создание в Meta (`launch.ts`), очередь
  (`jobs.ts`), что выбрать в форме (`options.ts`)
- `lib/topups/` — заявки на пополнение: Top-Up бот (`bot.ts`), заявки и крон (`requests.ts`),
  поиск оплаты в блокчейне по адресу получателя (`chain.ts`)
- `lib/general-report/` — Google Sheets API, парсеры листов, агрегация
- `lib/general-report-4/` — GR 4.0: разбор плоских листов, фильтры, разбивка, источники
- `lib/day.ts` — «сегодня» по Москве для сервера и браузера
- `lib/supabase.ts` — единая точка входа в Supabase

supabase/

SQL-миграции. Выполняются руками в SQL-редакторе Supabase, по порядку номеров.

public/

Static assets.

scripts/

Developer utilities.

---

# Storage Rules

Cloudflare R2 stores only:

- images
- videos
- thumbnails
- variants/ — результаты уникализации (Decision 076): не крео библиотеки, Медиатека и воркер
  сжатия их пропускают
- originals/ — исходник крео до сжатия (Decision 080): воркер кладёт его перед тем, как заменить
  файл пережатой копией. Медиатека показывает лёгкую копию, автозалив и уникализация берут оригинал.
  Переименование и удаление в Медиатеке ведут оригинал следом. Загруженные до 26.10.2026 — только сжатые

Supabase stores:

- профили, роли, приглашения, подключения баеров, привязки Telegram
- склад `wh_*` — дневной расход (одна строка на день + объявление: расход, клики, клики по ссылке, показы,
  охват дня, результаты), Torro по API, кто владеет кабинетом, последнее состояние кабинетов (с последним
  настоящим статусом, если кабинет пропал) и объектов — кампаний, адсетов, объявлений (`wh_entities`, раз в час),
  известные отклонённые объявления для алертов. Ничего не удаляется: пропавший кабинет остаётся тем, что о
  нём знали последним (Decision 089)
- `topup_requests`, `topup_chat` — заявки на пополнение и платёжный чат Top-Up бота
- `video_variant_jobs` — задания уникализации видео (Decision 076)
- `autoupload_jobs` — задания автозалива: план, что создано, ход (Decision 081)
- `check_log` — отправленные в Telegram чеки: вручную и по расписанию (Decision 082)
- `antireject_events` — история антиотклона: новые отклонения и действия (Decision 091)
- `meta_keys` — ключи Meta, у человека их несколько (Decision 061)
- заметки и избранное (личные), транскрипции и `ignored` (общие)
- `creative_match_suffixes` — суффиксы для матчинга по базовому имени
- `media_faces` — лицо файла Медиатеки (Роман / Рики) по ключу R2, ставится при загрузке (Decision 086)

Склад критичен, остальное — нет. Граница проходит здесь, а не по сервису целиком:
без заметок дашборд работает, без склада отчёты пустые.

Google Sheets — источник истины для General Report 3.0 и 4.0: байерские и страновые
таблицы. Выгрузки Torro в таблицы больше не читаются — Torro только по API, чтобы
склад совпадал с CRM (Decision 061).

Meta Marketing API — источник истины по расходу, кликам, показам, статусам
**и по стране**: гео берётся из таргета адсета, а не из имени (Decision 045).
У баера на Dolphin Cloud расход идёт из API Dolphin, а страна — из нейминга:
таргета Dolphin не отдаёт (Decision 063).

CSV (опубликованная Google-таблица) remains the source of truth for the Creative
Library's all-time metrics.

---

# Performance Rules

Performance has higher priority than visual effects.

Always preserve:

- TanStack Virtual
- React.memo
- useMemo
- useCallback
- lazy loading
- poster thumbnails
- preload="none"

Never introduce rendering that scales with total creative count.

The dashboard should remain responsive with thousands of creatives.

---

# Supabase Rules

Supabase is NOT a critical dependency.

If Supabase becomes unavailable:

Dashboard MUST continue working.

Unavailable features:

- Notes
- Favorites
- Transcriptions

Everything else should continue functioning normally.

---

# Check Module Rules

Facebook Tool is the source of truth.

If a campaign exists in Facebook Tool but not in MVP:

Keep it in the report.

Set:

- PDP = 0
- DIA = 0

Diagnostics belong only inside Diagnostics / Mismatches.

Never mix diagnostics with the final Check report.

---

# UI Rules

Keep the interface clean.

Avoid unnecessary animations.

Avoid visual clutter.

Respect the existing Genesis branding.

Extend existing components whenever possible instead of replacing them.

Do not redesign existing UI without a clear reason.

---

# Coding Standards

- Use TypeScript.
- Keep components small.
- Keep functions focused.
- Prefer composition over large components.
- Avoid duplicated code.
- Reuse existing utilities whenever possible.
- Write readable code before clever code.

---

# Development Rules

Prefer extending existing modules instead of rewriting them.

Never rewrite working code without a clear reason.

Minimize breaking changes.

Keep commits focused on one logical feature.

Preserve backward compatibility whenever practical.

---

# When Making Changes

Before modifying existing code:

1. Understand the current implementation.
2. Change the smallest amount of code possible.
3. Preserve existing behavior.
4. Avoid unnecessary refactoring.
5. Keep the UI consistent.
6. Reuse existing architecture.
7. Explain what changed after implementation.

---

# Documentation

Документация проекта живёт в Notion — **Genesis Wiki** (Genesis Hub → Traffic Team → Genesis Creative Dashboard):

https://app.notion.com/p/393b916ff39280f18ad3ef8b6a099d3f

Структура вики:

| Страница | Что описывает |
|---|---|
| 1. Product Overview | Что за продукт, статус, цели |
| 2. Architecture | Модули, слои, data flow |
| 3. Folder Structure | Реальная раскладка `app/`, `lib/`, `components/` |
| 4. Development Guide | Принципы и workflow разработки |
| 5. Database & Storage | R2, Supabase, Google Sheets, матчинг медиа |
| 6. API Reference | Все API routes проекта |
| 7. Check Module | Checks (`/check`): живой чек и ручной |
| 8. Performance Decisions | Почему приняты те или иные оптимизации |
| 9. Roadmap | Что сделано, что в планах |
| 10. Decision Log | Архитектурные решения и их причины |
| 11. Reports Module | `/reports`: дерево РК и таблица по креативам из склада |
| 12. General Report 3.0 | `/general-report`: Google Sheets API, сводные таблицы |
| 13. Upload & Media Library | Загрузка крео в R2 и Медиатека |
| 14. Environment Variables | Все env-переменные и что сломается без них |
| 15. Рабочее место баера | Что видит баер, путь от регистрации до залива, что ещё руками |
| 16. General Report 4.0 | `/general-report-4`: плоский формат, общая таблица и таблицы баеров |

Авторизация, роли, приглашения и раздел настроек описаны в 5, 10 и 15;
отдельной страницы под них нет.

## Правило: документация обновляется вместе с кодом

Каждый апдейт проекта должен доезжать до вики. Изменение считается завершённым только
после того, как документация приведена в соответствие с кодом — так же, как оно не
считается завершённым без прохождения типов и сборки.

Что обновлять, в зависимости от изменения:

| Что изменилось | Что обновить в вики |
|---|---|
| Новый модуль / страница | Новая страница вики + ссылка в 1, 2 и 3 |
| Новый или изменённый API route | 6. API Reference |
| Новая env-переменная | 14. Environment Variables |
| Новая таблица/колонка Supabase, новая папка R2, новый Google Sheet | 5. Database & Storage |
| Новый источник данных или изменение источника истины | 5. Database & Storage + 10. Decision Log |
| Архитектурное решение, смена подхода, замена интеграции | 10. Decision Log (новая запись Decision NNN) |
| Оптимизация производительности | 8. Performance Decisions |
| Фича доехала до прода / появилась в планах | 9. Roadmap |
| Изменение правил разработки | AGENTS.md + 4. Development Guide |

Правила ведения:

- Decision Log только дополняется, записи не переписываются. Решение отменено —
  добавляется новая запись со ссылкой на старую, старая не удаляется.
- Обычные багфиксы и мелкие визуальные правки в Decision Log не попадают.
- Документация описывает то, что есть в коде сейчас, а не то, что планировалось.
  Расхождение вики с кодом — это баг документации, его нужно чинить.
- В конце реализации фичи явно сказать, какие страницы вики обновлены (или что
  обновлять нечего и почему).

---

# Правила доступа

Проверка доступа живёт в `middleware.ts` и в базе, а не в интерфейсе.

- Скрыть кнопку или вкладку — не защита. Роут обязан проверять сам.
- `status = 'disabled'` — настоящий отзыв доступа, а не отметка. Он проверяется
  в middleware (страницы и `app/api/*`) и в `app_role()` (RLS и security definer
  функции). Одного слоя мало: роуты `app/api/*` в Supabase не ходят вообще, а к
  PostgREST можно постучаться напрямую анонимным ключом из браузера.
- Роль, код баера и статус не меняются прямым `update` ни у кого — только через
  `admin_update_profile`.

## Кто что видит

Решено 30.08.2026. Пока не реализовано — роли режут только админку.

| Раздел | Владелец и тимлид | Баер |
|---|---|---|
| Легаси крео | всё | всё, кроме Медиатеки (Decision 077) |
| Креативы (новая) | всё | строки — по своим подключениям, файлы к строкам — своя папка `bN/` и легаси вне папок баеров; в Медиатеке и трогать — только своя папка |
| General Report 3.0 | своя таблица + таблицы баеров + сводная | только своя, её подключает владелец |
| General Report 4.0 | общая таблица + таблица любого баера | только своя, её подключает владелец |
| Reports | всё, сводно по всем подключениям | своё — оно и собирается по его подключениям |
| Checks | всё | всё, это просто функционал над своими файлами |

Reports не нужно резать отдельно: кабинет принадлежит тому, чей ключ Meta его видит,
и закрепляется за ним загрузкой сама, без ручной раздачи (Decision 061). Склад расхода —
одна строка на «день + объявление», поэтому дублей между ключами и людьми не бывает.
Владельцу и тимлиду отчёт собирается сводно, по всем интеграциям команды.

Если кабинет видят ключи двух человек — так быть не должно, — он остаётся за первым,
второму расход не пишется, владельцу и тимлидам приходит алерт. Ключи владельца не
видели кабинет два дня — кабинет свободен.

Таблицу General 3.0 баеру подключает владелец: таблицы заводит он и шарит на свой
сервисный аккаунт, баеру там нечего вводить. Поле живёт на странице «Команда»
рядом с ролью и номером. В «Интеграциях» у баера остаётся только то, что есть
исключительно у него: источник расхода и Torro.

Командный ключ Meta из env в отчёты и чек больше не входит — сводная собирается из
интеграций. Он остаётся только для алертов кабинетов и антиотклона и не достаётся
баерам ни в каком виде. Баер без
подключений видит экран «подключений пока нет», а не чужие цифры. Это уже сделано,
до самих подключений.

Принадлежность креатива определяется **фактом загрузки в дашборд**, а не кодом
`bN` в имени. Это сознательно: `bN` печатает человек, и опечатка отдала бы крео
чужому. Дашборд знает, кто нажал кнопку, и ошибиться тут нечему.

Отсюда следует, чего нельзя делать: выводить принадлежность разбором имени.
Владелец пишется при загрузке — в R2-папку и в базу, — а дальше только читается.

**Но файлы в R2 по владельцу не фильтруются** (Decision 036). Набор строк новой
картотеки задают подключения баера — его объявления из Meta и его выгрузки Торро.
R2 нужен только чтобы найти файл к уже найденной строке, и ищется он по всему
бакету. Иначе легаси-креативы, которыми льют до сих пор, пришлось бы загружать
второй раз, каждому в свою папку.

Уже загруженные файлы владельца не имеют, и backfill не нужен.

Исключение — папки других баеров (Decision 077). `/api/media` баеру их не отдаёт,
а помечает `own` только его папку `bN/`: её одну он видит в Медиатеке, переименовывает
и удаляет. Правило в
`lib/creatives/access.ts`, и решает его папка, а не `creative_uploads`: строку
таблицы переписывает любой, кто запросил ссылку на загрузку с тем же кодом крео.
Ссылки R2 при этом публичные — кто знает или угадал ключ, откроет файл без входа.

---

Отключение забирает доступ, а не данные:

- Профиль остаётся в `profiles` со статусом `disabled`. Удаления профилей в
  интерфейсе нет и быть не должно.
- Код баера остаётся занят навсегда (Decision 028). Иначе следующий человек
  получил бы чужой `bN`, и вся история креативов уехала бы не тому.
- Креативы в R2, страницы в Notion, заметки и статистика не трогаются вообще.
  Ушедший баер перестаёт видеть дашборд — его работа остаётся у команды.
- Значит и будущее разграничение по `bN` режет только то, что видит сам баер.
  Владелец и тимлид продолжают видеть креативы отключённого.

---

# Testing

Before suggesting deployment:

- Test locally.
- Check TypeScript errors.
- Check build errors.
- Verify existing functionality still works.
- Mention possible side effects if multiple modules are affected.
- Update the Notion wiki for anything the change makes stale (see Documentation).

---

# Project Priorities

When making development decisions, prioritize in this order:

1. Stability
2. Performance
3. Maintainability
4. Developer Experience
5. Visual Improvements

---

# Do Not

- Do not rewrite working modules without approval.
- Do not ship a change that leaves the Notion wiki describing the old behaviour.
- Do not change architecture without a clear reason.
- Do not introduce unnecessary dependencies.
- Do not reduce performance.
- Do not move business logic into UI components.
- Do not duplicate existing functionality.

---

# Future Direction

Planned major features:

- Telegram Upload Bot
- Automatic Statistics Sync
- Автозапись General Report 3.0 в основную таблицу
- CRM API Integration (сейчас CRM приходит через Google Sheets)
- AI Creative Analysis
- AI Recommendations
- Creative Scoring
- Pattern Detection

---

# Things That Must Never Break

- Creative Dashboard
- Analytics
- Check Module
- Reports (дерево РК и таблица по креативам)
- General Report 3.0
- Upload Module / Медиатека
- Cloudflare R2 integration
- Meta Marketing API integration
- Google Sheets API integration
- Media loading
- Existing CSV parsing logic
- Virtualization
- Performance optimizations
- Graceful Supabase fallback

---

# Development Philosophy

Build for long-term maintainability.

Prefer simple solutions over clever ones.

Prefer modular architecture.

Keep business logic separate from UI.

Optimize before adding complexity.

Every new feature should fit naturally into the existing architecture instead of introducing parallel systems.