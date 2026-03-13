# Creator Metrics — Technical Reference

**Last Updated:** 2026-03-07  
**System:** Vercel Next.js + Drizzle ORM + Supabase PostgreSQL + Railway FastAPI  
**Live:** `creator-metrics.vercel.app` | Sync Service: `exemplary-analysis-production.up.railway.app`

---

## Deliverable 1: Complete Creators Table Schema

### Core Table Definition
**Location:** `lib/schema.ts` (Drizzle ORM)

```typescript
creators: pgTable('creators', {
  id: text('id').primaryKey(),                    // 'nicki_entenmann', 'annbschulte', etc
  igUserId: bigint('ig_user_id'),                 // Instagram numeric ID for IG Business API
  username: text('username').unique(),             // Instagram handle (lowercase, no @)
  displayName: text('display_name'),               // Full display name for reports
  profilePictureUrl: text('profile_picture_url'), // Latest IG profile photo URL
  biography: text('biography'),                    // Latest IG bio text
  isOwned: boolean('is_owned').default(false),    // ENT Agency creator (true) vs. managed client (false)
  createdAt: timestamp('created_at').defaultNow(),// Timestamp when profile added to dashboard
  
  // Platform-specific IDs — set dynamically or via manual database updates
  mavelyCreatorId: text('mavely_creator_id'),     // Mavely creator name or ID
  shopmyUserId: text('shopmy_user_id'),           // ShopMy numeric user ID
  ltkPublisherId: text('ltk_publisher_id'),       // LTK publisher ID (e.g., "293045")
  amazonAssociateTag: text('amazon_associate_tag'), // Amazon tag (e.g., "nickientenmann-20")
})
```

### Relationships
- **Foreign Key Target:** All platform-specific tables reference `creators(id)`
- **Platform Earnings:** `(creator_id, platform, period_start, period_end)` unique constraint
- **Mavely Links:** `(creator_id, mavely_link_id, period_start, period_end)` unique constraint
- **ShopMy Tables:** Reference `creator_id` (foreign key with implicit delete cascade behavior)
- **Platform Connections:** Dynamic 1:1 mapping of `creator_id` → `(platform, is_connected, external_id)`

### Field Constraints
| Field | Type | Constraints | Purpose |
|-------|------|-----------|---------|
| `id` | text | PRIMARY KEY | System identifier across all tables |
| `igUserId` | bigint | Optional, Indexed | IG Business API calls for media/insights |
| `username` | text | UNIQUE, NOT NULL | Human-readable identifier + IG URL construction |
| `displayName` | text | Optional | Report headers, Slack notifications |
| `profilePictureUrl` | text | Optional | Dashboard avatars, report assets |
| `biography` | text | Optional | Search indexing, creator targeting |
| `isOwned` | boolean | DEFAULT false | ENT-owned (true) vs. client-managed (false) |
| `createdAt` | timestamp | DEFAULT NOW() | Data audit trail |
| `mavelyCreatorId` | text | Optional | Join key for Mavely API (usually creator name) |
| `shopmyUserId` | text | Optional | Join key for ShopMy API |
| `ltkPublisherId` | text | Optional | Join key for LTK GraphQL (publisher_id param) |
| `amazonAssociateTag` | text | Optional | Join key for Amazon Associates CSV download |

---

## Deliverable 2: Creator Addition & Seeding Mechanism

### Two-Layer Architecture

#### Layer 1: Static Configuration (`lib/creators.ts`)
Hard-coded creator list for immediate dashboard visibility without database queries.

```typescript
export const CREATORS = [
  {
    id: 'nicki_entenmann',
    igUserId: 81062767,
    username: 'nickientenmann',
    displayName: 'Nicki Entenmann',
    isOwned: true,
    ltkSlug: 'nicki_entenmann', // Deprecated — remove after Airtable migration
  },
  {
    id: 'annbschulte',
    igUserId: 123456789,
    username: 'annbschulte',
    displayName: 'Ann B Schulte',
    isOwned: true,
    ltkSlug: 'ann_schulte',
  },
  {
    id: 'ellenludwigfitness',
    igUserId: 987654321,
    username: 'ellenludwigfitness',
    displayName: 'Ellen Ludwig',
    isOwned: false,
    ltkSlug: 'ellen_ludwig',
  },
  {
    id: 'livefitwithem',
    igUserId: 555666777,
    username: 'livefitwithem',
    displayName: 'Emily (Live Fit With Em)',
    isOwned: true,
    ltkSlug: 'emily_fit',
  },
];
```

**Usage Pattern:**
- Vercel dashboard page: `app/dashboard/page.tsx` iterates CREATORS to populate sidebar
- Cron jobs: `/api/cron/collect` uses CREATORS list for parallel IG snapshot collection
- Fallback: If database query fails, CREATORS provides read-only fallback data

