-- Enums
CREATE TYPE "public"."earnings_status" AS ENUM('open', 'pending', 'paid', 'reversed');
CREATE TYPE "public"."platform" AS ENUM('mavely', 'shopmy', 'ltk', 'amazon', 'instagram');
CREATE TYPE "public"."user_role" AS ENUM('internal', 'client', 'creator');

-- Add platform ID columns to existing creators table
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "mavely_creator_id" text;
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "shopmy_user_id" text;
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "ltk_publisher_id" text;
ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "amazon_associate_tag" text;

-- New tables
CREATE TABLE IF NOT EXISTS "platform_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"creator_id" text NOT NULL,
	"platform" "platform" NOT NULL,
	"is_connected" boolean DEFAULT true,
	"external_id" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "platform_connections_creator_id_platform_unique" UNIQUE("creator_id","platform")
);

CREATE TABLE IF NOT EXISTS "platform_earnings" (
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
	CONSTRAINT "platform_earnings_creator_id_platform_period_start_period_end_unique" UNIQUE("creator_id","platform","period_start","period_end")
);

CREATE TABLE IF NOT EXISTS "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"creator_id" text NOT NULL,
	"platform" "platform" NOT NULL,
	"product_name" text NOT NULL,
	"brand" text,
	"image_url" text,
	"total_revenue" numeric(12, 2) DEFAULT '0',
	"total_clicks" integer DEFAULT 0,
	"total_sales" integer DEFAULT 0,
	"conversion_rate" numeric(5, 2) DEFAULT '0',
	"last_updated" timestamp with time zone DEFAULT now(),
	CONSTRAINT "products_creator_id_platform_product_name_unique" UNIQUE("creator_id","platform","product_name")
);

CREATE TABLE IF NOT EXISTS "sales" (
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
);

CREATE TABLE IF NOT EXISTS "user_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"role" "user_role" DEFAULT 'creator' NOT NULL,
	"creator_id" text,
	"assigned_creator_ids" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "user_roles_clerk_user_id_unique" UNIQUE("clerk_user_id")
);

-- Foreign keys for new tables
ALTER TABLE "platform_connections" ADD CONSTRAINT "platform_connections_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "platform_earnings" ADD CONSTRAINT "platform_earnings_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "products" ADD CONSTRAINT "products_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sales" ADD CONSTRAINT "sales_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;
