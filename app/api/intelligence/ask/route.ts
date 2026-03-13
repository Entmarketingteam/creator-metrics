import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { embedText } from "@/lib/embeddings";
import { getCreatorScope } from "@/lib/creator-scope";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { userId, sessionClaims } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const role = (sessionClaims?.publicMetadata as any)?.role as string | undefined;

  const { question, creatorId: reqCreatorId } = await req.json();

  let creatorId: string;
  try {
    ({ creatorId } = await getCreatorScope(userId, role, reqCreatorId));
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  // Embed and search for context posts
  const embedding = await embedText(question);
  const rows = await db.execute(
    sql`SELECT * FROM search_creator_posts(${`[${embedding.join(",")}]`}::vector, ${creatorId}, 50)`
  );

  const context = (Array.from(rows) as any[])
    .map((p: any) =>
      `[${p.media_product_type ?? p.media_type}] ${new Date(p.posted_at).toLocaleDateString()} | likes:${p.likes ?? 0} saves:${p.saves ?? 0} reach:${p.reach ?? 0} shares:${p.shares ?? 0}\nCaption: ${(p.caption ?? "").slice(0, 200)}`
    )
    .join("\n\n");

  const result = await streamText({
    model: anthropic("claude-sonnet-4-6"),
    system:
      "You are an Instagram analytics assistant for ENT Agency. Answer only based on the post data provided. Do not make up metrics. Be concise and actionable.",
    messages: [
      {
        role: "user",
        content: `Here are ${(Array.from(rows) as any[]).length} relevant posts for creator "${creatorId}":\n\n${context}\n\nQuestion: ${question}`,
      },
    ],
  });

  return result.toTextStreamResponse();
}
