import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { creators, creatorTokens } from "@/lib/schema";

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
    const shortData = await shortRes.json();
    if (!shortData.access_token) {
      console.error("OAuth short token error:", shortData);
      return NextResponse.redirect(`${APP_URL}/onboarding?error=true`);
    }
    const shortToken = shortData.access_token;

    // 2. Long-lived user token (~60 days)
    const longData = await igGet(
      `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SEC}&fb_exchange_token=${shortToken}`
    );
    const longUserToken = longData.access_token;
    const expiresIn: number = longData.expires_in ?? 5184000; // default 60d
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    // 3. Get Pages — paginate through all, find one with instagram_business_account
    let allPages: any[] = [];
    let nextUrl: string | null =
      `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${longUserToken}`;
    while (nextUrl) {
      const pagesData = await igGet(nextUrl);
      console.log("Pages batch:", JSON.stringify(pagesData.data?.map((p: any) => ({
        id: p.id, name: p.name, hasIg: !!p.instagram_business_account,
      }))));
      if (pagesData.data) allPages = allPages.concat(pagesData.data);
      nextUrl = pagesData.paging?.next ?? null;
    }

    // First pass: instagram_business_account already in response
    let page = allPages.find((p: any) => p.instagram_business_account);

    // Second pass: field sometimes missing from /me/accounts — fetch per page
    if (!page) {
      for (const p of allPages) {
        try {
          const detail = await igGet(
            `https://graph.facebook.com/v21.0/${p.id}?fields=instagram_business_account&access_token=${p.access_token}`
          );
          if (detail.instagram_business_account) {
            page = { ...p, instagram_business_account: detail.instagram_business_account };
            break;
          }
        } catch (e) {
          console.error(`Failed IG lookup for page ${p.id}:`, e);
        }
      }
    }

    if (!page) {
      console.error("No IG business account. Pages found:", allPages.map((p: any) => ({ id: p.id, name: p.name })));
      return NextResponse.redirect(`${APP_URL}/onboarding?error=no_ig_account`);
    }

    const pageToken = page.access_token;
    const igUserId  = page.instagram_business_account.id;

    // 4. Get username + profile info
    const igData = await igGet(
      `https://graph.facebook.com/v21.0/${igUserId}?fields=username,name,profile_picture_url,followers_count,media_count&access_token=${pageToken}`
    );
    const username  = igData.username as string;
    const creatorId = username.replace(/\./g, "_").toLowerCase();

    // 5. Upsert creators row so the dashboard has a record immediately
    await db.insert(creators).values({
      id: creatorId,
      igUserId,
      username,
      displayName: (igData.name as string | null) ?? username,
      profilePictureUrl: (igData.profile_picture_url as string | null) ?? null,
      isOwned: false,
    }).onConflictDoUpdate({
      target: creators.id,
      set: {
        igUserId,
        username,
        displayName: (igData.name as string | null) ?? username,
        profilePictureUrl: (igData.profile_picture_url as string | null) ?? null,
      },
    });

    // 6. Upsert creator_tokens
    await db.insert(creatorTokens).values({
      clerkUserId: userId,
      creatorId,
      igUserId,
      accessToken: pageToken,
      expiresAt,
    }).onConflictDoUpdate({
      target: creatorTokens.clerkUserId,
      set: { accessToken: pageToken, igUserId, creatorId, expiresAt, updatedAt: new Date() },
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
