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