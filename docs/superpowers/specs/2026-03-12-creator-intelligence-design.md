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

The `nicki-embeddings` pipeline (Railway cron → Supabase `creator_posts`) is the data foundation and remains unchanged.

---

## Architecture

```
creator-metrics (Next.js, Vercel)
  ├── /dashboard/intelligence/search
  ├── /dashboard/intelligence/insights
  └── /dashboard/intelligence/trends

Supabase
  ├── creator_posts          — posts + embeddings (existing)
  ├── creator_snapshots      — daily follower counts (existing)
  ├── creator_intelligence   — nightly AI analysis cache (new)
  └── creator_tokens         — per-creator Page Access Tokens (new)

nicki-embeddings (Railway, unchanged)
  └── sync.py cron: 0 8 * * * UTC

nicki-embeddings (Railway, new cron)
  └── intelligence_sync.py cron: 0 9 * * * UTC
```

---

## creator_id Format

Lowercase slug, e.g. `"nicki_entenmann"`. Derived from IG username: `username.replace(".", "_").toLowerCase()`. Join key across all tables.

---

## Gemini Embedding Model

`gemini-embedding-2-preview`, `output_dimensionality=3072`. Confirmed working in `nicki-embeddings/pipeline.py`. Use this exact string with `@google/genai` in `lib/embeddings.ts`.

---

## Clerk Role Setup

Set `publicMetadata.role = "admin"` manually in Clerk dashboard for Emily and Ethan (Users → select user → Metadata → Public). Missing `role` treated as `"creator"`. Read via `auth().sessionClaims?.publicMetadata?.role` in server components.

---

## Token Strategy

**Store Page Access Tokens, not User Access Tokens.**

Page Access Tokens from long-lived User Access Tokens are effectively permanent (no 60-day expiry). This is the same token type used in the existing `nicki-embeddings` pipeline (`META_ACCESS_TOKEN`). No token refresh logic is needed.

If a creator's Page token is revoked (user deauthorizes the app), `sync.py` will start failing for that creator. Resolution: creator re-connects via `/onboarding`. No automated handling required.

---

## creator_posts Schema Reference

| Column | Type | Notes |
|---|---|---|
| `post_id` | text | PK |
| `creator_id` | text | e.g. `"nicki_entenmann"` |
| `post_url` | text | |
| `caption` | text | |
| `image_url` | text | |
| `media_type` | text | `IMAGE`, `VIDEO`, `CAROUSEL_ALBUM` |
| `media_product_type` | text | `FEED`, `REELS`, `STORY` |
| `likes` | int | |
| `saves` | int | |
| `reach` | int | |
| `shares` | int | |
| `posted_at` | timestamptz | |
| `embedding` | vector(3072) | |

---

## Feature 1: Semantic Search

### API
`POST /api/intelligence/search`
```ts
// Request
{ query: string; creatorId: string; mediaProductType?: "REELS" | "FEED"; mediaType?: "CAROUSEL_ALBUM"; sortBy?: "relevant" | "saves" | "reach" }

// Response
{ results: Array<{ postId, postUrl, caption, imageUrl, likes, saves, reach, mediaType, mediaProductType, postedAt, similarity }> }
```

### Implementation
1. Embed query with `gemini-embedding-2-preview` via `lib/embeddings.ts`
2. Call `search_creator_posts(embedding, creatorId, 100)`
3. Filter by `mediaProductType` / `mediaType` in app layer
4. Re-sort by `saves` or `reach` if requested
5. Return top 20

### pgvector Function — replace existing in Supabase SQL editor
```sql
CREATE OR REPLACE FUNCTION search_creator_posts(
  query_embedding vector(3072),
  p_creator_id text,
  match_count int DEFAULT 100
)
RETURNS TABLE (
  post_id text, post_url text, caption text, image_url text,
  likes int, saves int, reach int, shares int,
  media_type text, media_product_type text,
  posted_at timestamptz, similarity float
)
LANGUAGE sql STABLE AS $$
  SELECT post_id, post_url, caption, image_url,
         likes, saves, reach, shares,
         media_type, media_product_type, posted_at,
         1 - (embedding <=> query_embedding) AS similarity
  FROM creator_posts
  WHERE creator_id = p_creator_id AND embedding IS NOT NULL
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
```

