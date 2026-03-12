# Creator Intelligence — Design Spec
**Date:** 2026-03-12
**Project:** creator-metrics (Entmarketingteam/creator-metrics)
**Status:** Approved

---

## Overview

Extend the existing `creator-metrics` Next.js dashboard with a **Content Intelligence** section that gives ENT Agency and their creators three capabilities:

1. **Semantic Search** — find posts by topic/theme using Gemini multimodal embeddings
2. **AI Analysis** — pre-computed nightly insights + on-demand Q&A about content performance
3. **Trends** — follower growth, engagement by content type, top content timelines

The `nicki-embeddings` pipeline (Railway cron → Supabase `creator_posts`) is the data foundation and remains unchanged. This spec covers only what gets built on top of it inside `creator-metrics`.

---

## Architecture

```
creator-metrics (Next.js, Vercel)
  ├── /dashboard/intelligence/search     — semantic post search
  ├── /dashboard/intelligence/insights   — AI content analysis
  └── /dashboard/intelligence/trends     — performance over time

Supabase (existing)
  ├── creator_posts          — posts + embeddings (from nicki-embeddings pipeline)
  ├── creator_snapshots      — daily follower counts (existing)
  ├── creator_intelligence   — nightly AI analysis cache (new)
  └── creator_tokens         — per-creator OAuth tokens (new)

nicki-embeddings (Railway cron, unchanged)
  └── sync.py runs daily at 08:00 UTC — new posts + insight refresh

New Railway cron: intelligence-sync
  └── runs after sync.py — generates creator_intelligence rows + refreshes tokens
```

**New Doppler secret:** `GOOGLE_GEMINI_API_KEY` added to `ent-agency-automation/prd` so Vercel can call Gemini for embedding queries and AI analysis.

---

## Feature 1: Semantic Search

### UI
- Search bar at top of `/dashboard/intelligence/search`
- Results: Instagram-style grid (thumbnail, engagement metrics overlay, permalink on click)
- Filter chips: `All` / `Reels` / `Feed` / `Carousel`
- Sort toggle: `Most Relevant` / `Most Saves` / `Most Reach`
- Returns top 20 results

### API
`POST /api/intelligence/search`
```ts
// Request
{ query: string; creatorId: string; mediaType?: string; sortBy?: "relevant" | "saves" | "reach" }

// Response
{ results: Array<{ postId, postUrl, caption, imageUrl, likes, saves, reach, mediaType, postedAt, similarity }> }
```

### Implementation
1. Embed query text with `gemini-embedding-2-preview` (3072-dim) via `lib/embeddings.ts`
2. Call existing `search_creator_posts(embedding, creatorId, topK)` pgvector function in Supabase
3. Apply `mediaType` filter and `sortBy` re-sort in application layer

---

## Feature 2: AI Content Analysis

### Pre-computed Nightly Analysis
A new Railway service (`intelligence-sync`) runs after the daily `sync.py`. It:
1. Pulls last 90 days of posts with full metrics from `creator_posts`
2. Sends to Claude API with a structured prompt requesting JSON output:
   - Top 5 performing content themes (extracted from captions)
   - Performance by content type (Reels vs Feed vs Carousel): avg reach, saves, shares
   - "Hidden gems": posts in top 25% saves but bottom 50% likes
   - Best posting day/time patterns
   - Engagement rate trend (improving/declining/stable)
3. Stores result in `creator_intelligence` table (one row per creator per day)

### On-demand Q&A
`POST /api/intelligence/ask`
```ts
// Request
{ question: string; creatorId: string }

// Response (streamed)
{ answer: string }
```
1. Embed the question → vector search for top 50 relevant posts
2. Format posts as context (caption, metrics, date, type)
3. Stream Claude response scoped to that creator's content data

### UI
- `/dashboard/intelligence/insights` shows today's pre-computed analysis in card format
- Below: chat input for on-demand questions, streamed response displayed inline

---

## Feature 3: Trends

Pulls from existing `creator_snapshots` + `creator_posts` — no new data collection.

### Charts
- **Follower Growth**: area chart, daily followers over 7d / 30d / 90d / all time
- **Engagement by Content Type**: bar chart, avg reach + saves + shares per post type over time
- **Top Content Timeline**: top 10 posts by saves in selected period — thumbnails + metrics

