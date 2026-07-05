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
- Check Module
- Favorites
- Notes
- Transcriptions
- Charts
- Virtualized Grid
- Branded Loading Screen
- Supabase Integration
- Cloudflare R2 Integration

Currently in development:

- Check Module v2
- Upload Module
- Automatic Thumbnail Generation
- Creative Automation

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

Business logic.

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

CSV remains the source of truth for business metrics.

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

# Testing

Before suggesting deployment:

- Test locally.
- Check TypeScript errors.
- Check build errors.
- Verify existing functionality still works.
- Mention possible side effects if multiple modules are affected.

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
- Do not change architecture without a clear reason.
- Do not introduce unnecessary dependencies.
- Do not reduce performance.
- Do not move business logic into UI components.
- Do not duplicate existing functionality.

---

# Future Direction

Planned major features:

- Upload Module
- Telegram Upload Bot
- Automatic Thumbnail Generation
- Automatic Statistics Sync
- Meta API Integration
- CRM API Integration
- AI Creative Analysis
- AI Recommendations
- Creative Scoring
- Pattern Detection

---

# Things That Must Never Break

- Creative Dashboard
- Analytics
- Check Module
- Cloudflare R2 integration
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