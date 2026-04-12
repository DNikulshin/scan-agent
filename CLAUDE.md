# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Does

An AI-powered agent that scrapes freelance marketplaces (Kwork, FL.ru, Freelance.ru, Habr Freelance), scores projects with an LLM (0–10), generates two pitch variants per project, and sends notifications via Telegram and/or a Next.js dashboard. Runs as a GitHub Actions cron job every 30 minutes.

**Pipeline**: Parse → Pre-filter (no AI) → AI Score → Pitch (×2, parallel) → Notify (Telegram + Supabase/Dashboard + Push) → Save to SQLite

## Commands

### Backend (root)
```bash
npm run dev      # Run agent with pretty logs (tsx, PRETTY_LOGS=true)
npm run build    # Compile TypeScript to dist/
npm start        # Run compiled dist/index.js
npm run lint     # TypeScript type-check (no emit)
```

### Dashboard (Next.js PWA)
```bash
cd dashboard
npm run dev      # Dev server on port 3000
npm run build    # Production build
npm run lint     # ESLint
```

## Architecture

### Core Pipeline (`src/index.ts`)
1. Initializes Storage (SQLite), Supabase, Dashboard, Telegram, Push notifiers
2. Starts Telegram callback polling (inline button interactions)
3. Runs each parser → merges orders
4. For each new order: fast filter → AI score → if score ≥ minScore, generate 2 pitches in parallel → notify all channels → save
5. Sends reminders for high-score orders ignored for 2+ hours
6. With `KEEP_ALIVE=false` (cron mode), exits after 30 seconds

### Key Design Decisions
- **Pre-AI filter** (`src/core/filter.ts`): Stop-words, min price, max offers — eliminates cheap/spam orders before paying for LLM
- **Two pitch temperatures**: Variant A at 0.5 (focused), Variant B at 0.9 (creative), generated concurrently
- **SQLite as source of truth** (`src/core/storage.ts`): Deduplication by `(order_id, source)` composite key; DB is cached between GitHub Actions runs
- **Dynamic settings**: minPrice, minScore, maxOffers, stopWords stored in DB, adjustable live via Telegram commands (`/setrate`, `/setscore`, `/setstop`)
- **Notifier independence**: Telegram, Supabase, Dashboard, Push each fail independently — one failure doesn't block others
- **Retry with backoff** (`src/utils/retry.ts`): Exponential backoff for OpenRouter, Telegram, Supabase API calls

### Configuration (`src/config.ts`)
All env vars flow through here with defaults. Parser selectors (CSS) are in config — update here when marketplace layouts change. The developer profile that feeds AI pitch generation is in `src/profile.ts`.

### AI Integration (`src/core/analyzer.ts`)
- Model: DeepSeek via OpenRouter (cheap, fast)
- Scoring: temp 0.3, JSON output `{score, reason}`, Zod-validated
- Pitching: temp 0.5/0.9, JSON output `{hook, pitch}`, Russian only, hook ≤100 chars, pitch ≤1000 chars
- Max 2 attempts per order before skipping

### Parsers (`src/parsers/`)
Each parser implements the `Parser` interface from `src/types.ts` — a `fetch()` method returning `Order[]`. Uses Playwright + puppeteer-extra-stealth. FL.ru parser has a `findWorkingSelector()` fallback method for layout changes. Debug screenshots are saved on parse errors.

**To add a new marketplace**: implement the `Parser` interface, add config entry in `src/config.ts`, export from `src/parsers/index.ts`.

### Dashboard (`dashboard/`)
Next.js 16 App Router + React 19 + Tailwind CSS 4 + TanStack React Query. Data comes from Supabase (or VPS Dashboard API). Supports filtering by status, source, min score, and tech tags. `OrderCard` component shows both pitch variants with copy-on-tap. **Important**: Next.js 16 has breaking changes — read `node_modules/next/dist/docs/` before modifying frontend code.

## Environment Variables

Backend requires: `OPENROUTER_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and at least one data sink (`SUPABASE_URL`/`SUPABASE_ANON_KEY` or `DASHBOARD_URL`/`DASHBOARD_API_KEY`). Parser URLs (`KWORK_SEARCH_URL`, `FL_SEARCH_URL`, etc.) and VAPID keys for push are also needed. See `.env.example`.

Dashboard requires: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## GitHub Actions

Workflow at `.github/workflows/scan-agent.yml` runs every 30 minutes. The SQLite database is cached between runs (keyed by `run_id`) so processed orders persist. Playwright chromium is installed fresh each run.
