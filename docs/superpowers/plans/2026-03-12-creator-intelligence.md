# Creator Intelligence Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Content Intelligence section to creator-metrics with semantic post search, nightly AI analysis, on-demand Q&A, trends charts, and Instagram OAuth creator onboarding.

**Architecture:** Extends the existing Next.js 14 + Drizzle + Supabase stack. New `creator_intelligence` and `creator_tokens` tables. Gemini embedding model (`gemini-embedding-2-preview`) powers search via pgvector. Claude `claude-sonnet-4-6` powers nightly analysis (tool_use) and streaming Q&A (Vercel AI SDK). Instagram OAuth stores permanent Page Access Tokens — no refresh logic needed.

**Tech Stack:** Next.js 14 App Router, Drizzle ORM, Supabase pgvector, Clerk auth, `@google/genai`, `ai` (Vercel AI SDK), `@ai-sdk/anthropic`, Python + Anthropic SDK (Railway cron)

**Spec:** `docs/superpowers/specs/2026-03-12-creator-intelligence-design.md`

---

## File Map

### New files
| File | Responsibility |
|---|---|
| `lib/schema.ts` | Add `creatorIntelligence` + `creatorTokens` Drizzle tables |
| `lib/embeddings.ts` | Gemini embed client — one exported `embedText(query)` function |
| `lib/creator-scope.ts` | RBAC — `getCreatorScope(userId, role, requestedId?)` |
| `lib/intelligence-queries.ts` | All Supabase/Drizzle reads for intelligence routes |
| `app/onboarding/page.tsx` | "Connect Instagram" page with form + error states |
| `app/onboarding/actions.ts` | `startOAuth` Server Action — sets CSRF cookie + redirects |
| `app/api/auth/instagram/callback/route.ts` | OAuth callback — token exchange + upsert creator_tokens |
| `app/api/intelligence/search/route.ts` | POST — embed query + pgvector search |
| `app/api/intelligence/ask/route.ts` | POST — embed + search context + stream Claude response |
| `app/api/intelligence/trends/route.ts` | GET — follower history + engagement by type + top posts |
| `app/dashboard/intelligence/layout.tsx` | Tab nav for search / insights / trends |
| `app/dashboard/intelligence/search/page.tsx` | Search UI — grid of results |
| `app/dashboard/intelligence/insights/page.tsx` | Insights UI — analysis cards + Q&A chat |
| `app/dashboard/intelligence/trends/page.tsx` | Trends UI — charts |
| `components/CreatorSelector.tsx` | Admin dropdown — switches `?creatorId` query param |
| `components/IntelligenceTabs.tsx` | Client component — tab nav that preserves `?creatorId` |
| `nicki-embeddings/intelligence_sync.py` | Nightly Claude analysis cron |

### Modified files
| File | Change |
|---|---|
| `lib/schema.ts` | Append two new table exports |
| `app/dashboard/layout.tsx` | Add Intelligence nav item + CreatorSelector for admins + creator gate |
| `middleware.ts` | Add `/onboarding` to public routes |
| `package.json` | Add `ai`, `@google/genai`, `@ai-sdk/anthropic` |

---

## Chunk 1: Infrastructure & Dependencies

### Task 1: Install new npm packages

**Files:**
- Modify: `package.json`

- [ ] Install Vercel AI SDK, Google Generative AI, Anthropic SDK:
  ```bash
  cd ~/creator-metrics
  npm install ai @google/genai @ai-sdk/anthropic
  ```
- [ ] Verify install succeeded:
  ```bash
  node -e "require('@google/genai'); require('@ai-sdk/anthropic'); require('ai'); console.log('OK')"
  ```
- [ ] Commit:
  ```bash
  git add package.json package-lock.json
  git commit -m "chore: add ai, @google/genai, @ai-sdk/anthropic"
  ```

---

### Task 2: Add Drizzle schema for new tables

**Files:**
- Modify: `lib/schema.ts`

- [ ] Append to `lib/schema.ts` (after existing exports):
  ```ts
  import {
    pgTable,
    text,
    boolean,
    timestamp,
    serial,
    integer,
    date,
    unique,
    jsonb,
    uniqueIndex,
  } from "drizzle-orm/pg-core";
  import { sql } from "drizzle-orm";

  // Add these two exports at the bottom of lib/schema.ts:

  export const creatorIntelligence = pgTable(
    "creator_intelligence",
    {
      id:          serial("id").primaryKey(),
      creatorId:   text("creator_id").notNull(),
      generatedAt: date("generated_at").notNull(),
      analysis:    jsonb("analysis").notNull(),
    },
    (t) => [uniqueIndex("creator_intelligence_creator_date_idx").on(t.creatorId, t.generatedAt)]
  );

  export const creatorTokens = pgTable("creator_tokens", {
    id:          serial("id").primaryKey(),
    clerkUserId: text("clerk_user_id").notNull().unique(),
    creatorId:   text("creator_id").notNull().unique(),
    igUserId:    text("ig_user_id").notNull(),
    accessToken: text("access_token").notNull(),
    expiresAt:   timestamp("expires_at", { withTimezone: true })
                   .notNull()
                   .default(sql`'2099-01-01'::timestamptz`),
    updatedAt:   timestamp("updated_at", { withTimezone: true }).defaultNow(),
  });
  ```
  > Note: also add `jsonb` and `uniqueIndex` to the existing import at the top of the file.

- [ ] Push schema to Supabase:
  ```bash
  cd ~/creator-metrics
  doppler run --project ent-agency-automation --config prd -- npm run db:push
  ```
  Expected: tables `creator_intelligence` and `creator_tokens` created in Supabase.

- [ ] Commit:
  ```bash
  git add lib/schema.ts
  git commit -m "feat: add creator_intelligence and creator_tokens schema"
  ```

---

### Task 3: Update pgvector search function in Supabase

**Files:**
- Supabase SQL editor (manual step)

- [ ] Open Supabase dashboard → SQL editor. Run:
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
- [ ] Verify it runs without error. No commit needed (DB-only change).

---

### Task 4: Set up Doppler secrets

- [ ] Copy Anthropic key and add new secrets to `ent-agency-automation/prd`:
  ```bash
  ANTHROPIC_KEY=$(doppler secrets get ANTHROPIC_2_API_KEY --project example-project --config prd --plain)
  doppler secrets set \
    ANTHROPIC_2_API_KEY="$ANTHROPIC_KEY" \
    --project ent-agency-automation --config prd
  ```
- [ ] Add Gemini key (get from aistudio.google.com → API keys):
  ```bash
  doppler secrets set \
    GOOGLE_GEMINI_API_KEY="<paste key here>" \
    --project ent-agency-automation --config prd
  ```