**When to Update:**
- New ENT creator partnership (set `isOwned: true`)
- New managed client creator (set `isOwned: false`)
- Add `igUserId` after IG account created

#### Layer 2: Dynamic Seeding (`drizzle/migrate-new-tables.sql`)
Database-of-record for persistent platform IDs and connection state.

```sql
-- Create creators table records from static config
INSERT INTO creators (id, username, display_name, ig_user_id, is_owned, created_at)
VALUES 
  ('nicki_entenmann', 'nickientenmann', 'Nicki Entenmann', 81062767, true, NOW()),
  ('annbschulte', 'annbschulte', 'Ann B Schulte', 123456789, true, NOW()),
  ('ellenludwigfitness', 'ellenludwigfitness', 'Ellen Ludwig', 987654321, false, NOW()),
  ('livefitwithem', 'livefitwithem', 'Emily (Live Fit With Em)', 555666777, true, NOW())
ON CONFLICT (id) DO NOTHING;

-- Track platform connection state
CREATE TABLE platform_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id text NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  platform platform NOT NULL, -- 'ltk', 'shopmy', 'mavely', 'amazon', 'instagram'
  is_connected boolean DEFAULT false,
  external_id text, -- Platform-specific account identifier
  last_synced_at timestamp,
  UNIQUE(creator_id, platform)
);
```

**Adding New Creator:**
1. Add entry to `CREATORS` array in `lib/creators.ts`
2. Run migration: `npm run drizzle:push`
3. Configure platform IDs via one of:
   - Sync service manual endpoint (Airtable for LTK, environment variables for Amazon)
   - Direct SQL INSERT/UPDATE via Supabase console
   - Future: Admin dashboard platform connection UI

---

## Deliverable 3: Platform ID Mappings Per Creator

### Field Reference
| Platform | Table Column | Schema Migration | External API Reference | Current Status |
|----------|--------------|------------------|----------------------|-----------------|
| **LTK** | `ltk_publisher_id` | 0004 (migrate-new-tables.sql) | publisher_id parameter in GraphQL | Nicki: "293045" |
| **ShopMy** | `shopmy_user_id` | 0004 | user_id or account ID | Not yet populated |
| **Mavely** | `mavely_creator_id` | 0004 | Creator name or ID | Not yet populated |
| **Amazon** | `amazon_associate_tag` | 0004 | Tag in CSV download URL | Nicki: "nickientenmann-20" |

### Current Creator Mapping
**Source:** Database + sync service configs. Last verified: 2026-03-07

#### Nicki Entenmann (`nicki_entenmann`)
```
creators.id                = 'nicki_entenmann'
creators.igUserId          = 81062767
creators.username          = 'nickientenmann'
creators.displayName       = 'Nicki Entenmann'
creators.isOwned           = true

creators.ltkPublisherId    = '293045' (env: AIRTABLE — LTK_Credentials table)
creators.mavelyCreatorId   = 'Nicki Entenmann' (from Mavely GraphQL)
creators.shopmyUserId      = NULL (not configured)
creators.amazonAssociateTag = 'nickientenmann-20' (env: AMAZON_NICKI_COOKIES)
```

#### Ann B Schulte (`annbschulte`)
```
creators.id                = 'annbschulte'
creators.igUserId          = [Not yet populated]
creators.username          = 'annbschulte'
creators.displayName       = 'Ann B Schulte'
creators.isOwned           = true

creators.ltkPublisherId    = NULL
creators.mavelyCreatorId   = NULL
creators.shopmyUserId      = NULL
creators.amazonAssociateTag = NULL (env: ANN_AMAZON_COOKIES exists)
```

#### Ellen Ludwig Fitness (`ellenludwigfitness`)
```
creators.id                = 'ellenludwigfitness'
creators.igUserId          = [Not yet populated]
creators.username          = 'ellenludwigfitness'
creators.displayName       = 'Ellen Ludwig'
creators.isOwned           = false

creators.ltkPublisherId    = NULL
creators.mavelyCreatorId   = NULL
creators.shopmyUserId      = NULL
creators.amazonAssociateTag = NULL (env: ELLEN_AMAZON_COOKIES exists)
```

#### Emily (Live Fit With Em) (`livefitwithem`)
```
creators.id                = 'livefitwithem'
creators.igUserId          = [Not yet populated]
creators.username          = 'livefitwithem'
creators.displayName       = 'Emily (Live Fit With Em)'
creators.isOwned           = true

creators.ltkPublisherId    = NULL
creators.mavelyCreatorId   = NULL
creators.shopmyUserId      = NULL
creators.amazonAssociateTag = NULL (env: EMILY_AMAZON_COOKIES exists)
```

