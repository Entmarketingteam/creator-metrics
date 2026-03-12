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