- [ ] Add app URL (get your Vercel domain from vercel.com dashboard):
  ```bash
  doppler secrets set \
    NEXT_PUBLIC_APP_URL="https://<your-vercel-domain>.vercel.app" \
    --project ent-agency-automation --config prd
  ```
- [ ] Verify all three are set:
  ```bash
  doppler secrets get ANTHROPIC_2_API_KEY GOOGLE_GEMINI_API_KEY NEXT_PUBLIC_APP_URL \
    --project ent-agency-automation --config prd
  ```

---

## Chunk 2: Core Libraries

### Task 5: Gemini embeddings client

**Files:**
- Create: `lib/embeddings.ts`

- [ ] Create `lib/embeddings.ts`:
  ```ts
  import { GoogleGenAI } from "@google/genai";

  const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY! });

  export async function embedText(text: string): Promise<number[]> {
    const result = await genai.models.embedContent({
      model: "gemini-embedding-2-preview",
      contents: text,
      config: { outputDimensionality: 3072 },
    });
    return result.embeddings[0].values!;
  }
  ```
- [ ] Quick smoke test — run locally with Doppler:
  ```bash
  cd ~/creator-metrics
  doppler run --project ent-agency-automation --config prd -- node -e "
  const { embedText } = require('./lib/embeddings.ts')
  " 2>&1 | head -5
  ```
  (TypeScript won't run directly — just verify `npm run build` doesn't error after this file is added in Task 14.)

- [ ] Commit:
  ```bash
  git add lib/embeddings.ts
  git commit -m "feat: add Gemini embeddings client"
  ```

---

### Task 6: RBAC helper

**Files:**
- Create: `lib/creator-scope.ts`

- [ ] Create `lib/creator-scope.ts`:
  ```ts
  import { db } from "./db";
  import { creatorTokens } from "./schema";
  import { eq, sql } from "drizzle-orm";

  export async function getCreatorScope(
    clerkUserId: string,
    role: string | undefined,
    requestedCreatorId?: string
  ): Promise<{ creatorId: string }> {
    if (role === "admin") {
      if (!requestedCreatorId) {
        throw new Error("MISSING_CREATOR_ID");
      }
      // Validate against creator_posts (distinct creator_ids)
      const result = await db.execute(
        sql`SELECT DISTINCT creator_id FROM creator_posts WHERE creator_id = ${requestedCreatorId} LIMIT 1`
      );
      if (result.rows.length === 0) {
        throw new Error("UNKNOWN_CREATOR_ID");
      }
      return { creatorId: requestedCreatorId };
    }

    // creator role (or no role)
    const [token] = await db
      .select({ creatorId: creatorTokens.creatorId })
      .from(creatorTokens)
      .where(eq(creatorTokens.clerkUserId, clerkUserId))
      .limit(1);

    if (!token) {
      throw new Error("NO_TOKEN");
    }
    return { creatorId: token.creatorId };
  }
  ```
- [ ] Commit:
  ```bash
  git add lib/creator-scope.ts
  git commit -m "feat: add creator RBAC scope helper"
  ```

---

### Task 7: Intelligence queries

**Files:**
- Create: `lib/intelligence-queries.ts`

- [ ] Create `lib/intelligence-queries.ts`:
  ```ts
  import { db } from "./db";
  import { creatorIntelligence, creatorSnapshots } from "./schema";
  import { eq, desc, and, gte, sql } from "drizzle-orm";

  export async function getTodayAnalysis(creatorId: string) {
    const today = new Date().toISOString().split("T")[0];
    const [row] = await db
      .select()
      .from(creatorIntelligence)
      .where(
        and(
          eq(creatorIntelligence.creatorId, creatorId),
          eq(creatorIntelligence.generatedAt, today)
        )
      )
      .limit(1);
    return row ?? null;
  }

  export async function getFollowerHistory(creatorId: string, days: number | null) {
    const query = db
      .select({
        date: creatorSnapshots.capturedAt,
        followers: creatorSnapshots.followersCount,
      })
      .from(creatorSnapshots)
      .where(
        days
          ? and(
              eq(creatorSnapshots.creatorId, creatorId),
              gte(
                creatorSnapshots.capturedAt,
                sql`(CURRENT_DATE - ${days} * INTERVAL '1 day')::date`
              )
            )
          : eq(creatorSnapshots.creatorId, creatorId)
      )
      .orderBy(creatorSnapshots.capturedAt);
    return query;
  }

  export async function getEngagementByType(creatorId: string, since: string | null) {
    const result = since
      ? await db.execute(sql`
          SELECT
            media_product_type AS type,
            ROUND(AVG(reach))  AS avg_reach,
            ROUND(AVG(saves))  AS avg_saves,
            ROUND(AVG(shares)) AS avg_shares
          FROM creator_posts
          WHERE creator_id = ${creatorId} AND posted_at >= ${since}::timestamptz
          GROUP BY media_product_type
          ORDER BY avg_reach DESC NULLS LAST
        `)
      : await db.execute(sql`
          SELECT
            media_product_type AS type,
            ROUND(AVG(reach))  AS avg_reach,
            ROUND(AVG(saves))  AS avg_saves,
            ROUND(AVG(shares)) AS avg_shares
          FROM creator_posts
          WHERE creator_id = ${creatorId}
          GROUP BY media_product_type
          ORDER BY avg_reach DESC NULLS LAST
        `);
    return result.rows as { type: string; avg_reach: number; avg_saves: number; avg_shares: number }[];
  }

  export async function getTopPosts(creatorId: string, since: string | null, limit = 10) {
    const result = since
      ? await db.execute(sql`
          SELECT post_id, image_url, saves, reach, posted_at
          FROM creator_posts
          WHERE creator_id = ${creatorId} AND posted_at >= ${since}::timestamptz
          ORDER BY saves DESC NULLS LAST
          LIMIT ${limit}
        `)
      : await db.execute(sql`
          SELECT post_id, image_url, saves, reach, posted_at
          FROM creator_posts
          WHERE creator_id = ${creatorId}
          ORDER BY saves DESC NULLS LAST
          LIMIT ${limit}
        `);
    return result.rows as { post_id: string; image_url: string; saves: number; reach: number; posted_at: string }[];
  }

  export async function getAllCreatorIds(): Promise<string[]> {
    const result = await db.execute(
      sql`SELECT DISTINCT creator_id FROM creator_posts ORDER BY creator_id`
    );
    return result.rows.map((r: any) => r.creator_id);
  }
  ```
- [ ] Commit:
  ```bash
  git add lib/intelligence-queries.ts
  git commit -m "feat: add intelligence DB query helpers"
  ```

---

## Chunk 3: Instagram OAuth

### Task 8: Middleware — add `/onboarding` to public routes