### Population Strategy
- **LTK:** Stored in Airtable `LTK_Credentials` table, retrieved at token refresh time
- **Mavely:** Hardcoded in `sync_mavely.py` as "nicki_entenmann" for GraphQL API calls
- **ShopMy:** Not yet implemented (requires API documentation)
- **Amazon:** Stored in `CREATORS` list in `sync_amazon.py` with environment variable pattern `AMAZON_{CREATOR_ID}_COOKIES`

---

## Deliverable 4: Migration Files & Seed Scripts Documentation

### Migration Timeline & Schema Evolution

#### Migration 0000: `0000_open_the_phantom.sql`
**Purpose:** Initial schema foundation  
**Tables Created:** 8 core tables  
**Key Additions:**
- `creators` table with base fields (id, igUserId, username, displayName, etc.)
- `platform_earnings` with unique constraint `(creator_id, platform, period_start, period_end)`
- Enum types: `earnings_status`, `platform`, `user_role`
- Support tables: `creator_snapshots`, `media_snapshots`, `products`, `sales`, `user_roles`

**Why:** Establishes multi-platform earnings tracking with per-creator, per-platform, per-period aggregation

---

#### Migration 0001: `0001_shopmy_tables.sql`
**Purpose:** ShopMy affiliate platform integration  
**Tables Created:** 3 tables  
**Schema:**
```sql
shopmy_opportunity_commissions (
  id SERIAL PRIMARY KEY,
  creator_id TEXT FK,
  external_id TEXT UNIQUE,
  title TEXT,
  commission_amount NUMERIC,
  status earnings_status,
  synced_at TIMESTAMP
);

shopmy_payments (
  id SERIAL PRIMARY KEY,
  creator_id TEXT FK,
  external_id TEXT UNIQUE,
  amount NUMERIC,
  source TEXT,
  sent_at TIMESTAMP,
  synced_at TIMESTAMP
);

shopmy_brand_rates (
  id SERIAL PRIMARY KEY,
  creator_id TEXT FK,
  brand TEXT,
  rate NUMERIC,
  rate_returning NUMERIC,
  synced_at TIMESTAMP,
  UNIQUE(creator_id, brand)
);
```

**Why:** Track ShopMy-specific opportunity earnings and per-brand rate cards for forecasting

---

#### Migration 0002: `0002_affiliate_platforms.sql`
**Purpose:** Comprehensive affiliate data modeling with snapshots → transactions → aggregates → views  
**Tables Created:** 13 tables + 4 views + RLS policies + helper functions  
**Architecture:**

**Section 1: Snapshot Tables** (immutable audit trail)
```
shopmy_snapshots (creator_id, date_captured, payload JSONB)
amazon_snapshots (creator_id, date_captured, payload JSONB)
mavely_snapshots (creator_id, date_captured, payload JSONB)
```
Stores raw API responses for compliance + backfill capability

**Section 2: Transaction Tables** (normalized records)
```
shopmy_transactions (creator_id, external_id, commission_amount, order_value, etc.)
amazon_transactions (creator_id, external_id, product, commission, quantity, etc.)
mavely_transactions (creator_id, external_id, link_id, commission, order_value, etc.)
```

**Section 3: Aggregation Tables** (time-series metrics)
```
daily_platform_metrics (user_id, metric_date, platform, clicks, orders, items_sold, etc.)
monthly_platform_metrics (user_id, metric_month, platform, totals + averages + conversion_rate)
```

**Section 4: Unified Views** (cross-platform reporting)
```
unified_earnings           -- All transactions normalized
earnings_summary          -- Platform + period aggregates
platform_comparison       -- Side-by-side metrics
top_performers            -- Rank creators by revenue
```

**Section 5: Row-Level Security**
```sql
ALTER TABLE platform_earnings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ...;
CREATE POLICY "authenticated_users_own_data" ... (creator_name = auth.user_metadata->>'creator_name');
```

**Section 6: Helper Functions**
```sql
refresh_monthly_metrics(p_user_id uuid, p_month date)
  -- Aggregates daily_platform_metrics → monthly_platform_metrics
  -- Calculates: avg_order_value, conversion_rate, avg_commission_per_order
```

**Why:** Enables flexible reporting, audit compliance, and user-level data isolation

---

#### Migration 0003: `0003_reels_metrics.sql`
**Purpose:** Instagram Reels-specific metrics  
**Changes:**
```sql
ALTER TABLE media_snapshots ADD COLUMN reels_avg_watch_time_ms INTEGER;
ALTER TABLE media_snapshots ADD COLUMN reels_video_view_total_time_ms INTEGER;
```

**Why:** Capture watch time metrics introduced in Instagram Insights API

---

