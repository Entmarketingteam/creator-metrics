import {
  pgTable,
  text,
  boolean,
  timestamp,
  serial,
  integer,
  date,
  unique,
} from "drizzle-orm/pg-core";

export const creators = pgTable("creators", {
  id: text("id").primaryKey(),
  igUserId: text("ig_user_id").notNull(),
  username: text("username").notNull(),
  displayName: text("display_name"),
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
