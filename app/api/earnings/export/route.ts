import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { sales } from "@/lib/schema";
import { eq, and, desc, ilike, or } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const creatorId = searchParams.get("creatorId");
  const platform = searchParams.get("platform");
  const status = searchParams.get("status");
  const search = searchParams.get("search");

  const conditions = [];
  if (creatorId) conditions.push(eq(sales.creatorId, creatorId));
  if (platform) conditions.push(eq(sales.platform, platform as any));
  if (status) conditions.push(eq(sales.status, status as any));
  if (search) {
    conditions.push(or(ilike(sales.productName, `%${search}%`), ilike(sales.brand, `%${search}%`))!);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const data = await db.select().from(sales).where(where).orderBy(desc(sales.saleDate)).limit(10000);

  const headers = ["Date", "Platform", "Product", "Brand", "Status", "Commission", "Order Value"];
  const csvRows = [
    headers.join(","),
    ...data.map((s) =>
      [
        s.saleDate ? new Date(s.saleDate).toISOString().split("T")[0] : "",
        s.platform,
        `"${(s.productName || "").replace(/"/g, '""')}"`,
        `"${(s.brand || "").replace(/"/g, '""')}"`,
        s.status || "",
        s.commissionAmount || "0",
        s.orderValue || "0",
      ].join(",")
    ),
  ].join("\n");

  return new NextResponse(csvRows, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="earnings-export-${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}