#### Migration 0004: `0004_mavely_graphql_tables.sql`
**Purpose:** Mavely GraphQL API schema  
**Tables Created:** 2 tables  
**Schema:**
```sql
mavely_links (
  id SERIAL PRIMARY KEY,
  creator_id TEXT FK,
  mavely_link_id TEXT NOT NULL,
  link_url TEXT,
  title TEXT,
  image_url TEXT,
  period_start DATE,
  period_end DATE,
  clicks INTEGER,
  orders INTEGER,
  commission NUMERIC,
  revenue NUMERIC,
  synced_at TIMESTAMP,
  UNIQUE(creator_id, mavely_link_id, period_start, period_end)
);

mavely_transactions (
  id SERIAL PRIMARY KEY,
  creator_id TEXT FK,
  mavely_transaction_id TEXT UNIQUE,
  mavely_link_id TEXT,
  link_url TEXT,
  referrer TEXT,
  commission_amount NUMERIC,
  order_value NUMERIC,
  sale_date DATE,
  status TEXT,
  synced_at TIMESTAMP
);
```

**Why:** Store per-link metrics and transaction details from Mavely GraphQL endpoints

---

#### Migration 0005: `0005_ltk_posts.sql`
**Purpose:** LTK post metrics tracking  
**Table Created:** 1 table  
**Schema:**
```sql
ltk_posts (
  id SERIAL PRIMARY KEY,
  creator_id TEXT FK,
  share_url TEXT NOT NULL, -- liketk.it/... join key
  date_published DATE,
  hero_image TEXT,
  clicks INTEGER,
  commissions NUMERIC,
  orders INTEGER,
  items_sold INTEGER,
  synced_at TIMESTAMP,
  UNIQUE(creator_id, share_url)
);
```

**Why:** Track LTK-specific post performance; join with `media_snapshots.link_url` for unified IG + LTK view

---

#### Migration 0006: `0006_security_fixes.sql`
**Purpose:** Security hardening per Supabase linter  
**Changes:**
1. **Enable RLS on 14 tables** (creators, creator_snapshots, media_snapshots, platform_connections, platform_earnings, products, sales, user_roles, shopmy_*, mavely_links, ltk_posts, ltk_snapshots)
   - Service role bypasses RLS (n8n can still write)
   - Anon/public access blocked by default

2. **Set `security_invoker = on` on 4 views**
   ```sql
   ALTER VIEW unified_earnings SET (security_invoker = on);
   ALTER VIEW earnings_summary SET (security_invoker = on);
   ALTER VIEW platform_comparison SET (security_invoker = on);
   ALTER VIEW top_performers SET (security_invoker = on);
   ```
   Views now respect caller's RLS policies instead of view creator's

3. **Fix `search_path = ''` on 3 functions** (prevents injection attacks)
   ```sql
   ALTER FUNCTION refresh_monthly_metrics(uuid, date) SET search_path = '';
   ALTER FUNCTION update_updated_at() SET search_path = '';
   ALTER FUNCTION calculate_content_epc() SET search_path = '';
   ```

**Why:** Supabase security compliance; prevent unauthorized data access

---

#### Migration `migrate-new-tables.sql`
**Purpose:** Platform ID schema + dynamic connection tracking  
**Changes:**
```sql
ALTER TABLE creators ADD COLUMN mavely_creator_id TEXT;
ALTER TABLE creators ADD COLUMN shopmy_user_id TEXT;
ALTER TABLE creators ADD COLUMN ltk_publisher_id TEXT;
ALTER TABLE creators ADD COLUMN amazon_associate_tag TEXT;

CREATE TABLE platform_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id TEXT FK,
  platform platform ENUM,
  is_connected BOOLEAN DEFAULT false,
  external_id TEXT,
  last_synced_at TIMESTAMP,
  UNIQUE(creator_id, platform)
);
```

**Why:** Enable dynamic platform enrollment without schema changes per platform

---

### Seed Script Pattern
**File:** `lib/creators.ts`  
**Pattern:** TypeScript static array exported for use in:
- Dashboard layout server components
- Cron job initialization
- Fallback data if database unavailable

**Future:** Replace with database-driven approach when multi-creator admin UI is built

---

## Deliverable 5: Sync Service Architecture

### System Overview
**Service:** Railway FastAPI (`exemplary-analysis-production.up.railway.app`)  
**Code Location:** `~/creator-metrics/sync-service/`  
**Orchestrator:** APScheduler (UTC timezone)  
**Database:** Supabase PostgreSQL via asyncpg

