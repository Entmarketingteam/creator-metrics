CREATE TABLE IF NOT EXISTS "brand_collabs" (
	"id" serial PRIMARY KEY NOT NULL,
	"creator_id" text NOT NULL,
	"brand" text NOT NULL,
	"deal_amount" numeric(12, 2),
	"campaign_type" text,
	"payment_date" date,
	"status" text DEFAULT 'pending',
	"notes" text,
	"source" text DEFAULT 'google_sheets',
	"synced_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "brand_collabs_creator_id_brand_payment_date_deal_amount_unique" UNIQUE("creator_id","brand","payment_date","deal_amount")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "other_affiliate_earnings" (
	"id" serial PRIMARY KEY NOT NULL,
	"creator_id" text NOT NULL,
	"platform_name" text NOT NULL,
	"amount" numeric(12, 2),
	"period_start" date,
	"period_end" date,
	"payment_date" date,
	"status" text DEFAULT 'pending',
	"source" text DEFAULT 'manual',
	"notes" text,
	"external_id" text,
	"synced_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "other_affiliate_earnings_creator_id_platform_name_period_start_external_id_unique" UNIQUE("creator_id","platform_name","period_start","external_id")
);
--> statement-breakpoint
ALTER TABLE "brand_collabs" ADD CONSTRAINT "brand_collabs_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "other_affiliate_earnings" ADD CONSTRAINT "other_affiliate_earnings_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;
