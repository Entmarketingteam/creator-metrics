import { NextRequest, NextResponse } from "next/server";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL!;
const APP_ID  = process.env.META_APP_ID!;
const APP_SEC = process.env.META_APP_SECRET!;
const REDIRECT_URI = `${APP_URL}/api/auth/instagram/callback`;

export async function GET(req: NextRequest) {
  // Protect with cron secret
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Pass ?token=<user_access_token>" });
  }

  const results: Record<string, unknown> = {};

  try {
    // Exchange for long-lived token
    const longRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SEC}&fb_exchange_token=${token}`
    );
    const longData = await longRes.json();
    results.long_token_exchange = { ok: !!longData.access_token, error: longData.error };
    const longToken = longData.access_token ?? token;

    // Get pages
    const pagesRes = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${longToken}`
    );
    const pagesData = await pagesRes.json();
    results.pages_raw = pagesData;

    // Per-page IG lookup
    const perPageResults = [];
    for (const p of pagesData.data ?? []) {
      const detailRes = await fetch(
        `https://graph.facebook.com/v21.0/${p.id}?fields=id,name,instagram_business_account&access_token=${p.access_token}`
      );
      const detail = await detailRes.json();
      perPageResults.push({ pageId: p.id, name: p.name, detail });
    }
    results.per_page_ig_lookup = perPageResults;

  } catch (e: any) {
    results.error = e.message;
  }

  return NextResponse.json(results, { status: 200 });
}
