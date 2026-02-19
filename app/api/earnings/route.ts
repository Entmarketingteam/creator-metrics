import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { sales } from "@/lib/schema";
import { eq, and, desc, ilike, or, sql, count } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const creatorId = searchParams.get("creatorId");
  const platform = searchParams.get("platform");
  const status = searchParams.get("status");
  const search = searchParams.get("search");
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "20");

  // Build where conditions array
  const conditions = [];
  if (creatorId) conditions.push(eq(sales.creatorId, creatorId));
  if (platform) conditions.push(eq(sales.platform, platform as any));
  if (status) conditions.push(eq(sales.status, status as any));
  if (search) {
    conditions.push(
      or(
        ilike(sales.productName, `%${search}%`),
        ilike(sales.brand, `%${search}%`)
      )!
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Get total count
  const [{ total }] = await db.select({ total: count() }).from(sales).where(where);

  // Get paginated data
  const data = await db
    .select()
    .from(sales)
    .where(where)
    .orderBy(desc(sales.saleDate))
    .limit(limit)
    .offset((page - 1) * limit);

  return NextResponse.json({
    data,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}