### Architecture Diagram
```
┌─────────────────────────────────────────────────────────────┐
│ Railway FastAPI Service (main.py)                           │
│ APScheduler + APScheduler AsyncIOScheduler (UTC)            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Job 1: job_ltk_token_refresh()      Every 3 hours (*/3)   │
│  ├─ refresh_ltk_tokens() [sync_ltk.py]                     │
│  │  ├─ Airtop CDP: Create session                          │
│  │  ├─ Playwright: Login to creator.shopltk.com            │
│  │  ├─ Intercept /oauth/token response                     │
│  │  ├─ Extract JWT (access_token, id_token, refresh_token)│
│  │  └─ Write to Airtable LTK_Credentials                  │
│  └─ Result: Tokens valid for 3-4 hours                    │
│                                                              │
│  Job 2: job_ltk_data_sync()          Daily 6:30 UTC       │
│  ├─ sync_ltk_data() [sync_ltk.py]                         │
│  │  ├─ Fetch from Airtable (recent tokens)               │
│  │  ├─ Query LTK GraphQL endpoints:                       │
│  │  │  ├─ /commissions_summary (lifetime)                │
│  │  │  └─ /performance_summary (7d + 30d windows)        │
│  │  └─ Upsert platform_earnings                          │
│  └─ Creator: nicki_entenmann (hardcoded)                 │
│                                                              │
│  Job 3: job_mavely_sync()            Daily 8:00 UTC       │
│  ├─ sync_mavely() [sync_mavely.py]                        │
│  │  ├─ Auth: NextAuth (CSRF → credentials → session JWT)  │
│  │  ├─ GraphQL queries:                                   │
│  │  │  ├─ creatorAnalyticsMetricsByEntity (90d links)    │
│  │  │  └─ allReports (30d transactions, cursor pagination)│
│  │  ├─ Upsert mavely_links (link-level metrics)          │
│  │  └─ Upsert platform_earnings (monthly aggregates)     │
│  └─ Creator: nicki_entenmann (hardcoded)                 │
│                                                              │
│  Job 4: job_amazon_sync()            Daily 9:00 UTC       │
│  ├─ sync_amazon() [sync_amazon.py]                        │
│  │  ├─ Multi-creator loop: CREATORS = [4 creators]       │
│  │  ├─ For each creator:                                  │
│  │  │  ├─ Check env var (AMAZON_{ID}_COOKIES)           │
│  │  │  ├─ Download CSV from affiliate-program.amazon.com │
│  │  │  ├─ Parse CSV: aggregates clicks + orders + commission
│  │  │  └─ Upsert platform_earnings                       │
│  │  └─ Return results array (per-creator status)         │
│  └─ Creators: all 4 (nicki, ann, ellen, emily)           │
│                                                              │
│  Manual Triggers: /sync/ltk-tokens, /sync/ltk,            │
│                   /sync/mavely, /sync/amazon               │
│                   (Bearer token auth)                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Module Breakdown

#### `main.py` — FastAPI Orchestrator
**Responsibility:** Schedule jobs, expose manual triggers, provide status dashboard

**Key Components:**
```python
class SyncConn:
    """Synchronous asyncpg wrapper for Supabase PgBouncer"""
    client: asyncpg.Connection  # statement_cache_size=0 for pooling compatibility
    
    def execute(sql, *args):
        """Run parameterized query, return rowcount"""
        
    def executemany(sql, args_list):
        """Batch insert/update"""

@app.on_event("startup")
async def startup():
    scheduler = AsyncIOScheduler(timezone='UTC')
    scheduler.add_job(job_ltk_token_refresh, 'cron', minute='*/3')
    scheduler.add_job(job_ltk_data_sync, 'cron', hour='6', minute='30')
    scheduler.add_job(job_mavely_sync, 'cron', hour='8', minute='0')
    scheduler.add_job(job_amazon_sync, 'cron', hour='9', minute='0')
    scheduler.start()

@app.post('/sync/ltk-tokens')
async def manual_ltk_tokens(Authorization: str):
    return await job_ltk_token_refresh()

@app.get('/')
async def dashboard():
    """HTML status page with last sync times"""
```

**Endpoint Reference:**
| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| POST | `/sync/ltk-tokens` | Refresh LTK tokens immediately | Bearer |
| POST | `/sync/ltk` | Sync LTK data (7d + 30d) | Bearer |
| POST | `/sync/mavely` | Sync Mavely data (links + aggregates) | Bearer |
| POST | `/sync/amazon` | Sync Amazon data (all creators) | Bearer |
| GET | `/health` | Service status | None |
| GET | `/` | Status dashboard (HTML) | None |

**Bearer Token:** `SYNC_RAILWAY_SECRET` environment variable (defined in Railway)

---

#### `sync_ltk.py` — LTK Token Refresh & Data Sync
**Platform:** RewardStyle (LTK) GraphQL API  
**Architecture:** Two-phase (token refresh + data sync)

**Phase 1: Token Refresh (`refresh_ltk_tokens`)**
```
Goal: Obtain fresh Auth0 tokens (valid 3-4 hours)

