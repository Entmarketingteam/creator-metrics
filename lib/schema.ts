import {
  pgTable,
  text,
  boolean,
  timestamp,
  serial,
  integer,
  bigint,
  date,
  unique,
  numeric,
  pgEnum,
} from "drizzle-orm/pg-core";

// Enums
export const platformEnum = pgEnum("platform", [
  "mavely",
  "shopmy",
  "ltk",
  "amazon",
  "instagram",
]);

export const earningsStatusEnum = pgEnum("earnings_status", [
  "open",
  "pending",
  "paid",
  "reversed",
]);

export const userRoleEnum = pgEnum("user_role", [
  "internal",
  "client",
  "creator",
]);

export const creators = pgTable("creators", {
  id: text("id").primaryKey(),
  igUserId: text("ig_user_id").notNull(),
  username: text("username").notNull(),
  displayName: text("display_name"),
  profilePictureUrl: text("profile_picture_url"),
  biography: text("biography"),
  isOwned: boolean("is_owned").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  // Platform IDs for affiliate networks
  mavelyCreatorId: text("mavely_creator_id"),
  shopmyUserId: text("shopmy_user_id"),
  ltkPublisherId: text("ltk_publisher_id"),
  amazonAssociateTag: text("amazon_associate_tag"),
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
    mediaUrl: text("media_url"),
    thumbnailUrl: text("thumbnail_url"),
    postedAt: timestamp("timestamp", { withTimezone: true }),
    likeCount: integer("like_count"),
    commentsCount: integer("comments_count"),
    reach: integer("reach"),
    saved: integer("saved"),
    shares: integer("shares"),
    totalInteractions: integer("total_interactions"),
    // Reels-specific metrics
    reelsAvgWatchTimeMs: integer("reels_avg_watch_time_ms"),
    reelsVideoViewTotalTimeMs: bigint("reels_video_view_total_time_ms", { mode: "number" }),
    viewsCount: integer("views_count"),   // total plays (unique: reach; total: views_count)
    linkUrl: text("link_url"),            // link sticker URL (stories) or first affiliate URL from caption
  },
  (t) => [unique().on(t.mediaIgId, t.capturedAt)]
);

// ── Affiliate Earnings Tables ──────────────────────────────────────

export const platformConnections = pgTable(
  "platform_connections",
  {
    id: serial("id").primaryKey(),
    creatorId: text("creator_id")
      .references(() => creators.id)
      .notNull(),
    platform: platformEnum("platform").notNull(),
    isConnected: boolean("is_connected").default(true),
    externalId: text("external_id"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [unique().on(t.creatorId, t.platform)]
);

export const platformEarnings = pgTable(
  "platform_earnings",
  {
    id: serial("id").primaryKey(),
    creatorId: text("creator_id")
      .references(() => creators.id)
      .notNull(),
    platform: platformEnum("platform").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    revenue: numeric("revenue", { precision: 12, scale: 2 })
      .default("0")
      .notNull(),
    commission: numeric("commission", { precision: 12, scale: 2 }).default(
      "0"
    ),
    clicks: integer("clicks").default(0),
    orders: integer("orders").default(0),
    status: earningsStatusEnum("status").default("open"),
    rawPayload: text("raw_payload"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [unique().on(t.creatorId, t.platform, t.periodStart, t.periodEnd)]
);

export const sales = pgTable("sales", {
  id: serial("id").primaryKey(),
  creatorId: text("creator_id")
    .references(() => creators.id)
    .notNull(),
  platform: platformEnum("platform").notNull(),
  saleDate: timestamp("sale_date", { withTimezone: true }).notNull(),
  productName: text("product_name"),
  productSku: text("product_sku"),
  brand: text("brand"),
  commissionAmount: numeric("commission_amount", {
    precision: 12,
    scale: 2,
  }).default("0"),
  orderValue: numeric("order_value", { precision: 12, scale: 2 }).default("0"),
  status: earningsStatusEnum("status").default("open"),
  externalOrderId: text("external_order_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    creatorId: text("creator_id")
      .references(() => creators.id)
      .notNull(),
    platform: platformEnum("platform").notNull(),
    productName: text("product_name").notNull(),
    brand: text("brand"),
    imageUrl: text("image_url"),
    totalRevenue: numeric("total_revenue", { precision: 12, scale: 2 }).default(
      "0"
    ),
    totalClicks: integer("total_clicks").default(0),
    totalSales: integer("total_sales").default(0),
    conversionRate: numeric("conversion_rate", {
      precision: 5,
      scale: 2,
    }).default("0"),
    lastUpdated: timestamp("last_updated", { withTimezone: true }).defaultNow(),
  },
  (t) => [unique().on(t.creatorId, t.platform, t.productName)]
);

export const userRoles = pgTable("user_roles", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  role: userRoleEnum("role").default("creator").notNull(),
  creatorId: text("creator_id").references(() => creators.id),
  assignedCreatorIds: text("assigned_creator_ids"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ── ShopMy-specific Tables ─────────────────────────────────────────

export const shopmyOpportunityCommissions = pgTable(
  "shopmy_opportunity_commissions",
  {
    id: serial("id").primaryKey(),
    creatorId: text("creator_id").references(() => creators.id),
    externalId: integer("external_id").unique(),
    title: text("title"),
    commissionAmount: numeric("commission_amount", { precision: 10, scale: 2 }),
    status: text("status"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
  }
);

export const shopmyPayments = pgTable("shopmy_payments", {
  id: serial("id").primaryKey(),
  creatorId: text("creator_id").references(() => creators.id),
  externalId: integer("external_id").unique(),
  amount: numeric("amount", { precision: 10, scale: 2 }),
  source: text("source"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
});

export const shopmyBrandRates = pgTable(
  "shopmy_brand_rates",
  {
    id: serial("id").primaryKey(),
    creatorId: text("creator_id").references(() => creators.id),
    brand: text("brand"),
    rate: numeric("rate", { precision: 5, scale: 2 }),
    rateReturning: numeric("rate_returning", { precision: 5, scale: 2 }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [unique().on(t.creatorId, t.brand)]
);
