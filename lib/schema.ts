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