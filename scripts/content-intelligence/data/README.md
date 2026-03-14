# Data Files — Content Intelligence Pipeline

Place the following exported data files in this directory (or reference them via the Downloads path).

## Expected Files

### LTK Exports

| File | Description | Expected Rows |
|------|-------------|---------------|
| `LTK-export (21).csv` | LTK Posts by performance | 431 |
| `LTK-export (19).csv` | LTK Products/Links | ~3,000+ |
| `LTK-export (18).csv` | LTK Brands aggregate | 164 |

**LTK date format:** ISO 8601 — `2025-05-20T12:33:10+00:00`

**LTK Posts columns:**
`hero_image, date_published, clicks, commissions, orders, items_sold, order_conversion_rate, items_sold_conversion_rate, share_url`

**LTK Products columns:**
`product_name, advertiser_name, image, sku, description, price, currency, url, clicks, commissions, orders, items_sold, active_links, order_conversion_rate, items_sold_conversion_rate`

**LTK Brands columns:**
`advertiser_name, clicks, commissions, orders, items_sold, order_conversion_rate, items_sold_conversion_rate`

---

### Instagram Exports

| File | Description | Expected Rows |
|------|-------------|---------------|
| `Mar-01-2025_May-31-2025_1876201469692602.csv` | Instagram Stories | ~1,186+ |
| `Mar-01-2025_May-31-2025_776313942216639.csv` | Instagram Reels | ~130+ |

**Notes:**
- Both IG files have a UTF-8 BOM (`\ufeff`) — use `encoding='utf-8-sig'`
- Column names are quoted in the CSV header
- `Date` column contains either `Lifetime` (aggregate row) or a specific date string
- **IG date format:** `MM/DD/YYYY HH:MM` — e.g. `05/22/2025 13:10`
- Description fields may contain embedded newlines

**IG Stories columns:**
`Post ID, Account ID, Account username, Account name, Description, Duration (sec), Publish time, Permalink, Post type, Data comment, Date, Views, Reach, Likes, Shares, Profile visits, Replies, Link clicks, Navigation, Follows, Sticker taps`

**IG Reels columns:**
`Post ID, Account ID, Account username, Account name, Description, Duration (sec), Publish time, Permalink, Post type, Data comment, Date, Views, Reach, Likes, Shares, Follows, Comments, Saves`

---

## Data Coverage

- **Period:** March 1, 2025 — May 31, 2025 (Spring season)
- **Creator:** Nicki Entenmann (`@nicki.entenmann`)
- **Platforms:** LTK (affiliate), Instagram (organic)
