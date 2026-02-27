CREATE TYPE "public"."earnings_status" AS ENUM('open', 'pending', 'paid', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('mavely', 'shopmy', 'ltk', 'amazon', 'instagram');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('internal', 'client', 'creator');--> statement-breakpoint
CREATE TABLE "creator_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"creator_id" text,
	"captured_at" date NOT NULL,
	"followers_count" integer,
	"follows_count" integer,
	"media_count" integer,
	"reach_28d" integer,
	"accounts_engaged_28d" integer,
	"total_interactions_28d" integer,
	"follows_unfollows_28d" integer,
	CONSTRAINT "creator_snapshots_creator_id_captured_at_unique" UNIQUE("creator_id","captured_at")
);
--> statement-breakpoint
CREATE TABLE "creators" (
	"id" text PRIMARY KEY NOT NULL,
	"ig_user_id" text NOT NULL,
	"username" text NOT NULL,
	"display_name" text,
	"profile_picture_url" text,
	"biography" text,
	"is_owned" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"mavely_creator_id" text,
	"shopmy_user_id" text,
	"ltk_publisher_id" text,
	"amazon_associate_tag" text
);
--> statement-breakpoint
CREATE TABLE "media_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"creator_id" text,
	"media_ig_id" text NOT NULL,
	"captured_at" date NOT NULL,
	"media_type" text,
	"media_product_type" text,
	"caption" text,
	"permalink" text,
	"media_url" text,
	"thumbnail_url" text,
	"timestamp" timestamp with time zone,
	"like_count" integer,
	"comments_count" integer,
	"reach" integer,
	"saved" integer,
	"shares" integer,
	"total_interactions" integer,
	CONSTRAINT "media_snapshots_media_ig_id_captured_at_unique" UNIQUE("media_ig_id","captured_at")
);
--> statement-breakpoint
CREATE TABLE "platform_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"creator_id" text NOT NULL,
	"platform" "platform" NOT NULL,
	"is_connected" boolean DEFAULT true,
	"external_id" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "platform_connections_creator_id_platform_unique" UNIQUE("creator_id","platform")
);
--> statement-breakpoint
CREATE TABLE "platform_earnings" (
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
--> statement-breakpoint
CREATE TABLE "products" (
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
--> statement-breakpoint
CREATE TABLE "sales" (
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
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"role" "user_role" DEFAULT 'creator' NOT NULL,
	"creator_id" text,
	"assigned_creator_ids" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "user_roles_clerk_user_id_unique" UNIQUE("clerk_user_id")
);
--> statement-breakpoint
ALTER TABLE "creator_snapshots" ADD CONSTRAINT "creator_snapshots_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_snapshots" ADD CONSTRAINT "media_snapshots_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_connections" ADD CONSTRAINT "platform_connections_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_earnings" ADD CONSTRAINT "platform_earnings_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;