Flow:
  1. Create Airtop session (browser automation API)
  2. Open https://creator.shopltk.com/login via Playwright
  3. Fill login credentials (env: LTK_EMAIL, LTK_PASSWORD)
  4. Intercept /oauth/token response (network listener)
  5. Extract: access_token, id_token, refresh_token
  6. Decode JWT: extract exp timestamp → calculate Token_Expires_At
  7. Write to Airtable LTK_Credentials table
  8. Terminate Airtop session

Implementation: Airtop API via urllib (3 helpers for session lifecycle)
Return: {status: "ok", expires_in_hours: 1}
```

**Fallback Strategy:**
- Primary: Network interception during login flow
- Secondary: localStorage extraction (@@auth0spajs@@ key)
- Tertiary: Error if both fail → require re-run of extract_amazon_cookies.py equivalent

**Phase 2: Data Sync (`sync_ltk_data`)**
```
Goal: Fetch commissions + performance metrics

Headers:
  Authorization: Bearer {access_token}
  x-id-token: {id_token}
  Origin: https://creator.shopltk.com
  Referer: https://creator.shopltk.com/
  User-Agent: Mozilla/5.0 ...

Endpoints:
  1. GET /api/creator-analytics/v1/commissions_summary?currency=USD
     Response: {commissions_summary: {open_earnings: X, pending: Y}}
  
  2. GET /api/creator-analytics/v1/performance_summary
     Params: {
       start_date: "2026-02-07T00:00:00Z",  # 7 days ago
       end_date: "2026-03-07T23:59:59Z",    # today
       publisher_ids: "293045",              # hardcoded
       platform: "rs,ltk",
       timezone: "UTC"
     }
     Response: {data: {net_commissions: X, clicks: Y, orders: Z}}
  
  [Repeat for 30d window]

Database Upsert:
  INSERT INTO platform_earnings
    (creator_id='nicki_entenmann', platform='ltk', 
     period_start, period_end, revenue, commission, clicks, orders, synced_at)
  VALUES (...)
  ON CONFLICT (creator_id, platform, period_start, period_end)
  DO UPDATE SET ...
```

**Known Limitations:**
- Hardcoded `creator_id='nicki_entenmann'` (line 297)
- Single-creator implementation; other creators (ann, ellen, emily) not yet supported
- LTK tokens stored externally in Airtable (extra API call overhead)

---

#### `sync_mavely.py` — Mavely GraphQL Sync
**Platform:** Mavely (Influencer affiliate network)  
**Architecture:** Token auth → GraphQL queries → paginated results → database upsert

**Authentication (`get_mavely_token`)**
```
Flow (NextAuth CSRF + Credentials):
  1. GET /api/auth/csrf → csrfToken
  2. POST /api/auth/callback/credentials
     Body: csrfToken, email, password, redirect=false, json=true
  3. GET /api/auth/session → {token: JWT}
  
Return: Opaque session JWT for Authorization header
```

**Link Metrics (`fetch_link_metrics`)**
```
GraphQL Query: creatorAnalyticsMetricsByEntity
Variables:
  v1: {cstDateStr_gte: "2025-12-07", cstDateStr_lte: "2026-03-07", entity: "LINK"}
  v2: "sales_DESC"
  v3: 100  # page size
  v4: 0    # skip (pagination)

Response per link:
  {
    link_id, link_url, title, image_url,
    clicks, orders, commission, revenue
  }

Pagination: Loop while rows.length < page_size
Uniqueness: (creator_id, mavely_link_id, period_start, period_end)
```

**Transactions (`fetch_transactions`)**
```
GraphQL Query: allReports
Variables:
  v1: {date_gte: "2026-02-07", date_lte: "2026-03-07"}
  v2: "date_DESC"
  v3: 100  # page size
  v4: 0
  v5: cursor  # null on first request

Response per transaction:
  {
    transaction_id, link_id, link_url, referrer,
    commission, order_value, sale_date, status
  }

Pagination: Cursor-based (PageInfo.endCursor)
Max pages: 50 (default limit, configurable)
Current status: **SKIPPED** — migration 0004 creates schema but sync_mavely.py
              doesn't insert. Comment: "schema migration needed"
```

**Platform Earnings Upsert**
```
Period: Calendar month (month_start → month_end of current month)
Aggregation: SUM(clicks, orders, commission, revenue) across all links

INSERT INTO platform_earnings
  (creator_id='nicki_entenmann', platform='mavely',
   period_start=month_start, period_end=month_end,
   revenue, commission, clicks, orders, synced_at)
