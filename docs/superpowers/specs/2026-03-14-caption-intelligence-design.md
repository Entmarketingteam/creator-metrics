# Caption Intelligence — Design Spec
**Date:** 2026-03-14
**Creator:** Nicki Entenmann
**Project:** creator-metrics (Vercel + Python content-intelligence pipeline)

---

## 1. Problem Statement

Nicki's Spring 2025 content-intelligence report has a Section 7 ("Caption Intelligence") that delivers static summary stats but no actionable SEO guidance. Since July 2025, Instagram posts are indexed by Google — the first 125 characters of a caption become the Google meta description. Simultaneously, Instagram enforced a 5-hashtag limit in December 2025. Neither of these platform shifts is reflected in the current NLP engine, scoring model, or report UI.

**Done looks like:**
- Python NLP engine scores each caption on 7 SEO dimensions (0–100) and runs in parallel
- Composite scores for IG Stories and Reels include a 12–15% SEO weight
- HTML report Section 7 is replaced with 7 actionable panels including prescriptions
- A live `/dashboard/intelligence/captions` page on Vercel shows scores with nightly refresh and on-demand re-analysis

---

## 2. IG SEO Context

### July 2025 Google Indexing Update
- IG public posts now appear in Google Search
- First 125 characters = Google meta description
- Keyword placement in the opening line has measurable reach impact

### December 2025 5-Hashtag Enforcement
- Hashtag limit reduced from 30 to 5
- Posts with > 5 hashtags are algorithmically suppressed
- Hashtag placement (caption body vs. first comment) affects discoverability

### Behavioral Signals
- Saves correlate most strongly with downstream purchases (revenue proxy)
- DM automation CTAs ("reply DM for link") outperform link-in-bio for conversion
- Hook quality in first 125 chars drives early engagement, which feeds algorithmic distribution

---

## 3. Architecture Overview

```
Python Pipeline (local)          Vercel App (cloud)
┌────────────────────┐          ┌──────────────────────────┐
│ caption_nlp.py     │          │ Supabase: captionAnalysis │
│  - extract_features│          │  table (Drizzle ORM)      │
│  - calculate_seo   │   sync   │                          │
│  - classify (4     │ ──────── │ /api/cron/caption-analyze │
│    workers)        │          │  (9am UTC nightly)       │
│  - aggregate stats │          │                          │
├────────────────────┤          │ /api/intelligence/       │
│ scoring.py         │          │  caption-score            │
│  Story: +15% SEO   │          │  (on-demand POST)        │
│  Reel: +12% SEO    │          │                          │
├────────────────────┤          │ /dashboard/intelligence/ │
│ report_template    │          │  captions/page.tsx       │
│  Section 7 (7      │          │  (4th tab)               │
│  panels)           │          └──────────────────────────┘
└────────────────────┘
```

---

## 4. NLP Engine Changes (`caption_nlp.py`)

### 4.1 SEO Score: `calculate_seo_score(post, features)`

Pure Python function. Returns `int` (0–100) + breakdown dict.

| Dimension | Points | Logic |
|-----------|--------|-------|
| Hook quality | 20 | First 125 chars: has keyword? sentence structure? |
| Keyword relevance | 25 | Topic nouns in caption body; niche vocabulary match |
| Hashtag efficiency | 15 | 1–5 = full score; 0 = half; > 5 = 0 (suppressed) |
| CTA quality | 15 | DM CTA > link-in-bio > none |
| Brand mentions | 10 | Relevant @mentions and brand names present |
| Alt text flag | 10 | Caption describes visual (IG uses for accessibility + SEO) |
| Engagement mechanics | 5 | Question, poll teaser, or save prompt present |

**Hook quality labels:** `strong` (≥ 16/20) · `moderate` (10–15) · `weak` (< 10)

### 4.2 Parallelized Classification: `classify_caption_batch()`

Replace current sequential loop with `ThreadPoolExecutor(max_workers=4)`.
- Each worker calls Claude CLI subprocess: `CLAUDECODE="" claude -p "..."`
- Batch size: up to 50 posts split across 4 workers
- Expected speedup: 4x (50–80% wall-clock reduction)

### 4.3 New Per-Post Fields

```python
{
  "seo_score": int,            # 0-100
  "seo_breakdown": dict,       # {dimension: points_awarded}
  "hook_text": str,            # first 125 chars
  "hook_quality_label": str,   # "strong" | "moderate" | "weak"
  "hashtag_quality": str,      # "optimal" | "over_limit" | "none"
  "cta_type": str,             # "dm" | "link_bio" | "none"
}
```