### UI
- Search bar → Instagram-style grid (thumbnail, metrics overlay, permalink on click)
- Filter chips: `All` / `Reels` / `Feed` / `Carousel`
- Sort toggle: `Most Relevant` / `Most Saves` / `Most Reach`

---

## Feature 2: AI Content Analysis

### `analysis` JSONB Schema

```ts
{
  themes: Array<{ name: string; avgReach: number; avgSaves: number; postCount: number; examplePostIds: string[] }>;
  byContentType: Array<{ type: string; avgReach: number; avgSaves: number; avgShares: number; postCount: number }>;
  hiddenGems: Array<{ postId: string; postUrl: string; saves: number; likes: number; caption: string }>;
  bestPostingDays: string[];
  engagementTrend: "improving" | "declining" | "stable";
  trendNote: string;
}
```

### `intelligence_sync.py`

For each distinct `creator_id` in `creator_posts`:
1. Fetch last 90 days of posts
2. Call `claude-sonnet-4-6` with tool_use:
   ```python
   response = anthropic_client.messages.create(
       model="claude-sonnet-4-6",
       max_tokens=4096,
       tools=[{"name": "store_analysis", "description": "Store the analysis", "input_schema": ANALYSIS_SCHEMA}],
       tool_choice={"type": "tool", "name": "store_analysis"},
       messages=[{"role": "user", "content": prompt}]
   )
   analysis = response.content[0].input  # dict
   ```
3. On exception: log, skip creator, continue
4. Upsert:
   ```python
   generated_at = datetime.now(timezone.utc).date().isoformat()  # e.g. "2026-03-12"
   supabase.table("creator_intelligence").upsert(
       {"creator_id": creator_id, "generated_at": generated_at, "analysis": analysis},
       on_conflict="creator_id,generated_at"
   ).execute()
   ```

> No token refresh phase — Page Access Tokens don't expire.

> Admin routes only query cached DB data. No live Instagram API calls from Next.js.

### On-demand Q&A
`POST /api/intelligence/ask`
1. Embed question with `gemini-embedding-2-preview`
2. `search_creator_posts(embedding, creatorId, 50)`
3. Stream via Vercel AI SDK `streamText` with `claude-sonnet-4-6`
4. System prompt: "You are an Instagram analytics assistant. Answer only based on the post data provided. Do not make up metrics."

### UI
- Insights page: today's `creator_intelligence.analysis` as cards (themes, content type breakdown, hidden gems, trend badge)
- Below: `useChat` hook → Q&A streamed inline

---

## Feature 3: Trends

`GET /api/intelligence/trends?creatorId=&period=<value>`

Valid `period` values: `7d`, `30d`, `90d`, `all`. All four required in v1.

```ts
{
  followerHistory: Array<{ date: string; followers: number }>;
  engagementByType: Array<{ type: string; avgReach: number; avgSaves: number; avgShares: number }>;
  topPosts: Array<{ postId: string; imageUrl: string; saves: number; reach: number; postedAt: string }>;
}
```

Charts: area (follower growth from `creator_snapshots`), bar (engagement by `media_product_type` from `creator_posts`), top-10 post grid.

---

## Feature 4: Creator Auth + Instagram OAuth

### Onboarding Page (`app/onboarding/page.tsx`)

UI:
- Heading: "Connect your Instagram"
- Body: "Link your account to see your analytics dashboard."
- Button: "Connect Instagram" — submits a `<form action={startOAuth}>` where `startOAuth` is a **Server Action**
- Error state: `?error=already_claimed` → "This Instagram account is already connected to another login."
- Error state: `?error=true` → "Connection failed. Please try again."

