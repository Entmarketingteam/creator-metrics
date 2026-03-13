CREATE TABLE "shopmy_opportunity_commissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"creator_id" text,
	"external_id" integer UNIQUE,
	"title" text,
	"commission_amount" numeric(10, 2),
	"status" text,
	"synced_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shopmy_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"creator_id" text,
	"external_id" integer UNIQUE,
	"amount" numeric(10, 2),
	"source" text,
	"sent_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shopmy_brand_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"creator_id" text,
	"brand" text,
	"rate" numeric(5, 2),
	"rate_returning" numeric(5, 2),
	"synced_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "shopmy_brand_rates_creator_id_brand_unique" UNIQUE("creator_id","brand")
);
--> statement-breakpoint
ALTER TABLE "shopmy_opportunity_commissions" ADD CONSTRAINT "shopmy_opportunity_commissions_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopmy_payments" ADD CONSTRAINT "shopmy_payments_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopmy_brand_rates" ADD CONSTRAINT "shopmy_brand_rates_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;