VALUES (...)
ON CONFLICT (creator_id, platform, period_start, period_end)
DO UPDATE SET ...
```

**Known Limitations:**
- Hardcoded `creator_id='nicki_entenmann'` (lines 209, 250)
- Transaction insert skipped; only link metrics + monthly aggregates stored
- Single-creator implementation

---

#### `sync_amazon.py` — Amazon Associates CSV Sync
**Platform:** Amazon Associates (affiliate program)  
**Architecture:** Cookie-based session auth → HTTP CSV download → CSV parsing → database upsert

**Multi-Creator Support**
```
CREATORS = [
  {id: 'nicki_entenmann', cookies_env: 'AMAZON_NICKI_COOKIES', tag: 'nickientenmann-20'},
  {id: 'annbschulte', cookies_env: 'ANN_AMAZON_COOKIES', tag: None},
  {id: 'ellenludwigfitness', cookies_env: 'ELLEN_AMAZON_COOKIES', tag: None},
  {id: 'livefitwithem', cookies_env: 'EMILY_AMAZON_COOKIES', tag: None},
]

For each creator:
  1. Check if cookies_env exists in os.environ
  2. If not: log warning, skip, return {status: 'skipped'}
  3. If yes: proceed with download/parse/upsert
```

**Cookie Authentication (`_parse_cookie_str`)**
```
Input: "name1=value1; name2=value2; ..."
Parse: Split by ';', extract key=value pairs → dict

Usage: httpx.Client(cookies=cookies_dict)
Authentication: Session cookies maintained from extract_amazon_cookies.py
```

**CSV Download (`_download_csv`)**
```
URL: https://affiliate-program.amazon.com/home/reports/download
Params:
  reportType=earning
  dateRangeValue=custom
  startDate={period_start}  # First day of month
  endDate={period_end}      # Last day of month

Headers: Mozilla/5.0 User-Agent, Accept-Language, Referer

Validation:
  1. Status 200?
  2. No redirect to login page (check for "ap_email", "signin" in response)?
  3. Content length > 20 and contains "Date" header?
  
Return: CSV content string or None
```

**CSV Parsing (`_parse_csv`)**
```
Columns (Amazon Associates earnings CSV):
  Date, Clicks, Ordered Items, Shipped Items, Returns,
  Revenue, Converted Clicks, Total Commissions

Aggregation:
  clicks = SUM(Clicks)
  orders = SUM(Shipped Items)  # "orders" terminology
  commission = SUM(Total Commissions)
  revenue = commission (same value)

Filtering:
  Skip rows where Date is empty, "date", "total", "totals"

Conversion:
  clicks → int(float)  # Handle decimals
  orders → int(float)
  commission → float, rounded to 2 decimals
  
Return: {clicks, orders, revenue, commission}
```

**Period Aggregation**
```
Period: Calendar month (synchronized with other platforms)
  month_start = date(today.year, today.month, 1)
  month_end = date(today.year, today.month+1, 1) - timedelta(1)
  Special case: if today.month == 12, month_end = date(today.year+1, 1, 1) - timedelta(1)

INSERT INTO platform_earnings
  (creator_id, platform='amazon',
   period_start=month_start, period_end=month_end,
   revenue, commission, clicks, orders, synced_at)
VALUES (...)
ON CONFLICT (creator_id, platform, period_start, period_end)
DO UPDATE SET ...
```

**Multi-Creator Results**
```
Return: {
  synced_at: datetime,
  results: [
    {creator: 'nicki_entenmann', status: 'ok', clicks: X, orders: Y, commission: Z},
    {creator: 'annbschulte', status: 'no_data'},
    {creator: 'ellenludwigfitness', status: 'skipped', reason: 'no cookies'},
    ...
  ]
}
```

**Known Patterns:**
- **Only Amazon uses multi-creator pattern** (CREATORS list)
- LTK & Mavely hardcoded to single creator (nicki_entenmann)
- Cookie refresh requires manual re-run of extract_amazon_cookies.py when they expire

---

### Job Scheduling Configuration

**Timezone:** UTC (APScheduler defaults to UTC unless specified)

**Cron Expressions:**
```python
APScheduler cron spec (minute, hour, day, month, day_of_week)

job_ltk_token_refresh:   'cron', minute='*/3'              # Every 3 hours (0, 3, 6, ..., 21)
job_ltk_data_sync:       'cron', hour='6', minute='30'     # 6:30 UTC daily
job_mavely_sync:         'cron', hour='8', minute='0'      # 8:00 UTC daily
job_amazon_sync:         'cron', hour='9', minute='0'      # 9:00 UTC daily
```

**Execution Order (Daily 6:00-9:30 UTC Window):**
```
6:30 UTC  → LTK data sync (depends on tokens from 6:00 or 3:00)
8:00 UTC  → Mavely sync (independent)
9:00 UTC  → Amazon sync (independent)
```

**Why This Schedule:**
- 3-hour LTK token refresh: Tokens valid 3-4 hours; refresh ensures latest available before sync
- 6:30 LTK sync: After token refresh (6:00-6:30), in UTC early morning (US night)
- 8:00 Mavely: Independent, staggered from LTK
- 9:00 Amazon: Latest in sequence, allows time for upstream syncs
- All times: UTC morning = US night (minimizes impact on user-facing services)

---

### Database Connection Pattern

**Supabase PostgreSQL + PgBouncer (Vercel compatibility)**
```python
class SyncConn:
    """Wraps asyncpg.Connection for sync context"""
    
    def __init__(self, connection_string: str):
        # statement_cache_size=0 — CRITICAL for PgBouncer pooling
        # Otherwise: prepared statements cached on backend, pooler routes
        #          different backends, stmt cache mismatch → errors
        self.client = asyncpg.connect(
            connection_string,
            command_timeout=30,
            server_settings={'statement_cache_size': 0}
        )
    
    def execute(self, sql: str, *args) -> int:
        """Run DML, return affected rows"""
        return self.client.execute(sql, *args)
    
    def executemany(self, sql: str, args_list: list[tuple]) -> None:
        """Batch insert/update (no return value)"""
        self.client.executemany(sql, args_list)