**OAuth entry Server Action** (`app/onboarding/actions.ts`):
```ts
"use server"
export async function startOAuth() {
  const state = crypto.randomUUID()
  cookies().set("ig_oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 300 })
  const url = new URL("https://www.facebook.com/v21.0/dialog/oauth")
  url.searchParams.set("client_id", process.env.META_APP_ID!)
  url.searchParams.set("redirect_uri", `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/instagram/callback`)
  url.searchParams.set("scope", "pages_show_list,instagram_basic,instagram_manage_insights,pages_read_engagement")
  url.searchParams.set("response_type", "code")
  url.searchParams.set("state", state)
  redirect(url.toString())
}
```

The cookie and OAuth URL are generated in the same server-side request, so the state is always set before the redirect.

### Instagram OAuth Callback (`/api/auth/instagram/callback`)

1. Verify `state` param matches `ig_oauth_state` cookie. On mismatch: return 400.
2. Exchange code for short-lived User token: `POST https://graph.facebook.com/v21.0/oauth/access_token?client_id={META_APP_ID}&client_secret={META_APP_SECRET}&code={code}&redirect_uri={NEXT_PUBLIC_APP_URL}/api/auth/instagram/callback`
3. Exchange for long-lived User token: `GET https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id={META_APP_ID}&client_secret={META_APP_SECRET}&fb_exchange_token={short_token}`
4. Get Pages: `GET https://graph.facebook.com/v21.0/me/accounts?fields=id,access_token,instagram_business_account&access_token={long_user_token}`
   - Iterate all returned pages to find the first one where `instagram_business_account` is present
   - If none found: redirect to `/onboarding?error=true`
   - `page_access_token` = that page's `access_token` field; `ig_user_id` = `instagram_business_account.id`
   - **Store `page_access_token`, not the user token**
5. Get username: `GET https://graph.facebook.com/v21.0/{ig_user_id}?fields=username&access_token={page_access_token}` → `username`
6. `creator_id = username.replace(".", "_").toLowerCase()`
7. Upsert `creator_tokens`. If `UNIQUE(creator_id)` constraint violation: redirect to `/onboarding?error=already_claimed`
8. Clear `ig_oauth_state` cookie, redirect to `/dashboard/intelligence`
9. On any other error: redirect to `/onboarding?error=true`

`creator_tokens.expires_at`: set to `new Date("2099-01-01")` on insert (permanent token; field kept for schema consistency).

### Dashboard Layout (`app/dashboard/layout.tsx`)

```
if role === "creator" (or missing):
  query creator_tokens by clerk_user_id
  if no row → redirect("/onboarding")
  else → render normally

if role === "admin":
  render normally (no redirect)
  render CreatorSelector in sidebar (distinct creator_ids from creator_posts)
  default to first creator_id alphabetically if no ?creatorId in URL
  all intelligence page links include ?creatorId=<selected>
```

### creator_tokens Table

```sql
CREATE TABLE creator_tokens (
  id SERIAL PRIMARY KEY,
  clerk_user_id TEXT NOT NULL UNIQUE,
  creator_id TEXT NOT NULL UNIQUE,
  ig_user_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT '2099-01-01',
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### Seeding Nicki (if she doesn't self-onboard)

Get `META_ACCESS_TOKEN` from Doppler and her Clerk user ID from Clerk dashboard:
```sql
INSERT INTO creator_tokens (clerk_user_id, creator_id, ig_user_id, access_token)
VALUES ('<nicki_clerk_user_id>', 'nicki_entenmann', '17841401475580469', '<META_ACCESS_TOKEN>');
```

### RBAC — `lib/creator-scope.ts`
```ts
async function getCreatorScope(
  clerkUserId: string,
  role: "admin" | "creator",
  requestedCreatorId?: string
): Promise<{ creatorId: string }>
```
- `creator`: query `creator_tokens` by `clerk_user_id` → return `creator_id`. Throw 403 if missing.
- `admin`: validate `requestedCreatorId` against distinct `creator_id` in `creator_posts`. Throw 400 if absent or unknown.

---

## Drizzle Schema

Add to `lib/schema.ts`:

```ts
import { pgTable, serial, text, date, jsonb, timestamptz, uniqueIndex } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const creatorIntelligence = pgTable("creator_intelligence", {
  id:          serial("id").primaryKey(),
  creatorId:   text("creator_id").notNull(),
  generatedAt: date("generated_at").notNull(),
  analysis:    jsonb("analysis").notNull(),
}, (t) => ({
  uniq: uniqueIndex("creator_intelligence_creator_date_idx").on(t.creatorId, t.generatedAt),
}))

