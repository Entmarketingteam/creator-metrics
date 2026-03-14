# ManyChat Comment-Trigger Tracking — Setup Guide

## Overview

When a creator posts "comment SHOP" and someone comments, ManyChat sends them a DM with an affiliate link. We track three events per flow:

| Event | How it's captured |
|---|---|
| Comment triggered | ManyChat External Request → `/api/webhooks/manychat` |
| DM sent | ManyChat External Request → `/api/webhooks/manychat` |
| Affiliate link clicked | Short link `/r/[code]` logs click before redirecting |

All events land in the `manychat_events` table in Supabase.

---

## One-Time Setup Per Flow

### Step 1 — Create a short link

Go to **[/dashboard/manychat](https://creator-metrics.vercel.app/dashboard/manychat)** and click **New Link**.

Fill in:
- **Creator** — who owns this flow
- **Keyword** — the trigger word (e.g. `SHOP`, `SALE`, `LINK`)
- **Affiliate URL** — the exact URL from the ManyChat DM button
- **Platform** — Mavely / LTK / ShopMy / Amazon

Click **Create & Copy URL**. The short URL is copied to your clipboard automatically.

### Step 2 — Swap the URL in ManyChat

1. Open ManyChat → go to the flow
2. Find the button or URL in the DM message
3. Replace the affiliate URL with the short URL (`https://creator-metrics.vercel.app/r/XXXXXXXX`)

### Step 3 — Add two External Request steps

**External Request #1 — at the comment trigger (start of flow)**

- **URL:** `https://creator-metrics.vercel.app/api/webhooks/manychat`
- **Method:** POST
- **Header:** `x-manychat-secret` → value: `[CRON_SECRET from Doppler]`
- **Body (JSON):**
```json
{
  "event_type": "triggered",
  "creator_id": "nicki_entenmann",
  "keyword": "SHOP",
  "flow_name": "{{flow name}}",
  "subscriber_ig": "{{instagram username}}",
  "subscriber_id": "{{subscriber id}}"
}
```

**External Request #2 — right after the DM is sent**

Same as above but change `event_type` to `"dm_sent"`.

---

## Getting the CRON_SECRET

```bash
doppler secrets get CRON_SECRET --project ent-agency-automation --config dev --plain
```

---

## Template Flow

To avoid repeating Step 3 for every new flow:

1. Set up one flow correctly with both External Request steps
2. In ManyChat, duplicate that flow whenever you create a new keyword trigger
3. Update the `keyword` field in the body and swap the short URL — the External Request steps come pre-wired

---

## Flows to Instrument First

Priority order based on affiliate link volume in captions:

| Keyword | Platform | Notes |
|---|---|---|
| SHOP | Mavely / LTK / Amazon | Most common, multiple creators use it |
| SALE | Mavely | Shopping sale posts |
| LINK | Mavely / LTK | Generic link triggers |
| DRESS | Mavely / Amazon | Product-specific |
| SPRING | Mavely | Seasonal sale |

Skip flows that send guides, coaching programs, or lead magnets (CORTISOL, METHOD, COACH, ROUND, etc.) — those don't have affiliate links so click tracking doesn't apply.

---

## Viewing the Data

- **Admin page:** [/dashboard/manychat](https://creator-metrics.vercel.app/dashboard/manychat) — short links + click counts
- **Content page:** [/dashboard/content](https://creator-metrics.vercel.app/dashboard/content) — filter by ManyChat to see all comment-trigger posts with engagement metrics
- **Raw data:** `manychat_events` and `manychat_links` tables in Supabase

---

## API Reference

**Create a short link**
```
POST /api/admin/manychat-link
Authorization: Clerk session cookie
Body: { creatorId, keyword, affiliateUrl, platform }
Returns: { code, shortUrl }
```

**List short links**
```
GET /api/admin/manychat-link?creatorId=nicki_entenmann
Returns: [{ code, keyword, affiliate_url, platform, clicks, ... }]
```

**ManyChat webhook**
```
POST /api/webhooks/manychat
Header: x-manychat-secret: [CRON_SECRET]
Body: { event_type, creator_id, keyword, flow_name, subscriber_ig, subscriber_id }
```

**Short link redirect**
```
GET /r/[code]
Logs click to manychat_events, redirects to affiliate_url
Optional query param: ?ig=[instagram_handle] to attribute click to subscriber
```
