import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL);

const statements = [
  `CREATE TYPE "public"."earnings_status" AS ENUM('open', 'pending', 'paid', 'reversed')`,

  `CREATE TABLE IF NOT EXISTS "platform_connections" (
    "id" serial PRIMARY KEY NOT NULL,
    "creator_id" text NOT NULL,
    "platform" "platform" NOT NULL,
    "is_connected" boolean DEFAULT true,
    "external_id" text,
    "last_synced_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now(),
    CONSTRAINT "platform_connections_creator_id_platform_unique" UNIQUE("creator_id","platform")
  )`,

  `CREATE TABLE IF NOT EXISTS "platform_earnings" (
    "id" serial PRIMARY KEY NOT NULL,
    "creator_id" text NOT NULL,
    "platform" "platform" NOT NULL,
    "period_start" date NOT NULL,
    "period_end" date NOT NULL,
    "revenue" numeric(12, 2) DEFAULT '0' NOT NULL,
    "commission" numeric(12, 2) DEFAULT '0',
    "clicks" integer DEFAULT 0,
    "orders" integer DEFAULT 0,
    "status" "earnings_status" DEFAULT 'open',
    "raw_payload" text,
    "synced_at" timestamp with time zone DEFAULT now(),
    CONSTRAINT "pe_creator_platform_period_unique" UNIQUE("creator_id","platform","period_start","period_end")
  )`,

  `CREATE TABLE IF NOT EXISTS "sales" (
    "id" serial PRIMARY KEY NOT NULL,
    "creator_id" text NOT NULL,
    "platform" "platform" NOT NULL,
    "sale_date" timestamp with time zone NOT NULL,
    "product_name" text,
    "product_sku" text,
    "brand" text,
    "commission_amount" numeric(12, 2) DEFAULT '0',
    "order_value" numeric(12, 2) DEFAULT '0',
    "status" "earnings_status" DEFAULT 'open',
    "external_order_id" text,
    "created_at" timestamp with time zone DEFAULT now()
  )`,

  `ALTER TABLE "platform_connections" ADD CONSTRAINT "platform_connections_creator_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action`,

  `ALTER TABLE "platform_earnings" ADD CONSTRAINT "platform_earnings_creator_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action`,

  `ALTER TABLE "sales" ADD CONSTRAINT "sales_creator_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action`,
];

for (let i = 0; i < statements.length; i++) {
  const stmt = statements[i];
  const preview = stmt.slice(0, 80).replace(/\n/g, " ").trim();
  try {
    await sql.unsafe(stmt);
    console.log(`[${i + 1}] OK: ${preview}...`);
  } catch (e) {
    if (e.message.includes("already exists")) {
      console.log(`[${i + 1}] SKIP: ${preview}...`);
    } else {
      console.error(`[${i + 1}] ERROR: ${preview}...`);
      console.error(`  ${e.message}`);
    }
  }
}

console.log("Done.");
await sql.end();
