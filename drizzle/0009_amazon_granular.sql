-- Amazon daily earnings (one row per creator per day)
CREATE TABLE IF NOT EXISTS "amazon_daily_earnings" (
    "id" serial PRIMARY KEY NOT NULL,
    "creator_id" text NOT NULL,
    "day" date NOT NULL,
    "clicks" integer DEFAULT 0,
    "ordered_items" integer DEFAULT 0,
    "shipped_items" integer DEFAULT 0,
    "revenue" numeric(12,2) DEFAULT 0,
    "commission" numeric(12,2) DEFAULT 0,
    "synced_at" timestamp with time zone DEFAULT now(),
    CONSTRAINT "amazon_daily_earnings_creator_id_day_unique" UNIQUE("creator_id","day")
);
CREATE INDEX IF NOT EXISTS idx_amazon_daily_creator_day ON "amazon_daily_earnings"("creator_id","day" DESC);

-- Amazon per-product orders (aggregated by ASIN per sync period)
CREATE TABLE IF NOT EXISTS "amazon_orders" (
    "id" serial PRIMARY KEY NOT NULL,
    "creator_id" text NOT NULL,
    "period_start" date NOT NULL,
    "period_end" date NOT NULL,
    "asin" text NOT NULL,
    "title" text,
    "ordered_items" integer DEFAULT 0,
    "shipped_items" integer DEFAULT 0,
    "revenue" numeric(12,2) DEFAULT 0,
    "commission" numeric(12,2) DEFAULT 0,
    "synced_at" timestamp with time zone DEFAULT now(),
    CONSTRAINT "amazon_orders_creator_period_asin_unique" UNIQUE("creator_id","period_start","asin")
);
CREATE INDEX IF NOT EXISTS idx_amazon_orders_creator ON "amazon_orders"("creator_id","period_start" DESC);
