import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL);

async function migrate() {
  console.log("Creating creator_intelligence table...");
  await sql`
    CREATE TABLE IF NOT EXISTS creator_intelligence (
      id SERIAL PRIMARY KEY,
      creator_id TEXT NOT NULL,
      generated_at DATE NOT NULL,
      analysis JSONB NOT NULL,
      CONSTRAINT creator_intelligence_creator_date_idx UNIQUE (creator_id, generated_at)
    )
  `;
  console.log("✅ creator_intelligence created");

  console.log("Creating creator_tokens table...");
  await sql`
    CREATE TABLE IF NOT EXISTS creator_tokens (
      id SERIAL PRIMARY KEY,
      clerk_user_id TEXT NOT NULL UNIQUE,
      creator_id TEXT NOT NULL UNIQUE,
      ig_user_id TEXT NOT NULL,
      access_token TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL DEFAULT '2099-01-01'::timestamptz,
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `;
  console.log("✅ creator_tokens created");

  console.log("Creating/replacing search_creator_posts function...");
  await sql`
    CREATE OR REPLACE FUNCTION search_creator_posts(
      query_embedding vector(3072),
      p_creator_id text,
      match_count int DEFAULT 100
    )
    RETURNS TABLE (
      post_id text, post_url text, caption text, image_url text,
      likes int, saves int, reach int, shares int,
      media_type text, media_product_type text,
      posted_at timestamptz, similarity float
    )
    LANGUAGE sql STABLE AS $$
      SELECT post_id, post_url, caption, image_url,
             likes, saves, reach, shares,
             media_type, media_product_type, posted_at,
             1 - (embedding <=> query_embedding) AS similarity
      FROM creator_posts
      WHERE creator_id = p_creator_id AND embedding IS NOT NULL
      ORDER BY embedding <=> query_embedding
      LIMIT match_count;
    $$
  `;
  console.log("✅ search_creator_posts function updated");

  await sql.end();
  console.log("\nAll migrations complete!");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
