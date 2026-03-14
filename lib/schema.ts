import {
  pgTable,
  text,
  boolean,
  timestamp,
  serial,
  integer,
  date,
  unique,
  jsonb,
  uniqueIndex,
  numeric,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const creators = pgTable("creators", {
  id: text("id").primaryKey(),
  igUserId: text("ig_user_id").notNull(),
  username: text("username").notNull(),
  displayName: text("display_name"),
  profilePictureUrl: text("profile_picture_url"),
  biography: text("biography"),
  isOwned: boolean("is_owned").default(false),
  mavelyCreatorId: text("mavely_creator_id"),
  shopmyUserId: text("shopmy_user_id"),
  ltkPublisherId: text("ltk_publisher_id"),
  amazonAssociateTag: text("amazon_associate_tag"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const creatorSnapshots = pgTable(
  "creator_snapshots",
  {
    id: serial("id").primaryKey(),
    creatorId: text("creator_id").references(() => creators.id),
    capturedAt: date("captured_at").notNull(),
    followersCount: integer("followers_count"),
    followsCount: integer("follows_count"),
    mediaCount: integer("media_count"),
    reach28d: integer("reach_28d"),
    accountsEngaged28d: integer("accounts_engaged_28d"),
    totalInteractions28d: integer("total_interactions_28d"),
    followsUnfollows28d: integer("follows_unfollows_28d"),
  },
  (t) => [unique().on(t.creatorId, t.capturedAt)]
);

export const mediaSnapshots = pgTable(
  "media_snapshots",
  {
    id: serial("id").primaryKey(),
    creatorId: text("creator_id").references(() => creators.id),
    mediaIgId: text("media_ig_id").notNull(),
    capturedAt: date("captured_at").notNull(),
    mediaType: text("media_type"),
    mediaProductType: text("media_product_type"),
    caption: text("caption"),
    permalink: text("permalink"),
    linkUrl: text("link_url"),
    mediaUrl: text("media_url"),
    thumbnailUrl: text("thumbnail_url"),
    postedAt: timestamp("timestamp", { withTimezone: true }),
    likeCount: integer("like_count"),
    commentsCount: integer("comments_count"),
    reach: integer("reach"),
    saved: integer("saved"),
    shares: integer("shares"),
    totalInteractions: integer("total_interactions"),
  },
  (t) => [unique().on(t.mediaIgId, t.capturedAt)]
);

export const creatorIntelligence = pgTable(
  "creator_intelligence",
  {
    id:          serial("id").primaryKey(),
    creatorId:   text("creator_id").notNull(),
    generatedAt: date("generated_at").notNull(),
    analysis:    jsonb("analysis").notNull(),
  },
  (t) => [uniqueIndex("creator_intelligence_creator_date_idx").on(t.creatorId, t.generatedAt)]
);

export const creatorTokens = pgTable("creator_tokens", {
  id:          serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  creatorId:   text("creator_id").notNull().unique(),
  igUserId:    text("ig_user_id").notNull(),
  accessToken: text("access_token").notNull(),
  expiresAt:   timestamp("expires_at", { withTimezone: true })
                 .notNull()
                 .default(sql`'2099-01-01'::timestamptz`),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const products = pgTable("products", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  creatorId: text("creator_id").references(() => creators.id),
  platform: text("platform").notNull(), // 'ltk', 'amazon', 'shopmy', 'mavely'
  productId: text("product_id"),
  productName: text("product_name"),
  brand: text("brand"),
  price: numeric("price"),
  totalRevenue: numeric("total_revenue").default("0"),
  commissions: numeric("commissions").default("0"),
  totalClicks: integer("total_clicks").default(0),
  clicks: integer("clicks").default(0),
  totalSales: integer("total_sales").default(0),
  orders: integer("orders").default(0),
  imageUrl: text("image_url"),
  productUrl: text("product_url"),
  category: text("category"),
  recordedAt: timestamp("recorded_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const userRoles = pgTable("user_roles", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  role: text("role").notNull().default("viewer"), // 'admin', 'internal', 'client', 'creator', 'viewer'
  creatorId: text("creator_id").references(() => creators.id),
  assignedCreatorIds: text("assigned_creator_ids"), // comma-separated for client role
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const platformConnections = pgTable("platform_connections", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  creatorId: text("creator_id").references(() => creators.id).notNull(),
  platform: text("platform").notNull(), // 'instagram', 'ltk', 'amazon', 'shopmy', 'mavely'
  isConnected: boolean("is_connected").default(false),
  externalId: text("external_id"),
  lastSyncedAt: timestamp("last_synced_at"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const platformEarnings = pgTable("platform_earnings", {
  id: serial("id").primaryKey(),
  creatorId: text("creator_id").references(() => creators.id),
  platform: text("platform").notNull(), // 'ltk', 'amazon', 'shopmy', 'mavely'
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  revenue: numeric("revenue").default("0"),
  commission: numeric("commission").default("0"),
  clicks: integer("clicks").default(0),
  orders: integer("orders").default(0),
  rawPayload: jsonb("raw_payload"),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
});

export const sales = pgTable("sales", {
  id: serial("id").primaryKey(),
  creatorId: text("creator_id").references(() => creators.id),
  platform: text("platform").notNull(), // 'ltk', 'shopmy', 'amazon', 'mavely'
  productName: text("product_name"),
  brand: text("brand"),
  orderValue: numeric("order_value").default("0"),
  commissionAmount: numeric("commission_amount").default("0"),
  status: text("status").default("open"), // 'open', 'pending', 'paid', 'reversed'
  saleDate: timestamp("sale_date", { withTimezone: true }),
  externalId: text("external_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const ltkPosts = pgTable("ltk_posts", {
  id: serial("id").primaryKey(),
  creatorId: text("creator_id").references(() => creators.id),
  shareUrl: text("share_url").notNull(),
  datePublished: timestamp("date_published", { withTimezone: true }),
  heroImage: text("hero_image"),
  clicks: integer("clicks").default(0),
  commissions: numeric("commissions").default("0"),
  orders: integer("orders").default(0),
  itemsSold: integer("items_sold").default(0),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
});

export const shopmyOpportunityCommissions = pgTable("shopmy_opportunity_commissions", {
  id: serial("id").primaryKey(),
  creatorId: text("creator_id").references(() => creators.id),
  externalId: integer("external_id").unique(),
  title: text("title"),
  commissionAmount: numeric("commission_amount", { precision: 10, scale: 2 }),
  status: text("status"),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
});

export const shopmyPayments = pgTable("shopmy_payments", {
  id: serial("id").primaryKey(),
  creatorId: text("creator_id").references(() => creators.id),
  externalId: integer("external_id").unique(),
  amount: numeric("amount", { precision: 10, scale: 2 }),
  source: text("source"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
});

export const shopmyBrandRates = pgTable("shopmy_brand_rates", {
  id: serial("id").primaryKey(),
  creatorId: text("creator_id").references(() => creators.id),
  brand: text("brand"),
  rate: numeric("rate", { precision: 5, scale: 2 }),
  rateReturning: numeric("rate_returning", { precision: 5, scale: 2 }),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
});

export const mavelyLinks = pgTable("mavely_links", {
  id: serial("id").primaryKey(),
  creatorId: text("creator_id").references(() => creators.id),
  mavelyLinkId: text("mavely_link_id").notNull(),
  linkUrl: text("link_url"),
  title: text("title"),
  imageUrl: text("image_url"),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  clicks: integer("clicks").default(0),
  orders: integer("orders").default(0),
  commission: numeric("commission", { precision: 12, scale: 2 }).default("0"),
  revenue: numeric("revenue", { precision: 12, scale: 2 }).default("0"),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
});

export const mavelyTransactions = pgTable("mavely_transactions", {
  id: serial("id").primaryKey(),
  creatorId: text("creator_id").references(() => creators.id),
  mavelyTransactionId: text("mavely_transaction_id").notNull().unique(),
  mavelyLinkId: text("mavely_link_id"),
  linkUrl: text("link_url"),
  referrer: text("referrer"),
  commissionAmount: numeric("commission_amount", { precision: 12, scale: 2 }).default("0"),
  orderValue: numeric("order_value", { precision: 12, scale: 2 }).default("0"),
  saleDate: timestamp("sale_date", { withTimezone: true }),
  status: text("status"),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
});

export const manychatLinks = pgTable("manychat_links", {
  id:           serial("id").primaryKey(),
  code:         text("code").notNull().unique(),
  creatorId:    text("creator_id").notNull().references(() => creators.id),
  keyword:      text("keyword").notNull(),
  affiliateUrl: text("affiliate_url").notNull(),
  platform:     text("platform"),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const manychatEvents = pgTable("manychat_events", {
  id:           serial("id").primaryKey(),
  creatorId:    text("creator_id").notNull(),
  eventType:    text("event_type").notNull(), // "triggered" | "dm_sent" | "clicked"
  keyword:      text("keyword"),
  flowName:     text("flow_name"),
  subscriberIg: text("subscriber_ig"),
  subscriberId: text("subscriber_id"),
  linkCode:     text("link_code"),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const brandCollabs = pgTable("brand_collabs", {
  id: serial("id").primaryKey(),
  creatorId: text("creator_id").notNull().references(() => creators.id),
  brand: text("brand").notNull(),
  dealAmount: numeric("deal_amount", { precision: 12, scale: 2 }),
  campaignType: text("campaign_type"),
  paymentDate: date("payment_date"),
  status: text("status").default("pending"),
  notes: text("notes"),
  source: text("source").default("google_sheets"),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
});