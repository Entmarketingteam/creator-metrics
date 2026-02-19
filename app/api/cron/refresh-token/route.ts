import { NextRequest, NextResponse } from "next/server";
import { exchangeToken } from "@/lib/instagram";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const appId = process.env.META_APP_ID!;
  const appSecret = process.env.META_APP_SECRET!;
  const currentToken = process.env.META_ACCESS_TOKEN!;
  const dopplerToken = process.env.DOPPLER_SERVICE_TOKEN;

  try {
    const newToken = await exchangeToken(appId, appSecret, currentToken);

    // If we have a Doppler service token, update the secret automatically
    if (dopplerToken) {
      const res = await fetch(
        "https://api.doppler.com/v3/configs/config/secrets",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${dopplerToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            project: "ent-agency-automation",
            config: "dev",
            secrets: { META_ACCESS_TOKEN: newToken },
          }),
        }
      );
      if (!res.ok) {
        const err = await res.text();
        return NextResponse.json(
          { error: `Doppler update failed: ${err}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      tokenRefreshed: true,
      dopplerUpdated: !!dopplerToken,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
