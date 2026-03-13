import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { platformEarnings } from "@/lib/schema";
import { eq, and, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select()
    .from(platformEarnings)
    .where(
      and(
        eq(platformEarnings.creatorId, params.id),
        eq(platformEarnings.platform, "shopmy")
      )
    )
    .orderBy(desc(platformEarnings.periodStart))
    .limit(90);

  return NextResponse.json(rows);
}