**Files:**
- Modify: `middleware.ts`

- [ ] Update `middleware.ts` to add `/onboarding` and `/api/auth/instagram/callback` to public routes:
  ```ts
  const isPublicRoute = createRouteMatcher([
    "/sign-in(.*)",
    "/sign-up(.*)",
    "/api/cron/(.*)",
    "/onboarding(.*)",
    "/api/auth/instagram/(.*)",
  ]);
  ```
- [ ] Commit:
  ```bash
  git add middleware.ts
  git commit -m "feat: add onboarding and instagram auth to public routes"
  ```

---

### Task 9: Onboarding page + Server Action

**Files:**
- Create: `app/onboarding/page.tsx`
- Create: `app/onboarding/actions.ts`

- [ ] Create `app/onboarding/actions.ts`:
  ```ts
  "use server";
  import { cookies } from "next/headers";
  import { redirect } from "next/navigation";

  export async function startOAuth() {
    const state = crypto.randomUUID();
    const cookieStore = await cookies();
    cookieStore.set("ig_oauth_state", state, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 300,
    });

    const url = new URL("https://www.facebook.com/v21.0/dialog/oauth");
    url.searchParams.set("client_id", process.env.META_APP_ID!);
    url.searchParams.set(
      "redirect_uri",
      `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/instagram/callback`
    );
    url.searchParams.set(
      "scope",
      "pages_show_list,instagram_basic,instagram_manage_insights,pages_read_engagement"
    );
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    redirect(url.toString());
  }
  ```

- [ ] Create `app/onboarding/page.tsx`:
  ```tsx
  import { startOAuth } from "./actions";

  export default function OnboardingPage({
    searchParams,
  }: {
    searchParams: { error?: string };
  }) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="max-w-md w-full text-center space-y-6 px-6">
          <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center mx-auto">
            <span className="text-white font-bold text-2xl">CM</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Connect your Instagram</h1>
          <p className="text-gray-400">
            Link your account to see your analytics dashboard.
          </p>

          {searchParams.error === "already_claimed" && (
            <p className="text-red-400 text-sm bg-red-950 rounded-lg px-4 py-3">
              This Instagram account is already connected to another login.
            </p>
          )}
          {searchParams.error === "true" && (
            <p className="text-red-400 text-sm bg-red-950 rounded-lg px-4 py-3">
              Connection failed. Please try again.
            </p>
          )}

          <form action={startOAuth}>
            <button
              type="submit"
              className="w-full bg-gradient-to-r from-blue-500 to-purple-600 text-white font-semibold py-3 px-6 rounded-xl hover:opacity-90 transition-opacity"
            >
              Connect Instagram
            </button>
          </form>
        </div>
      </div>
    );
  }
  ```
- [ ] Commit:
  ```bash
  git add app/onboarding/
  git commit -m "feat: add Instagram OAuth onboarding page"
  ```

---

### Task 10: OAuth callback route

**Files:**
- Create: `app/api/auth/instagram/callback/route.ts`

