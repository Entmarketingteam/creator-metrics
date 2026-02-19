import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getLTKTokens } from "@/lib/ltk";

const LTK_API_BASE = "https://api-gateway.rewardstyle.com";

export const dynamic = "force-dynamic";

/**
 * Catch-all proxy to LTK API gateway.
 * Usage: GET /api/ltk/api/v1/analytics/performance-stats?start=...&end=...
 * Automatically injects dual auth headers (Bearer + X-id-token).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const tokens = await getLTKTokens();
    const ltkPath = "/" + params.path.join("/");
    const queryString = req.nextUrl.search;
    const url = `${LTK_API_BASE}${ltkPath}${queryString}`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        "X-id-token": tokens.idToken,
        "Content-Type": "application/json",
      },
    });

    const data = await res.text();
    return new NextResponse(data, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const tokens = await getLTKTokens();
    const ltkPath = "/" + params.path.join("/");
    const body = await req.text();
    const url = `${LTK_API_BASE}${ltkPath}`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        "X-id-token": tokens.idToken,
        "Content-Type": "application/json",
      },
      body,
    });

    const data = await res.text();
    return new NextResponse(data, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
