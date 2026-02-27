import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { shopmyBrandRates } from "@/lib/schema";
import { eq, asc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select()
    .from(shopmyBrandRates)
    .where(eq(shopmyBrandRates.creatorId, params.id))
    .orderBy(asc(shopmyBrandRates.brand));

  return NextResponse.json(rows);
}