- [ ] Create `app/api/auth/instagram/callback/route.ts`:
  ```ts
  import { NextRequest, NextResponse } from "next/server";
  import { auth } from "@clerk/nextjs/server";
  import { cookies } from "next/headers";
  import { db } from "@/lib/db";
  import { creatorTokens } from "@/lib/schema";

  const APP_URL = process.env.NEXT_PUBLIC_APP_URL!;
  const APP_ID  = process.env.META_APP_ID!;
  const APP_SEC = process.env.META_APP_SECRET!;
  const REDIRECT_URI = `${APP_URL}/api/auth/instagram/callback`;

  async function igGet(url: string) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`IG API error: ${r.status} ${await r.text()}`);
    return r.json();
  }

  export async function GET(req: NextRequest) {
    const { searchParams } = req.nextUrl;
    const code  = searchParams.get("code");
    const state = searchParams.get("state");
    const cookieStore = await cookies();
    const savedState = cookieStore.get("ig_oauth_state")?.value;

    if (!code || !state || state !== savedState) {
      return NextResponse.redirect(`${APP_URL}/onboarding?error=true`);
    }

    try {
      const { userId } = await auth();
      if (!userId) return NextResponse.redirect(`${APP_URL}/sign-in`);

      // 1. Short-lived token
      const shortRes = await fetch(
        `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${APP_ID}&client_secret=${APP_SEC}&code=${code}&redirect_uri=${REDIRECT_URI}`,
        { method: "POST" }
      );
      const { access_token: shortToken } = await shortRes.json();

      // 2. Long-lived user token
      const longData = await igGet(
        `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SEC}&fb_exchange_token=${shortToken}`
      );
      const longUserToken = longData.access_token;

      // 3. Get Pages — find one with instagram_business_account
      const pagesData = await igGet(
        `https://graph.facebook.com/v21.0/me/accounts?fields=id,access_token,instagram_business_account&access_token=${longUserToken}`
      );
      const page = pagesData.data?.find((p: any) => p.instagram_business_account);
      if (!page) return NextResponse.redirect(`${APP_URL}/onboarding?error=true`);

      const pageToken = page.access_token;
      const igUserId  = page.instagram_business_account.id;

      // 4. Get username
      const igData = await igGet(
        `https://graph.facebook.com/v21.0/${igUserId}?fields=username&access_token=${pageToken}`
      );
      const username  = igData.username;
      const creatorId = username.replace(/\./g, "_").toLowerCase();

      // 5. Upsert creator_tokens
      await db.insert(creatorTokens).values({
        clerkUserId: userId,
        creatorId,
        igUserId,
        accessToken: pageToken,
      }).onConflictDoUpdate({
        target: creatorTokens.clerkUserId,
        set: { accessToken: pageToken, igUserId, updatedAt: new Date() },
      });

      // Clear CSRF cookie
      cookieStore.delete("ig_oauth_state");
      return NextResponse.redirect(`${APP_URL}/dashboard/intelligence`);

    } catch (err: any) {
      console.error("OAuth callback error:", err);
      if (err.message?.includes("unique") || err.code === "23505") {
        return NextResponse.redirect(`${APP_URL}/onboarding?error=already_claimed`);
      }
      return NextResponse.redirect(`${APP_URL}/onboarding?error=true`);
    }
  }
  ```
- [ ] Commit:
  ```bash
  git add app/api/auth/instagram/
  git commit -m "feat: add Instagram OAuth callback route"
  ```

---

## Chunk 4: Dashboard Layout & Navigation

### Task 11: Update dashboard layout — nav + creator gate

**Files:**
- Modify: `app/dashboard/layout.tsx`
- Create: `components/CreatorSelector.tsx`

- [ ] Create `components/CreatorSelector.tsx`:
  ```tsx
  "use client";
  import { useRouter, useSearchParams, usePathname } from "next/navigation";

  export function CreatorSelector({ creatorIds }: { creatorIds: string[] }) {
    const router      = useRouter();
    const searchParams = useSearchParams();
    const pathname    = usePathname();
    const current     = searchParams.get("creatorId") ?? creatorIds[0];

    function onChange(id: string) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("creatorId", id);
      router.push(`${pathname}?${params.toString()}`);
    }

    return (
      <select
        value={current}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-700 focus:outline-none"
      >
        {creatorIds.map((id) => (
          <option key={id} value={id}>
            {id.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    );
  }
  ```

- [ ] Replace `app/dashboard/layout.tsx` with an async server component that adds the Intelligence nav item, creator gate, and admin CreatorSelector:
  ```tsx
  import Link from "next/link";
  import { redirect } from "next/navigation";
  import { auth } from "@clerk/nextjs/server";
  import { UserButton } from "@clerk/nextjs";
  import { LayoutDashboard, Users, GitCompareArrows, Brain } from "lucide-react";
  import { db } from "@/lib/db";
  import { creatorTokens } from "@/lib/schema";
  import { eq, sql } from "drizzle-orm";
  import { CreatorSelector } from "@/components/CreatorSelector";

  const NAV_ITEMS = [
    { href: "/dashboard",                      label: "Overview",     icon: LayoutDashboard },
    { href: "/dashboard/creators",             label: "Creators",     icon: Users },
    { href: "/dashboard/compare",              label: "Compare",      icon: GitCompareArrows },
    { href: "/dashboard/intelligence/search",  label: "Intelligence", icon: Brain },
  ];

  export default async function DashboardLayout({
    children,
    params,
  }: {
    children: React.ReactNode;
    params: { [key: string]: string };
  }) {
    const { userId, sessionClaims } = await auth();
    const role = (sessionClaims?.publicMetadata as any)?.role as string | undefined;

    // Gate creators — must have connected Instagram
    if (role !== "admin") {
      if (!userId) redirect("/sign-in");
      const [token] = await db
        .select({ id: creatorTokens.id })
        .from(creatorTokens)
        .where(eq(creatorTokens.clerkUserId, userId))
        .limit(1);
      if (!token) redirect("/onboarding");
    }

    // For admins — load creator list for selector
    let creatorIds: string[] = [];
    if (role === "admin") {
      const rows = await db.execute(
        sql`SELECT DISTINCT creator_id FROM creator_posts ORDER BY creator_id`
      );
      creatorIds = rows.rows.map((r: any) => r.creator_id);
    }

    return (
      <div className="flex min-h-screen">
        <aside className="w-64 border-r border-gray-800 bg-gray-950 p-5 flex flex-col">
          <Link href="/dashboard" className="flex items-center gap-2 mb-8 px-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">CM</span>
            </div>
            <span className="text-lg font-bold text-white">CreatorMetrics</span>
          </Link>

          {role === "admin" && creatorIds.length > 0 && (
            <div className="mb-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider px-2 mb-2">Creator</p>
              <CreatorSelector creatorIds={creatorIds} />
            </div>
          )}

          <nav className="flex flex-col gap-1 flex-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-gray-400 hover:bg-gray-800/50 hover:text-white transition-colors"
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="pt-4 border-t border-gray-800 flex items-center gap-3 px-2">
            <UserButton afterSignOutUrl="/sign-in" />
            <span className="text-sm text-gray-500">ENT Agency</span>
          </div>
        </aside>

        <main className="flex-1 p-8 overflow-auto bg-gray-950">{children}</main>
      </div>
    );
  }
  ```
- [ ] Commit:
  ```bash
  git add app/dashboard/layout.tsx components/CreatorSelector.tsx
  git commit -m "feat: add Intelligence nav, creator gate, admin CreatorSelector"
  ```

---

## Chunk 5: Search Feature

### Task 12: Search API route

**Files:**
- Create: `app/api/intelligence/search/route.ts`

- [ ] Create `app/api/intelligence/search/route.ts`:
  ```ts
  import { NextRequest, NextResponse } from "next/server";
  import { auth } from "@clerk/nextjs/server";
  import { db } from "@/lib/db";
  import { embedText } from "@/lib/embeddings";
  import { getCreatorScope } from "@/lib/creator-scope";
  import { sql } from "drizzle-orm";

  export const maxDuration = 30;

  export async function POST(req: NextRequest) {
    const { userId, sessionClaims } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const role = (sessionClaims?.publicMetadata as any)?.role as string | undefined;

    const { query, creatorId: reqCreatorId, mediaProductType, mediaType, sortBy } = await req.json();
    if (!query) return NextResponse.json({ error: "query required" }, { status: 400 });

    let creatorId: string;
    try {
      ({ creatorId } = await getCreatorScope(userId, role, reqCreatorId));
    } catch (e: any) {
      const status = e.message === "NO_TOKEN" ? 403 : 400;
      return NextResponse.json({ error: e.message }, { status });
    }

    const embedding = await embedText(query);
    const embeddingStr = `[${embedding.join(",")}]`;

    const rows = await db.execute(
      sql`SELECT * FROM search_creator_posts(${embeddingStr}::vector, ${creatorId}, 100)`
    );

    let results = rows.rows as any[];

    // Filter
    if (mediaProductType) {
      results = results.filter((r) => r.media_product_type === mediaProductType);
    }
    if (mediaType) {
      results = results.filter((r) => r.media_type === mediaType);
    }

    // Sort
    if (sortBy === "saves") {
      results.sort((a, b) => (b.saves ?? 0) - (a.saves ?? 0));
    } else if (sortBy === "reach") {
      results.sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0));
    }

    return NextResponse.json({ results: results.slice(0, 20) });
  }
  ```
- [ ] Commit:
  ```bash
  git add app/api/intelligence/search/
  git commit -m "feat: add semantic search API route"
  ```

---

### Task 13: Search page UI

**Files:**
- Create: `app/dashboard/intelligence/layout.tsx`
- Create: `app/dashboard/intelligence/search/page.tsx`

- [ ] Create `components/IntelligenceTabs.tsx`:
  ```tsx
  "use client";
  import Link from "next/link";
  import { useSearchParams } from "next/navigation";

  const TABS = [
    { path: "/dashboard/intelligence/search",   label: "Search"   },
    { path: "/dashboard/intelligence/insights",  label: "Insights" },
    { path: "/dashboard/intelligence/trends",    label: "Trends"   },
  ];

  export function IntelligenceTabs() {
    const searchParams = useSearchParams();
    const creatorId = searchParams.get("creatorId");

    return (
      <nav className="flex gap-1 border-b border-gray-800 pb-0">
        {TABS.map((tab) => {
          const href = creatorId ? `${tab.path}?creatorId=${creatorId}` : tab.path;
          return (
            <Link
              key={tab.path}
              href={href}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white border-b-2 border-transparent hover:border-gray-600 transition-colors -mb-px"
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    );
  }
  ```

- [ ] Create `app/dashboard/intelligence/layout.tsx`:
  ```tsx
  import { IntelligenceTabs } from "@/components/IntelligenceTabs";

  export default function IntelligenceLayout({ children }: { children: React.ReactNode }) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Content Intelligence</h1>
          <p className="text-gray-500 text-sm">AI-powered insights for your content.</p>
        </div>
        <IntelligenceTabs />
        {children}
      </div>
    );
  }
  ```

- [ ] Create `app/dashboard/intelligence/search/page.tsx`:
  ```tsx
  "use client";
  import { useState } from "react";
  import { useSearchParams } from "next/navigation";
  import Image from "next/image";

  const FILTER_CHIPS = [
    { label: "All",      mediaProductType: undefined, mediaType: undefined },
    { label: "Reels",    mediaProductType: "REELS",   mediaType: undefined },
    { label: "Feed",     mediaProductType: "FEED",    mediaType: undefined },
    { label: "Carousel", mediaProductType: "FEED",    mediaType: "CAROUSEL_ALBUM" },
  ];

  export default function SearchPage() {
    const searchParams = useSearchParams();
    const creatorId    = searchParams.get("creatorId") ?? "nicki_entenmann";

    const [query,     setQuery]     = useState("");
    const [filter,    setFilter]    = useState(0);
    const [sortBy,    setSortBy]    = useState<"relevant" | "saves" | "reach">("relevant");
    const [results,   setResults]   = useState<any[]>([]);
    const [loading,   setLoading]   = useState(false);

    async function search() {
      if (!query.trim()) return;
      setLoading(true);
      const chip = FILTER_CHIPS[filter];
      const res  = await fetch("/api/intelligence/search", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query, creatorId, sortBy,
          mediaProductType: chip.mediaProductType,
          mediaType:        chip.mediaType,
        }),
      });
      const data = await res.json();
      setResults(data.results ?? []);
      setLoading(false);
    }

    return (
      <div className="space-y-6">
        {/* Search bar */}
        <div className="flex gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder='Try "clean girl morning routine"…'
            className="flex-1 bg-gray-800 text-white placeholder-gray-500 rounded-xl px-4 py-3 text-sm border border-gray-700 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={search}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-3 rounded-xl text-sm transition-colors disabled:opacity-50"
          >
            {loading ? "Searching…" : "Search"}
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4">
          <div className="flex gap-2">
            {FILTER_CHIPS.map((chip, i) => (
              <button
                key={chip.label}
                onClick={() => setFilter(i)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  filter === i
                    ? "bg-blue-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:text-white"
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex gap-2">
            {(["relevant", "saves", "reach"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors capitalize ${
                  sortBy === s
                    ? "bg-purple-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:text-white"
                }`}
              >
                {s === "relevant" ? "Most Relevant" : `Most ${s.charAt(0).toUpperCase() + s.slice(1)}`}
              </button>
            ))}
          </div>
        </div>

        {/* Results grid */}
        {results.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {results.map((post) => (
              <a
                key={post.post_id}
                href={post.post_url}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative rounded-xl overflow-hidden bg-gray-800 aspect-square"
              >
                {post.image_url && (
                  <img
                    src={post.image_url}
                    alt={post.caption?.slice(0, 50)}
                    className="w-full h-full object-cover"
                  />
                )}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
                  <div className="flex gap-3 text-xs text-white font-medium">
                    <span>♥ {(post.likes ?? 0).toLocaleString()}</span>
                    <span>🔖 {(post.saves ?? 0).toLocaleString()}</span>
                    <span>👁 {(post.reach ?? 0).toLocaleString()}</span>
                  </div>
                  {post.caption && (
                    <p className="text-xs text-gray-300 mt-1 line-clamp-2">{post.caption}</p>
                  )}
                </div>
                <div className="absolute top-2 right-2 bg-black/60 rounded px-1.5 py-0.5 text-xs text-white">
                  {(post.similarity * 100).toFixed(0)}%
                </div>
              </a>
            ))}
          </div>
        )}

        {results.length === 0 && !loading && query && (
          <p className="text-gray-500 text-sm text-center py-12">No results. Try a different query.</p>
        )}
      </div>
    );
  }
  ```
- [ ] Commit:
  ```bash
  git add app/dashboard/intelligence/
  git commit -m "feat: add search UI with filter chips and results grid"
  ```

---

## Chunk 6: AI Insights Feature

### Task 14: On-demand Q&A API route

**Files:**
- Create: `app/api/intelligence/ask/route.ts`

- [ ] Create `app/api/intelligence/ask/route.ts`:
  ```ts
  import { NextRequest } from "next/server";
  import { auth } from "@clerk/nextjs/server";
  import { embedText } from "@/lib/embeddings";
  import { getCreatorScope } from "@/lib/creator-scope";
  import { db } from "@/lib/db";
  import { sql } from "drizzle-orm";
  import { streamText } from "ai";
  import { anthropic } from "@ai-sdk/anthropic";

  export const maxDuration = 60;


  export async function POST(req: NextRequest) {
    const { userId, sessionClaims } = await auth();
    if (!userId) return new Response("Unauthorized", { status: 401 });
    const role = (sessionClaims?.publicMetadata as any)?.role as string | undefined;

    const { question, creatorId: reqCreatorId } = await req.json();

    let creatorId: string;
    try {
      ({ creatorId } = await getCreatorScope(userId, role, reqCreatorId));
    } catch {
      return new Response("Forbidden", { status: 403 });
    }

    // Embed and search for context posts
    const embedding = await embedText(question);
    const rows = await db.execute(
      sql`SELECT * FROM search_creator_posts(${`[${embedding.join(",")}]`}::vector, ${creatorId}, 50)`
    );

    const context = rows.rows
      .map((p: any) =>
        `[${p.media_product_type ?? p.media_type}] ${new Date(p.posted_at).toLocaleDateString()} | likes:${p.likes ?? 0} saves:${p.saves ?? 0} reach:${p.reach ?? 0} shares:${p.shares ?? 0}\nCaption: ${(p.caption ?? "").slice(0, 200)}`
      )
      .join("\n\n");

    const result = await streamText({
      model: anthropic("claude-sonnet-4-6"),
      system:
        "You are an Instagram analytics assistant for ENT Agency. Answer only based on the post data provided. Do not make up metrics. Be concise and actionable.",
      messages: [
        {
          role: "user",
          content: `Here are ${rows.rows.length} relevant posts for creator "${creatorId}":

${context}

Question: ${question}`,
        },
      ],
    });

    return result.toDataStreamResponse();
  }
  ```
- [ ] Commit:
  ```bash
  git add app/api/intelligence/ask/
  git commit -m "feat: add streaming Q&A API route"
  ```

---

### Task 15: Insights page UI

**Files:**
- Create: `app/dashboard/intelligence/insights/page.tsx`

- [ ] Create `app/dashboard/intelligence/insights/page.tsx`:
  ```tsx
  import { auth } from "@clerk/nextjs/server";
  import { getTodayAnalysis } from "@/lib/intelligence-queries";
  import { getCreatorScope } from "@/lib/creator-scope";
  import { InsightsChat } from "./InsightsChat";

  export default async function InsightsPage({
    searchParams,
  }: {
    searchParams: { creatorId?: string };
  }) {
    const { userId, sessionClaims } = await auth();
    const role = (sessionClaims?.publicMetadata as any)?.role as string | undefined;

    let creatorId = "nicki_entenmann";
    try {
      ({ creatorId } = await getCreatorScope(userId!, role, searchParams.creatorId));
    } catch {}

    const analysis = await getTodayAnalysis(creatorId);
    const data = analysis?.analysis as any;

    return (
      <div className="space-y-8">
        {!data ? (
          <div className="text-gray-500 text-sm py-12 text-center">
            No analysis yet for today. Check back after 9am UTC.
          </div>
        ) : (
          <>
            {/* Engagement trend */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 col-span-1">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Trend</p>
                <p className={`text-2xl font-bold capitalize ${
                  data.engagementTrend === "improving" ? "text-green-400" :
                  data.engagementTrend === "declining" ? "text-red-400" : "text-yellow-400"
                }`}>
                  {data.engagementTrend}
                </p>
                <p className="text-sm text-gray-400 mt-2">{data.trendNote}</p>
              </div>
              <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Best Days</p>
                <p className="text-white font-medium">{data.bestPostingDays?.join(", ") ?? "—"}</p>
              </div>
              <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Top Content Type</p>
                <p className="text-white font-medium">{data.byContentType?.[0]?.type ?? "—"}</p>
                <p className="text-sm text-gray-400">avg reach {data.byContentType?.[0]?.avgReach?.toLocaleString() ?? "—"}</p>
              </div>
            </div>

            {/* Top themes */}
            <div>
              <h2 className="text-white font-semibold mb-3">Top Themes (Last 90 Days)</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {data.themes?.map((theme: any) => (
                  <div key={theme.name} className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                    <p className="text-white font-medium">{theme.name}</p>
                    <div className="flex gap-4 mt-2 text-sm text-gray-400">
                      <span>👁 {theme.avgReach?.toLocaleString()}</span>
                      <span>🔖 {theme.avgSaves?.toLocaleString()}</span>
                      <span>{theme.postCount} posts</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Hidden gems */}
            {data.hiddenGems?.length > 0 && (
              <div>
                <h2 className="text-white font-semibold mb-3">Hidden Gems</h2>
                <div className="space-y-2">
                  {data.hiddenGems.map((gem: any) => (
                    <a
                      key={gem.postId}
                      href={gem.postUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-4 bg-gray-900 rounded-xl p-4 border border-gray-800 hover:border-gray-600 transition-colors"
                    >
                      <div className="flex-1">
                        <p className="text-gray-300 text-sm line-clamp-2">{gem.caption}</p>
                      </div>
                      <div className="text-right text-sm text-gray-400 shrink-0">
                        <p>🔖 {gem.saves?.toLocaleString()}</p>
                        <p>♥ {gem.likes?.toLocaleString()}</p>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Q&A */}
        <InsightsChat creatorId={creatorId} />
      </div>
    );
  }
  ```

- [ ] Create `app/dashboard/intelligence/insights/InsightsChat.tsx`:
  ```tsx
  "use client";
  import { useChat } from "ai/react";

  export function InsightsChat({ creatorId }: { creatorId: string }) {
    const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
      api: "/api/intelligence/ask",
      body: { creatorId },
    });

    return (
      <div className="border border-gray-800 rounded-xl overflow-hidden">
        <div className="bg-gray-900 px-5 py-3 border-b border-gray-800">
          <h2 className="text-white font-semibold text-sm">Ask About This Creator</h2>
        </div>

        <div className="p-5 space-y-4 min-h-[120px] max-h-[400px] overflow-y-auto">
          {messages.length === 0 && (
            <p className="text-gray-600 text-sm">Ask anything — "Why do her Reels outperform feed posts?" or "What topics drive the most saves?"</p>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`text-sm ${m.role === "user" ? "text-blue-400" : "text-gray-300"}`}>
              <span className="font-medium mr-2">{m.role === "user" ? "You:" : "AI:"}</span>
              {m.content}
            </div>
          ))}
          {isLoading && <p className="text-gray-500 text-sm animate-pulse">Thinking…</p>}
        </div>

        <form onSubmit={handleSubmit} className="flex gap-3 p-4 border-t border-gray-800">
          <input
            value={input}
            onChange={handleInputChange}
            placeholder="Ask a question about this creator's content…"
            className="flex-1 bg-gray-800 text-white placeholder-gray-500 rounded-lg px-4 py-2.5 text-sm border border-gray-700 focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-5 py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            Ask
          </button>
        </form>
      </div>
    );
  }
  ```
- [ ] Commit:
  ```bash
  git add app/dashboard/intelligence/insights/ app/api/intelligence/ask/
  git commit -m "feat: add insights page with analysis cards and streaming Q&A"
  ```

---

## Chunk 7: Trends Feature

### Task 16: Trends API route

**Files:**
- Create: `app/api/intelligence/trends/route.ts`

- [ ] Create `app/api/intelligence/trends/route.ts`:
  ```ts
  import { NextRequest, NextResponse } from "next/server";
  import { auth } from "@clerk/nextjs/server";
  import { getCreatorScope } from "@/lib/creator-scope";
  import { getFollowerHistory, getEngagementByType, getTopPosts } from "@/lib/intelligence-queries";

  const PERIODS: Record<string, number | null> = {
    "7d":  7,
    "30d": 30,
    "90d": 90,
    "all": null,
  };

  export async function GET(req: NextRequest) {
    const { userId, sessionClaims } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const role = (sessionClaims?.publicMetadata as any)?.role as string | undefined;

    const { searchParams } = req.nextUrl;
    const reqCreatorId = searchParams.get("creatorId") ?? undefined;
    const period = searchParams.get("period") ?? "30d";
    const days = PERIODS[period] ?? 30;

    let creatorId: string;
    try {
      ({ creatorId } = await getCreatorScope(userId, role, reqCreatorId));
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const since = days
      ? new Date(Date.now() - days * 86400000).toISOString().split("T")[0]
      : null;

    const [followerHistory, engagementByType, topPosts] = await Promise.all([
      getFollowerHistory(creatorId, days),
      getEngagementByType(creatorId, since),
      getTopPosts(creatorId, since),
    ]);

    return NextResponse.json({ followerHistory, engagementByType, topPosts });
  }
  ```
- [ ] Commit:
  ```bash
  git add app/api/intelligence/trends/
  git commit -m "feat: add trends API route"
  ```

---

### Task 17: Trends page UI

**Files:**
- Create: `app/dashboard/intelligence/trends/page.tsx`

- [ ] Create `app/dashboard/intelligence/trends/page.tsx`:
  ```tsx
  "use client";
  import { useState, useEffect } from "react";
  import { useSearchParams } from "next/navigation";
  import { AreaChart, BarChart } from "@tremor/react";

  const PERIODS = ["7d", "30d", "90d", "all"] as const;

  export default function TrendsPage() {
    const searchParams = useSearchParams();
    const creatorId    = searchParams.get("creatorId") ?? "nicki_entenmann";
    const [period, setPeriod]   = useState<typeof PERIODS[number]>("30d");
    const [data, setData]       = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      setLoading(true);
      fetch(`/api/intelligence/trends?creatorId=${creatorId}&period=${period}`)
        .then((r) => r.json())
        .then((d) => { setData(d); setLoading(false); });
    }, [creatorId, period]);

    return (
      <div className="space-y-8">
        {/* Period selector */}
        <div className="flex gap-2">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                period === p ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"
              }`}
            >
              {p === "all" ? "All Time" : p}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-gray-500 text-sm py-12 text-center animate-pulse">Loading…</div>
        ) : (
          <>
            {/* Follower growth */}
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <h2 className="text-white font-semibold mb-4">Follower Growth</h2>
              <AreaChart
                data={(data?.followerHistory ?? []).map((r: any) => ({
                  date: r.date,
                  Followers: r.followers,
                }))}
                index="date"
                categories={["Followers"]}
                colors={["blue"]}
                showLegend={false}
                className="h-48"
              />
            </div>

            {/* Engagement by type */}
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <h2 className="text-white font-semibold mb-4">Avg Engagement by Content Type</h2>
              <BarChart
                data={(data?.engagementByType ?? []).map((r: any) => ({
                  type: r.type ?? "Unknown",
                  Reach: r.avg_reach ?? 0,
                  Saves: r.avg_saves ?? 0,
                  Shares: r.avg_shares ?? 0,
                }))}
                index="type"
                categories={["Reach", "Saves", "Shares"]}
                colors={["blue", "purple", "pink"]}
                className="h-48"
              />
            </div>

            {/* Top posts */}
            <div>
              <h2 className="text-white font-semibold mb-4">Top Posts by Saves</h2>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {(data?.topPosts ?? []).map((post: any) => (
                  <div key={post.post_id} className="bg-gray-900 rounded-xl overflow-hidden border border-gray-800">
                    {post.image_url && (
                      <img src={post.image_url} alt="" className="w-full aspect-square object-cover" />
                    )}
                    <div className="p-3 text-xs text-gray-400 space-y-0.5">
                      <p>🔖 {(post.saves ?? 0).toLocaleString()}</p>
                      <p>👁 {(post.reach ?? 0).toLocaleString()}</p>
                      <p className="text-gray-600">{post.posted_at?.split("T")[0]}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }
  ```
- [ ] Commit:
  ```bash
  git add app/dashboard/intelligence/trends/
  git commit -m "feat: add trends page with follower growth, engagement, top posts"
  ```

---

## Chunk 8: Nightly Intelligence Sync (Python)

### Task 18: `intelligence_sync.py` for Railway

**Files:**
- Create: `nicki-embeddings/intelligence_sync.py`

- [ ] Create `nicki-embeddings/intelligence_sync.py`:
  ```python
  #!/usr/bin/env python3
  """
  Nightly intelligence analysis — runs after sync.py (cron: 0 9 * * *).
  For each creator_id in creator_posts, generates AI analysis via Claude tool_use
  and upserts into creator_intelligence.

  Secrets required (Doppler ent-agency-automation/prd):
    ANTHROPIC_2_API_KEY
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
  """
  import os
  import json
  import logging
  from datetime import datetime, timezone

  import anthropic
  from supabase import create_client

  logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
  log = logging.getLogger(__name__)

  ANTHROPIC_KEY = os.environ["ANTHROPIC_2_API_KEY"]
  SUPABASE_URL  = os.environ["SUPABASE_URL"]
  SUPABASE_KEY  = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

  anthropic_client = anthropic.Anthropic(api_key=ANTHROPIC_KEY)
  supabase         = create_client(SUPABASE_URL, SUPABASE_KEY)

  ANALYSIS_SCHEMA = {
    "type": "object",
    "properties": {
      "themes": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "name":           {"type": "string"},
            "avgReach":       {"type": "number"},
            "avgSaves":       {"type": "number"},
            "postCount":      {"type": "integer"},
            "examplePostIds": {"type": "array", "items": {"type": "string"}}
          },
          "required": ["name", "avgReach", "avgSaves", "postCount", "examplePostIds"]
        }
      },
      "byContentType": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "type":      {"type": "string"},
            "avgReach":  {"type": "number"},
            "avgSaves":  {"type": "number"},
            "avgShares": {"type": "number"},
            "postCount": {"type": "integer"}
          },
          "required": ["type", "avgReach", "avgSaves", "avgShares", "postCount"]
        }
      },
      "hiddenGems": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "postId":   {"type": "string"},
            "postUrl":  {"type": "string"},
            "saves":    {"type": "number"},
            "likes":    {"type": "number"},
            "caption":  {"type": "string"}
          },
          "required": ["postId", "postUrl", "saves", "likes", "caption"]
        }
      },
      "bestPostingDays": {"type": "array", "items": {"type": "string"}},
      "engagementTrend": {"type": "string", "enum": ["improving", "declining", "stable"]},
      "trendNote":       {"type": "string"}
    },
    "required": ["themes", "byContentType", "hiddenGems", "bestPostingDays", "engagementTrend", "trendNote"]
  }


  def get_creator_ids() -> list[str]:
      result = supabase.rpc("get_distinct_creator_ids").execute()
      # Fallback: raw query if RPC not set up
      if not result.data:
          res = supabase.table("creator_posts").select("creator_id").execute()
          return list({r["creator_id"] for r in res.data})
      return [r["creator_id"] for r in result.data]


  def get_recent_posts(creator_id: str, days: int = 90) -> list[dict]:
      from datetime import timedelta
      cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
      result = supabase.table("creator_posts") \
          .select("post_id,post_url,caption,media_type,media_product_type,likes,saves,reach,shares,posted_at") \
          .eq("creator_id", creator_id) \
          .gte("posted_at", cutoff) \
          .execute()
      return result.data or []


  def build_prompt(creator_id: str, posts: list[dict]) -> str:
      lines = []
      for p in posts:
          lines.append(
              f"[{p.get('media_product_type') or p.get('media_type')}] {str(p.get('posted_at',''))[:10]} "
              f"likes:{p.get('likes',0)} saves:{p.get('saves',0)} reach:{p.get('reach',0)} shares:{p.get('shares',0)} "
              f"id:{p.get('post_id','')} url:{p.get('post_url','')} "
              f"caption:{str(p.get('caption',''))[:200]}"
          )
      posts_text = "\n".join(lines)
      return (
          f"Analyze the last 90 days of Instagram posts for creator '{creator_id}'.\n\n"
          f"{posts_text}\n\n"
          "Identify top themes from captions, performance by content type, hidden gems "
          "(high saves but low likes), best posting days, and overall engagement trend. "
          "Return the analysis using the store_analysis tool."
      )


  def analyze_creator(creator_id: str) -> bool:
      posts = get_recent_posts(creator_id)
      if not posts:
          log.info(f"{creator_id}: no posts, skipping")
          return False

      log.info(f"{creator_id}: analyzing {len(posts)} posts")
      try:
          response = anthropic_client.messages.create(
              model="claude-sonnet-4-6",
              max_tokens=4096,
              tools=[{
                  "name": "store_analysis",
                  "description": "Store the content analysis results",
                  "input_schema": ANALYSIS_SCHEMA
              }],
              tool_choice={"type": "tool", "name": "store_analysis"},
              messages=[{"role": "user", "content": build_prompt(creator_id, posts)}]
          )
          analysis = response.content[0].input
      except Exception as e:
          log.error(f"{creator_id}: Claude API error: {e}")
          return False

      generated_at = datetime.now(timezone.utc).date().isoformat()
      supabase.table("creator_intelligence").upsert(
          {"creator_id": creator_id, "generated_at": generated_at, "analysis": analysis},
          on_conflict="creator_id,generated_at"
      ).execute()
      log.info(f"{creator_id}: upserted analysis for {generated_at}")
      return True


  def run():
      # Get creator IDs directly from creator_posts
      result = supabase.table("creator_posts").select("creator_id").execute()
      creator_ids = list({r["creator_id"] for r in (result.data or [])})
      log.info(f"Found {len(creator_ids)} creators: {creator_ids}")

      ok, fail = 0, 0
      for cid in creator_ids:
          if analyze_creator(cid):
              ok += 1
          else:
              fail += 1

      log.info(f"Done — {ok} succeeded, {fail} failed")


  if __name__ == "__main__":
      run()
  ```

- [ ] Add `anthropic` to `nicki-embeddings/requirements.txt`:
  ```
  apify-client
  google-genai
  supabase
  requests
  anthropic
  ```

- [ ] Commit:
  ```bash
  cd ~/nicki-embeddings
  git add intelligence_sync.py requirements.txt
  git commit -m "feat: add nightly intelligence sync with Claude tool_use"
  ```

---

## Chunk 9: Build Check & Deploy

### Task 19: Build check

- [ ] Run the build locally with Doppler secrets:
  ```bash
  cd ~/creator-metrics
  doppler run --project ent-agency-automation --config prd -- npm run build
  ```
  Expected: `✓ Compiled successfully`. Fix any TypeScript errors before proceeding.

- [ ] Common fixes if build fails:
  - Missing `"use client"` directive on pages using hooks — add it
  - Add `export const dynamic = "force-dynamic"` to any API routes using `auth()`

---

### Task 20: Register Meta OAuth redirect URI

- [ ] Go to Meta for Developers (developers.facebook.com) → your app → Facebook Login → Settings
- [ ] Add to **Valid OAuth Redirect URIs**: `https://<your-vercel-domain>.vercel.app/api/auth/instagram/callback`
- [ ] Save changes.

---

### Task 21: Push to GitHub & verify Vercel deploy

- [ ] Push all commits:
  ```bash
  cd ~/creator-metrics
  git push origin master
  ```
- [ ] Watch Vercel dashboard — deploy should trigger automatically
- [ ] Once live, verify `/dashboard/intelligence/search` loads without errors

---

### Task 22: Seed Nicki's creator_tokens row

- [ ] Get Nicki's Clerk user ID from Clerk dashboard (Users → nicki's account → copy User ID)
- [ ] Get her Page Access Token from Doppler:
  ```bash
  doppler secrets get META_ACCESS_TOKEN --project ent-agency-automation --config prd --plain
  ```