# Usage in job functions:
def sync_ltk_data(conn: SyncConn) -> dict:
    conn.execute(
        "INSERT INTO platform_earnings ... ON CONFLICT ... DO UPDATE ...",
        creator_id, period_start, period_end, revenue, commission, ...
    )
```

**Connection Pool Management:**
```python
# Vercel serverless: no persistent connection pool
# Each Railway job creates new connection for duration of job, then closes
# APScheduler + asyncpg handles lifecycle automatically

# For RLS + service role bypass:
# Database user: `service_role` (created by Supabase)
# Behavior: INSERT/UPDATE without RLS policy checks
# Purpose: Sync service writes to all creators' data without per-user filtering
```

---

### Error Handling & Retry Pattern

**Per-Creator Isolation (Amazon)**
```python
for creator in CREATORS:
    try:
        csv_content = _download_csv(...)
        earnings = _parse_csv(csv_content)
        conn.execute(...)
    except Exception as e:
        logger.error(f"Amazon sync failed for {creator_id}: {e}", exc_info=True)
        results.append({creator: creator_id, status: 'error', error: str(e)})
        continue  # Continue to next creator
```

**Token Expiration Detection (LTK)**
```python
# CSV download checks:
if "ap_email" in content or "signin" in resp.url.path.lower():
    logger.warning("Redirected to login — cookies expired. Re-run extract_amazon_cookies.py")
    return None

# LTK Airtop session timeout:
if status != "running" after 30s:
    raise RuntimeError("Airtop session never reached running state")
    # Job fails; manual intervention required
```

**Logging Strategy**
```python
logger.info("Amazon sync — period: %s → %s", start_str, end_str)  # Job start
logger.info("=== Syncing Amazon for %s ===", creator_id)          # Per-creator
logger.info("Parsed %d CSV rows: clicks=%d, ...", rows, clicks)   # Parse result
logger.info("Upserted Amazon earnings for %s: %s", creator_id, earnings)  # Success
logger.warning("No cookies for %s", creator_id)                   # Skip reason
logger.error("Amazon sync failed for %s: %s", creator_id, error)  # Failure
```

---

## Summary: Multi-Creator Readiness Checklist

| Component | Nicki | Ann | Ellen | Emily | Status |
|-----------|-------|-----|-------|-------|--------|
| **Creators table** | ✅ | ✅ | ✅ | ✅ | Complete |
| **IG metadata** | ✅ | ❌ | ❌ | ❌ | Nicki only |
| **LTK tokens (Airtable)** | ✅ | ❌ | ❌ | ❌ | Nicki only |
| **LTK publisher_id** | ✅ (293045) | ❌ | ❌ | ❌ | Nicki only |
| **Mavely auth + sync** | ✅ | ❌ | ❌ | ❌ | Nicki hardcoded |
| **Mavely creator_id** | ✅ | ❌ | ❌ | ❌ | Nicki only |
| **Amazon cookies** | ✅ | ✅ (env var) | ✅ (env var) | ✅ (env var) | All have env |
| **Amazon tag** | ✅ | ❌ | ❌ | ❌ | Nicki only |
| **ShopMy integration** | ❌ | ❌ | ❌ | ❌ | Not yet built |
| **platform_earnings aggregates** | ✅ (LTK, Amazon, Mavely) | ✅ (Amazon only) | ✅ (Amazon only) | ✅ (Amazon only) | Partial |

**Next Steps (Priority Order):**
1. **Populate platform IDs** for Ann/Ellen/Emily via Supabase console or manual SQL
2. **Parameterize LTK sync** to iterate creators (not hardcoded)
3. **Parameterize Mavely sync** to iterate creators
4. **Implement ShopMy GraphQL integration** (research API, add sync module)
5. **Implement ShopMy token refresh** (research auth mechanism)
6. **Enable transaction inserts** for Mavely (uncomment + test)

