---
project: Creator Metrics
status: waiting on platform IDs from Emily
last_updated: 2026-04-30
---

# RESUME-HERE — Creator Metrics

> Multi-creator analytics syncs (LTK, Mavely, Amazon, ShopMy).

## Last session state

Multi-creator syncs parameterized for LTK, Mavely, Amazon. ShopMy sync module built (`sync_shopmy.py`). Platform IDs populated for Nicki (all platforms), Ann/Ellen/Emily (Amazon tags only).

---

## Blockers

1. **Get LTK/Mavely/ShopMy IDs from Emily** [USER ACTION] — for Sara, Ellen, Courtney, Ann
2. **Add cron schedule for ShopMy sync** — module exists, not yet on schedule
3. **Build per-creator dashboard view** — backend ready, frontend not started

---

## Resume Prompt

```
Read RESUME-HERE.md in Entmarketingteam/creator-metrics. Check whether the
platform IDs have been provided yet. If yes, help me run a backfill sync.
```