- [ ] Run in Supabase SQL editor:
  ```sql
  INSERT INTO creator_tokens (clerk_user_id, creator_id, ig_user_id, access_token)
  VALUES (
    '<nicki_clerk_user_id>',
    'nicki_entenmann',
    '17841401475580469',
    '<META_ACCESS_TOKEN>'
  )
  ON CONFLICT (clerk_user_id) DO UPDATE
    SET access_token = EXCLUDED.access_token,
        updated_at   = now();
  ```

---

### Task 23: Trigger first intelligence analysis

- [ ] Run `intelligence_sync.py` manually to generate today's analysis:
  ```bash
  cd ~/nicki-embeddings
  doppler run --project ent-agency-automation --config prd -- python intelligence_sync.py
  ```
  Expected: `nicki_entenmann: upserted analysis for 2026-03-12`

- [ ] Verify in Supabase: `SELECT * FROM creator_intelligence ORDER BY generated_at DESC LIMIT 5;`

- [ ] Open `/dashboard/intelligence/insights` — analysis cards should render.

---

### Task 24: Set admin role for Emily & Ethan in Clerk

- [ ] In Clerk dashboard → Users → select Emily's account → Metadata → Public Metadata:
  ```json
  { "role": "admin" }
  ```
- [ ] Repeat for Ethan's account.
- [ ] Verify: log in as admin → CreatorSelector appears in sidebar, can switch between creators.

---

## Done

All features implemented:
- ✅ Semantic search with Gemini embeddings + pgvector
- ✅ Nightly AI analysis (Claude tool_use) + streaming Q&A
- ✅ Trends charts (follower growth, engagement by type, top posts)
- ✅ Instagram OAuth creator onboarding (Page tokens, permanent)
- ✅ Admin CreatorSelector + creator RBAC gate
- ✅ Nightly Railway cron for `intelligence_sync.py`