### 4.4 New Aggregate Stats

```python
{
  "avg_seo_score": float,
  "seo_score_distribution": {"0-25": int, "26-50": int, "51-75": int, "76-100": int},
  "seo_top_issues": [str],       # top 3 recurring weak dimensions
  "seo_prescriptions": [str],    # 3-5 actionable recommendations
}
```

---

## 5. Scoring Changes (`scoring.py`)

### Updated Composite Formulas

| Content Type | Old Formula | New Formula |
|---|---|---|
| LTK Post | 50% revenue + 30% clicks + 20% conversion | Unchanged |
| IG Story | 60% virality + 40% engagement | **50% virality + 35% engagement + 15% SEO** |
| IG Reel | 50% virality + 30% engagement + 20% saves | **44% virality + 27% engagement + 17% saves + 12% SEO** |

SEO component = `seo_score / 100` (normalized to 0–1 before weighting).

Posts without a caption receive `seo_score = 0` (no penalty beyond score weight).

---

## 6. HTML Report Section 7 Overhaul (`report_template.html`)

### Retire
- Section 7 (lines 819–877): current static caption stats
- Section 7b "What Goes Viral" (lines 879–903)

### Replace With: 7 Panels

**Panel 1 — SEO Overview**
- 3 KPI cards: avg SEO score, % posts with strong hooks, % posts with optimal hashtags
- Horizontal bar: score distribution buckets (0–25, 26–50, 51–75, 76–100)

**Panel 2 — Intent & Hook Distribution**
- Donut chart: intent breakdown (promotional, lifestyle, educational, conversational)
- Horizontal stacked bar: hook type distribution

**Panel 3 — Engagement by Intent**
- Table: intent → avg saves, avg link clicks, avg views, avg commissions

**Panel 4 — Caption Length Performance**
- 4 KPI cards: short/medium/long/extra-long avg performance
- Recommended length callout

**Panel 5 — High-Performing Captions (125-char highlight)**
- Top 5 captions by composite score
- First 125 chars highlighted in accent color (Google meta description window)
- SEO badge (score + label) per post

**Panel 6 — Prescription Box**
- 3–5 bulleted prescriptions generated from `seo_prescriptions`
- Color-coded by priority (red/yellow/green)
- Top 3 recurring issues as sub-bullets

**Panel 7 — Promo Codes & Brand Mentions**
- Side-by-side: top promo codes (frequency + estimated impact) / top brand @mentions

### New `pipeline.py` Injections (after line 266)

```python
report_data['avg_seo_score']           = caption_results.get('avg_seo_score', 0)
report_data['seo_score_distribution']  = caption_results.get('seo_score_distribution', {})
report_data['seo_top_issues']          = caption_results.get('seo_top_issues', [])
report_data['seo_prescriptions']       = caption_results.get('seo_prescriptions', [])
```

---

## 7. Vercel Feature: `/dashboard/intelligence/captions`

### 7.1 Database: `captionAnalysis` Table (Drizzle)

```typescript
// lib/schema.ts addition
export const captionAnalysis = pgTable('caption_analysis', {
  id:               serial('id').primaryKey(),
  mediaIgId:        text('media_ig_id').notNull(),
  creatorId:        integer('creator_id').notNull(),
  captionHash:      text('caption_hash').notNull(),        // SHA-256 for cache invalidation
  seoScore:         integer('seo_score'),
  seoBreakdown:     jsonb('seo_breakdown'),
  hookText:         text('hook_text'),
  hookQualityLabel: text('hook_quality_label'),
  hashtagQuality:   text('hashtag_quality'),
  ctaType:          text('cta_type'),
  intent:           text('intent'),
  tone:             text('tone'),
  hookType:         text('hook_type'),
  keyTopics:        jsonb('key_topics'),
  productCategory:  text('product_category'),
  hasUrgency:       boolean('has_urgency').default(false),
  viralitySignals:  jsonb('virality_signals'),
  recommendations:  jsonb('recommendations'),
  analyzedAt:       timestamp('analyzed_at').defaultNow(),
}, (table) => ({
  uniq: unique().on(table.mediaIgId, table.creatorId),
}));
```

Migration: `drizzle/0010_caption_analysis.sql`

### 7.2 Cron Route: `app/api/cron/caption-analyze/route.ts`

