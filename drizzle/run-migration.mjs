import postgres from "postgres";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = postgres(process.env.DATABASE_URL);

const migration = readFileSync(join(__dirname, "migrate-new-tables.sql"), "utf8");

// Split on semicolons but handle the statement-breakpoint comments
const statements = migration
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && !s.startsWith("--"));

console.log(`Running ${statements.length} statements...`);

for (let i = 0; i < statements.length; i++) {
  const stmt = statements[i];
  const preview = stmt.slice(0, 80).replace(/\n/g, " ");
  try {
    await sql.unsafe(stmt);
    console.log(`[${i + 1}/${statements.length}] OK: ${preview}...`);
  } catch (e) {
    // Ignore "already exists" errors
    if (e.message.includes("already exists")) {
      console.log(`[${i + 1}/${statements.length}] SKIP (already exists): ${preview}...`);
    } else {
      console.error(`[${i + 1}/${statements.length}] ERROR: ${preview}...`);
      console.error(`  ${e.message}`);
    }
  }
}

console.log("Migration complete.");
await sql.end();
