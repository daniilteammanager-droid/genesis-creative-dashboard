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
- Reports — Live Auto Report (Meta Marketing API + CRM)
- Reports — Manual (ручная загрузка MVP + FBTool XLSX)
- General Report 3.0 (Google Sheets API)
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

- Check Module v2
- Creative Automation
- Автозапись General Report 3.0 в основную таблицу

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

## Creative Dashboard

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

Purpose:

- Facebook Tool parsing
- MVP parsing
- Check generation
- Summary
- Mismatch diagnostics
- Creative analysis

This module must remain independent from the Creative Dashboard.

---

## Reports

Route: `/reports`

Two modes:

- **Auto (Live)** — Meta Marketing API + CRM-выгрузки из Google Sheets, без FBTool.
  Подрежимы: Кампании (матч по campaign_id) и Объявления (матч по имени объявления).
- **Manual** — ручная загрузка пары XLSX (MVP + FBTool) для разовой сверки.

---

## General Report 3.0

Route: `/general-report`

Агрегация байерских и страновых Google-таблиц через Sheets API v4.

Два уровня переключателя источников:

- общие таблицы: EU, LATAM, WA;
- байерские: Сводная, Артём, Матвей, Андрей, Саян.

Гранулярность: день / неделя / месяц. Все производные метрики считаются из сумм,
а не берутся из формул таблицы.

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

- `lib/creatives/` — CSV библиотеки крео, матчинг медиа, форматирование
- `lib/forex-check/` — Check Module
- `lib/reports/` — парсеры MVP / FBTool XLSX, сборка строк отчёта
- `lib/reports-live/` — Meta API, CRM-выгрузки, сборка Live-отчёта
- `lib/general-report/` — Google Sheets API, парсеры листов, агрегация
- `lib/supabase.ts` — единая точка входа в Supabase

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

Supabase stores only:

- notes
- favorites
- transcriptions
- `ignored` — флаг "не показывать в списке ненайденных крео"
- `creative_match_suffixes` — список гео/вариант-суффиксов для матчинга по базовому имени

Google Sheets — источник истины для Reports и General Report 3.0:

- CRM-выгрузки по кампаниям и объявлениям (по неделям, лист = период)
- байерские и страновые таблицы General Report 3.0

Meta Marketing API — источник истины по расходу, кликам, показам и статусам.

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
| 7. Check Module | Forex Check (`/check`) |
| 8. Performance Decisions | Почему приняты те или иные оптимизации |
| 9. Roadmap | Что сделано, что в планах |
| 10. Decision Log | Архитектурные решения и их причины |
| 11. Reports Module | Live Auto Report (`/reports`): Meta API + CRM |
| 12. General Report 3.0 | `/general-report`: Google Sheets API, сводные таблицы |
| 13. Upload & Media Library | Загрузка крео в R2 и Медиатека |
| 14. Environment Variables | Все env-переменные и что сломается без них |
| 15. Рабочее место баера | Что видит баер, путь от регистрации до залива, что ещё руками |

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
- Reports (Live + Manual)
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