### API
`GET /api/intelligence/trends?creatorId=&period=30d`
```ts
{ followerHistory: Array<{ date, followers }>, engagementByType: Array<{ type, avgReach, avgSaves, avgShares }>, topPosts: Array<{ postId, imageUrl, saves, reach, postedAt }> }
```

---

## Feature 4: Creator Auth + Instagram OAuth

### Creator Onboarding Flow
1. Creator signs up via Clerk → redirected to `/onboarding`
2. `/onboarding` page shows "Connect your Instagram" CTA
3. Click → Meta OAuth with scopes: `instagram_basic`, `instagram_manage_insights`, `pages_read_engagement`, `pages_show_list`
4. Callback at `/api/auth/instagram/callback`:
   - Exchange short-lived token for long-lived token (60-day) via Meta Graph API
   - Fetch their IG Business Account ID
   - Upsert into `creator_tokens`: `{ clerk_user_id, creator_id, ig_user_id, access_token, expires_at }`
5. Creator is routed to their dashboard

### creator_tokens Table
```sql
CREATE TABLE creator_tokens (
  id SERIAL PRIMARY KEY,
  clerk_user_id TEXT NOT NULL UNIQUE,
  creator_id TEXT NOT NULL,
  ig_user_id TEXT NOT NULL,
  access_token TEXT NOT NULL,       -- store encrypted
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### Token Auto-Refresh
The `intelligence-sync` cron also loops through `creator_tokens`, finds any expiring within 10 days, exchanges for a new long-lived token via Meta, and writes it back to Supabase.

### Role-Based Access Control
Clerk user metadata field `role`:
- `admin` — Emily/Ethan, can view any creator's data, `creatorId` passed as query param
- `creator` — scoped to their own `creator_id`, injected server-side from `creator_tokens`, cannot be overridden client-side

All `/api/intelligence/*` routes enforce this via a shared `getCreatorScope(userId)` helper.

---

## New Files

```
creator-metrics/
  app/
    onboarding/
      page.tsx                          — Instagram connect CTA
    api/
      auth/instagram/
        callback/route.ts               — OAuth callback, token exchange
      intelligence/
        search/route.ts
        ask/route.ts
        trends/route.ts
    dashboard/
      intelligence/
        layout.tsx                      — tab nav
        search/page.tsx
        insights/page.tsx
        trends/page.tsx
  lib/
    embeddings.ts                       — Gemini embed client
    intelligence-queries.ts            — Supabase queries for intelligence features
    creator-scope.ts                   — RBAC helper

nicki-embeddings/
  intelligence_sync.py                  — nightly AI analysis + token refresh cron
```

---

## New Supabase Tables

```sql
-- Nightly AI analysis cache
CREATE TABLE creator_intelligence (
  id SERIAL PRIMARY KEY,
  creator_id TEXT NOT NULL,
  generated_at DATE NOT NULL,
  analysis JSONB NOT NULL,            -- structured Claude output
  UNIQUE(creator_id, generated_at)
);

-- Per-creator OAuth tokens
CREATE TABLE creator_tokens (
  id SERIAL PRIMARY KEY,
  clerk_user_id TEXT NOT NULL UNIQUE,
  creator_id TEXT NOT NULL,
  ig_user_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

---

## Secrets

| Secret | Project | Purpose |
|---|---|---|
| `GOOGLE_GEMINI_API_KEY` | ent-agency-automation/prd | Embedding queries from Vercel |
| `META_APP_ID` | ent-agency-automation/prd | Already exists — OAuth flow |
| `META_APP_SECRET` | ent-agency-automation/prd | Already exists — token exchange |

No new secrets required beyond adding `GOOGLE_GEMINI_API_KEY` to `ent-agency-automation`.

---

## Out of Scope (this spec)

- Multi-platform embeddings (TikTok, YouTube) — future
- Creator-to-brand matchmaking — future
- Public-facing creator profiles — future
- LTK/Amazon data in intelligence features — future

---

## Success Criteria

1. Emily can type "clean girl morning routine" and see Nicki's top matching posts in under 2 seconds
2. The insights page shows at least 3 actionable performance findings updated daily
3. A creator can connect their Instagram and see their own data within 24 hours of signing up
4. All routes are gated — creators only see their own data