export const creatorTokens = pgTable("creator_tokens", {
  id:          serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  creatorId:   text("creator_id").notNull().unique(),
  igUserId:    text("ig_user_id").notNull(),
  accessToken: text("access_token").notNull(),
  expiresAt:   timestamptz("expires_at").notNull().default(sql`'2099-01-01'::timestamptz`),
  updatedAt:   timestamptz("updated_at").defaultNow(),
})
```

Run `npm run db:push` to apply.

---

## New Files

```
creator-metrics/
  app/
    onboarding/
      page.tsx
      actions.ts                        — startOAuth Server Action
    api/auth/instagram/callback/route.ts
    api/intelligence/search/route.ts
    api/intelligence/ask/route.ts
    api/intelligence/trends/route.ts
    dashboard/intelligence/layout.tsx
    dashboard/intelligence/search/page.tsx
    dashboard/intelligence/insights/page.tsx
    dashboard/intelligence/trends/page.tsx
  lib/
    embeddings.ts
    intelligence-queries.ts
    creator-scope.ts
  components/
    CreatorSelector.tsx

nicki-embeddings/
  intelligence_sync.py
```

---

## Secrets

### Vercel — Doppler `ent-agency-automation/prd`

| Secret | Status | Purpose |
|---|---|---|
| `GOOGLE_GEMINI_API_KEY` | **New — get from aistudio.google.com** | Embedding queries (search + Q&A) |
| `ANTHROPIC_2_API_KEY` | **Copy from example-project/prd** | Claude streaming Q&A |
| `META_APP_ID` | Already exists | OAuth server-side |
| `META_APP_SECRET` | Already exists | Token exchange |
| `NEXT_PUBLIC_APP_URL` | **New** — `https://<vercel-domain>` | OAuth redirect_uri |

### Railway `intelligence_sync.py` — Doppler `ent-agency-automation/prd`

| Secret | Status | Purpose |
|---|---|---|
| `ANTHROPIC_2_API_KEY` | Copy from example-project/prd | Nightly Claude analysis |
| `SUPABASE_URL` | Already exists | DB |
| `SUPABASE_SERVICE_ROLE_KEY` | Already exists | DB writes |

> `GOOGLE_GEMINI_API_KEY` is **not needed** in Railway — no embedding step in `intelligence_sync.py`.

**Setup:**
```bash
ANTHROPIC_KEY=$(doppler secrets get ANTHROPIC_2_API_KEY --project example-project --config prd --plain)
doppler secrets set \
  ANTHROPIC_2_API_KEY="$ANTHROPIC_KEY" \
  GOOGLE_GEMINI_API_KEY="<from aistudio.google.com>" \
  NEXT_PUBLIC_APP_URL="https://<vercel-domain>" \
  --project ent-agency-automation --config prd
```

Register `https://<vercel-domain>/api/auth/instagram/callback` in Meta App dashboard (App → Facebook Login → Settings → Valid OAuth Redirect URIs).

---

## Out of Scope

- Multi-platform embeddings (TikTok, YouTube)
- Creator-to-brand matchmaking
- Public-facing creator profiles
- LTK/Amazon data in intelligence features
- Token encryption at rest (deferred to v2)

---

## Success Criteria

1. Emily types "clean girl morning routine" → top matching posts in under 2 seconds
2. Insights page shows ≥3 actionable findings, updated daily
3. Creator connects Instagram → sees own data within 24 hours
4. All routes gated — creators see only their data, admins can switch between creators
5. `npm run build` passes with no TypeScript errors
