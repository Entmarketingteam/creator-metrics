import { db } from "./db";
import { creatorTokens } from "./schema";
import { eq, sql } from "drizzle-orm";

export async function getCreatorScope(
  clerkUserId: string,
  role: string | undefined,
  requestedCreatorId?: string
): Promise<{ creatorId: string }> {
  if (role === "admin") {
    if (!requestedCreatorId) {
      throw new Error("MISSING_CREATOR_ID");
    }
    // Validate against creator_posts (distinct creator_ids)
    const result = await db.execute(
      sql`SELECT DISTINCT creator_id FROM creator_posts WHERE creator_id = ${requestedCreatorId} LIMIT 1`
    );
    if ((Array.from(result) as any[]).length === 0) {
      throw new Error("UNKNOWN_CREATOR_ID");
    }
    return { creatorId: requestedCreatorId };
  }

  // creator role (or no role)
  const [token] = await db
    .select({ creatorId: creatorTokens.creatorId })
    .from(creatorTokens)
    .where(eq(creatorTokens.clerkUserId, clerkUserId))
    .limit(1);

  if (!token) {
    throw new Error("NO_TOKEN");
  }
  return { creatorId: token.creatorId };
}