- Schedule: 9am UTC daily (vercel.json cron)
- Batch: 30 posts per run (oldest unanalyzed first, then re-analyze if captionHash changed)
- Agent proxy: POST to `ent-agent-server-production.up.railway.app/complete`
- Upsert: `onConflictDoUpdate` on (mediaIgId, creatorId)
- Auth: `CRON_SECRET` header

### 7.3 On-Demand Route: `app/api/intelligence/caption-score/route.ts`

```typescript
// POST body
{ creatorId: number, mediaIgId?: string, forceRefresh?: boolean }
```

- Single-post mode (mediaIgId provided): analyze one post, return score
- Batch mode (no mediaIgId): queue 30 unanalyzed posts, return job status
- `forceRefresh`: bypass captionHash cache

### 7.4 Query Layer: `lib/caption-queries.ts`

```typescript
getCaptionScoreDistribution(creatorId)   // histogram buckets
getTopCaptionIssues(creatorId)           // top 3 SEO weaknesses
getCaptionPosts(creatorId, opts)         // paginated table with scores
getCaptionPrescription(creatorId)        // aggregated recommendations
```

All queries use Drizzle ORM, typed return values.

### 7.5 Page: `app/dashboard/intelligence/captions/page.tsx`

Server component. Parallel data fetches via `Promise.all`:
- Score distribution
- Top issues
- Caption posts (first 25, paginated client-side)
- Prescriptions

**Components:**
- `CaptionScoreHistogram` — bar chart of SEO score buckets
- `CaptionPostTable` — sortable table: caption preview, SEO score badge, intent, hook type, saves, commissions
- `PerformerComparison` — side-by-side top 3 vs bottom 3 by SEO score
- `PrescriptionPanel` — color-coded recommendations list
- `ReanalyzeButton` — client component, calls `/api/intelligence/caption-score`, shows progress

### 7.6 Navigation: `components/IntelligenceTabs.tsx`

Add 4th tab:
```typescript
{ path: "/dashboard/intelligence/captions", label: "Captions" }
```

---

## 8. Data Freshness

| Trigger | Mechanism | Scope |
|---------|-----------|-------|
| Nightly | Vercel cron 9am UTC | 30 oldest unanalyzed / stale posts |
| Manual | ReanalyzeButton → POST /api/intelligence/caption-score | Single post or batch 30 |
| Cache invalidation | captionHash (SHA-256 of caption text) | Re-analyze only if caption changed |

---

## 9. Implementation Order

Wave 1 (parallel):
- A: `caption_nlp.py` — add `calculate_seo_score()` + parallelized `classify_caption_batch()`
- B: `lib/schema.ts` + migration `0010_caption_analysis.sql`

Wave 2 (parallel, after Wave 1):
- C: `scoring.py` — updated Story/Reel composite formulas (depends on A)
- D: `lib/caption-queries.ts` + API routes (depends on B)

Wave 3 (parallel, after Wave 2):
- E: HTML report Section 7 overhaul + `pipeline.py` injections (depends on A + C)
- F: `/dashboard/intelligence/captions` page + components (depends on D)
- G: `IntelligenceTabs.tsx` update (independent of D, can go with F)

Wave 4:
- H: End-to-end test: run pipeline with `--use-caption-cache`, verify report; smoke test Vercel cron

---

## 10. Constraints

- No Anthropic API key usage — all Claude calls via `claude` CLI subprocess (Max subscription) or agent server proxy
- Amazon WAF blocks Vercel IPs — no Amazon API calls from Vercel
- Vercel Functions: 30s timeout on Pro plan; cron batch capped at 30 posts to stay under limit
- IG SEO scoring is pure Python (no external API) — runs in pipeline without network calls
- Hashtag limit enforced at ≤ 5; any count > 5 scores 0 on hashtag efficiency dimension

---

## 11. Success Criteria

- [ ] `calculate_seo_score()` returns 0–100 with breakdown dict for any caption string
- [ ] `classify_caption_batch()` completes in ≤ 25% of old sequential time (4x speedup)
- [ ] IG Story composite score includes 15% SEO weight; Reel includes 12%
- [ ] HTML report Section 7 renders all 7 panels with no JS errors
- [ ] `captionAnalysis` table created, migration runs cleanly
- [ ] Cron route processes 30 posts and upserts without error
- [ ] `/dashboard/intelligence/captions` loads with real data, all 4 components render
- [ ] ReanalyzeButton triggers re-analysis and updates UI without page reload
