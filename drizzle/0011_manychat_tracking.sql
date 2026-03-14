-- ManyChat comment-trigger tracking
-- manychat_links: short codes that redirect to affiliate URLs and log clicks
-- manychat_events: raw event log from ManyChat External Request webhooks

CREATE TABLE IF NOT EXISTS manychat_links (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  creator_id  TEXT NOT NULL REFERENCES creators(id),
  keyword     TEXT NOT NULL,
  affiliate_url TEXT NOT NULL,
  platform    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS manychat_events (
  id             SERIAL PRIMARY KEY,
  creator_id     TEXT NOT NULL,
  event_type     TEXT NOT NULL,
  keyword        TEXT,
  flow_name      TEXT,
  subscriber_ig  TEXT,
  subscriber_id  TEXT,
  link_code      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS manychat_events_creator_idx ON manychat_events(creator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS manychat_events_keyword_idx ON manychat_events(keyword, created_at DESC);
CREATE INDEX IF NOT EXISTS manychat_links_code_idx ON manychat_links(code);
