"""
creator-metrics sync service
Handles LTK token refresh (Playwright/Airtop) + Mavely GraphQL sync.
Runs on Railway. APScheduler handles cron jobs.
FastAPI provides health + manual trigger endpoints.
"""
import os, logging, asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

import asyncpg
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from sync_ltk import refresh_ltk_tokens, sync_ltk_data
from sync_mavely import sync_mavely
from sync_amazon import sync_amazon
from sync_impact import sync_impact
from sync_shopmy import sync_shopmy

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


# ── DB helpers ────────────────────────────────────────────────────────────────

def _get_dsn() -> str:
    db_url = os.environ["DATABASE_URL"]
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql://", 1)
    return db_url


class SyncConn:
    """
    Synchronous DB wrapper. Creates its own event loop + reuses ONE asyncpg
    connection for all execute() calls. Must be instantiated inside the thread
    that will use it (i.e., inside asyncio.to_thread()).
    Call close() when done.
    """
    def __init__(self, dsn: str):
        self._loop = asyncio.new_event_loop()
        # statement_cache_size=0 required for Supabase PgBouncer (transaction mode)
        self._conn = self._loop.run_until_complete(
            asyncpg.connect(dsn, statement_cache_size=0)
        )

    def execute(self, query: str, *args):
        return self._loop.run_until_complete(self._conn.execute(query, *args))

    def executemany(self, query: str, args_list: list):
        return self._loop.run_until_complete(self._conn.executemany(query, args_list))

    def fetch(self, query: str, *args):
        return self._loop.run_until_complete(self._conn.fetch(query, *args))

    def close(self):
        try:
            self._loop.run_until_complete(self._conn.close())
        except Exception:
            pass
        self._loop.close()


def _run_mavely(dsn: str) -> dict:
    conn = SyncConn(dsn)
    try:
        return sync_mavely(conn)
    finally:
        conn.close()


def _run_amazon(dsn: str) -> dict:
    conn = SyncConn(dsn)
    try:
        return sync_amazon(conn)
    finally:
        conn.close()


def _run_shopmy(dsn: str) -> dict:
    conn = SyncConn(dsn)
    try:
        return sync_shopmy(conn)
    finally:
        conn.close()


def _run_impact(dsn: str) -> dict:
    conn = SyncConn(dsn)
    try:
        return sync_impact(conn)
    finally:
        conn.close()


def _run_ltk_data(dsn: str) -> dict:
    conn = SyncConn(dsn)
    try:
        return sync_ltk_data(conn)
    finally:
        conn.close()


# ── Scheduler jobs ────────────────────────────────────────────────────────────

async def job_ltk_token_refresh():
    logger.info("=== JOB: LTK token refresh ===")
    try:
        result = await asyncio.to_thread(refresh_ltk_tokens)
        logger.info("LTK token refresh done: %s", result)
    except Exception as e:
        logger.error("LTK token refresh FAILED: %s", e)


async def job_ltk_data_sync():
    logger.info("=== JOB: LTK data sync ===")
    try:
        result = await asyncio.to_thread(_run_ltk_data, _get_dsn())
        logger.info("LTK data sync done: %s", result)
    except Exception as e:
        logger.error("LTK data sync FAILED: %s", e)


async def job_mavely_sync():
    logger.info("=== JOB: Mavely sync ===")
    try:
        result = await asyncio.to_thread(_run_mavely, _get_dsn())
        logger.info("Mavely sync done: %s", result)
    except Exception as e:
        logger.error("Mavely sync FAILED: %s", e)


async def job_amazon_sync():
    logger.info("=== JOB: Amazon sync ===")
    try:
        result = await asyncio.to_thread(_run_amazon, _get_dsn())
        logger.info("Amazon sync done: %s", result)
    except Exception as e:
        logger.error("Amazon sync FAILED: %s", e)


async def job_shopmy_sync():
    logger.info("=== JOB: ShopMy sync ===")
    try:
        result = await asyncio.to_thread(_run_shopmy, _get_dsn())
        logger.info("ShopMy sync done: %s", result)
    except Exception as e:
        logger.error("ShopMy sync FAILED: %s", e)


async def job_impact_sync():
    logger.info("=== JOB: Impact.com sync ===")
    try:
        result = await asyncio.to_thread(_run_impact, _get_dsn())
        logger.info("Impact sync done: %s", result)
    except Exception as e:
        logger.error("Impact sync FAILED: %s", e)


# ── App lifecycle ─────────────────────────────────────────────────────────────

scheduler = AsyncIOScheduler(timezone="UTC")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting sync service scheduler...")

    # LTK token refresh: every 3 hours
    scheduler.add_job(job_ltk_token_refresh, CronTrigger(hour="*/3"), id="ltk_token_refresh")

    # LTK data sync: 6:30 UTC daily
    scheduler.add_job(job_ltk_data_sync, CronTrigger(hour=6, minute=30), id="ltk_data_sync")

    # Mavely sync: 8:00 UTC daily
    scheduler.add_job(job_mavely_sync, CronTrigger(hour=8, minute=0), id="mavely_sync")

    # Amazon sync: 9:00 UTC daily
    scheduler.add_job(job_amazon_sync, CronTrigger(hour=9, minute=0), id="amazon_sync")

    # ShopMy sync: 7:15 UTC daily (matches Vercel cron timing)
    scheduler.add_job(job_shopmy_sync, CronTrigger(hour=7, minute=15), id="shopmy_sync")

    # Impact.com sync: 9:30 UTC daily (skips gracefully if no API creds configured)
    scheduler.add_job(job_impact_sync, CronTrigger(hour=9, minute=30), id="impact_sync")

    scheduler.start()
    logger.info("Scheduler started. Jobs: %s", [j.id for j in scheduler.get_jobs()])

    yield

    scheduler.shutdown()


app = FastAPI(title="creator-metrics sync", lifespan=lifespan)


# ── Auth ──────────────────────────────────────────────────────────────────────

def _check_secret(req: Request):
    auth = req.headers.get("authorization", "")
    secret = os.environ.get("SYNC_SECRET", "")
    if not secret or auth != f"Bearer {secret}":
        raise HTTPException(status_code=401, detail="Unauthorized")


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def dashboard():
    secret = os.environ.get("SYNC_SECRET", "")
    jobs = scheduler.get_jobs()
    jobs_html = "".join(
        f"<tr><td>{j.id}</td><td>{j.next_run_time}</td></tr>"
        for j in jobs
    )
    return f"""<!DOCTYPE html>
<html>
<head>
  <title>creator-metrics sync</title>
  <style>
    body {{ font-family: -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 32px; }}
    h1 {{ font-size: 20px; font-weight: 600; margin-bottom: 4px; }}
    p {{ color: #94a3b8; font-size: 14px; margin-bottom: 32px; }}
    .grid {{ display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 32px; }}
    .card {{ background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 20px 24px; min-width: 220px; }}
    .card h2 {{ font-size: 13px; color: #94a3b8; font-weight: 500; margin: 0 0 12px 0; text-transform: uppercase; letter-spacing: .05em; }}
    button {{ background: #3b82f6; color: #fff; border: none; border-radius: 6px; padding: 8px 16px; font-size: 13px; cursor: pointer; width: 100%; }}
    button:hover {{ background: #2563eb; }}
    button:disabled {{ background: #475569; cursor: default; }}
    .status {{ margin-top: 10px; font-size: 12px; color: #94a3b8; min-height: 18px; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
    th {{ text-align: left; color: #64748b; font-weight: 500; padding: 6px 0; border-bottom: 1px solid #334155; }}
    td {{ padding: 8px 0; border-bottom: 1px solid #1e293b; }}
  </style>
</head>
<body>
  <h1>creator-metrics sync</h1>
  <p>Manual triggers + scheduled job status</p>

  <div class="grid">
    <div class="card">
      <h2>Mavely Sync</h2>
      <button onclick="trigger('/sync/mavely', this, 'mavely-status')">Run Now</button>
      <div class="status" id="mavely-status"></div>
    </div>
    <div class="card">
      <h2>LTK Data Sync</h2>
      <button onclick="trigger('/sync/ltk', this, 'ltk-status')">Run Now</button>
      <div class="status" id="ltk-status"></div>
    </div>
    <div class="card">
      <h2>LTK Token Refresh</h2>
      <button onclick="trigger('/sync/ltk-tokens', this, 'tokens-status')">Run Now</button>
      <div class="status" id="tokens-status"></div>
    </div>
    <div class="card">
      <h2>Amazon Sync</h2>
      <button onclick="trigger('/sync/amazon', this, 'amazon-status')">Run Now</button>
      <div class="status" id="amazon-status"></div>
    </div>
    <div class="card">
      <h2>ShopMy Sync</h2>
      <button onclick="trigger('/sync/shopmy', this, 'shopmy-status')">Run Now</button>
      <div class="status" id="shopmy-status"></div>
    </div>
    <div class="card">
      <h2>Impact.com Sync</h2>
      <button onclick="trigger('/sync/impact', this, 'impact-status')">Run Now</button>
      <div class="status" id="impact-status"></div>
    </div>
  </div>

  <div class="card" style="max-width:600px">
    <h2>Scheduled Jobs</h2>
    <table>
      <tr><th>Job</th><th>Next Run (UTC)</th></tr>
      {jobs_html}
    </table>
  </div>

  <script>
    const SECRET = "{secret}";
    async function trigger(path, btn, statusId) {{
      btn.disabled = true;
      btn.textContent = "Starting...";
      const el = document.getElementById(statusId);
      el.textContent = "";
      try {{
        const r = await fetch(path, {{
          method: "POST",
          headers: {{ Authorization: "Bearer " + SECRET }}
        }});
        const d = await r.json();
        el.textContent = d.message || d.status || JSON.stringify(d);
        btn.textContent = "Done ✓";
        setTimeout(() => {{ btn.disabled = false; btn.textContent = "Run Now"; }}, 5000);
      }} catch(e) {{
        el.textContent = "Error: " + e.message;
        btn.disabled = false;
        btn.textContent = "Run Now";
      }}
    }}
  </script>
</body>
</html>"""


@app.get("/health")
async def health():
    jobs = [{"id": j.id, "next_run": str(j.next_run_time)} for j in scheduler.get_jobs()]
    return {"status": "ok", "utc": datetime.utcnow().isoformat(), "jobs": jobs}


@app.post("/sync/ltk-tokens")
async def trigger_ltk_token_refresh(req: Request):
    _check_secret(req)
    # Runs synchronously — usually fast (Airtop browser session ~30s)
    result = await asyncio.to_thread(refresh_ltk_tokens)
    return result


@app.post("/sync/ltk")
async def trigger_ltk_sync(req: Request):
    _check_secret(req)
    asyncio.create_task(job_ltk_data_sync())
    return {"status": "accepted", "message": "LTK sync started in background"}


@app.post("/sync/mavely")
async def trigger_mavely_sync(req: Request):
    _check_secret(req)
    asyncio.create_task(job_mavely_sync())
    return {"status": "accepted", "message": "Mavely sync started in background"}


@app.post("/sync/amazon")
async def trigger_amazon_sync(req: Request):
    _check_secret(req)
    asyncio.create_task(job_amazon_sync())
    return {"status": "accepted", "message": "Amazon sync started in background"}


@app.post("/sync/shopmy")
async def trigger_shopmy_sync(req: Request):
    _check_secret(req)
    asyncio.create_task(job_shopmy_sync())
    return {"status": "accepted", "message": "ShopMy sync started in background"}


@app.post("/sync/impact")
async def trigger_impact_sync(req: Request):
    _check_secret(req)
    asyncio.create_task(job_impact_sync())
    return {"status": "accepted", "message": "Impact.com sync started in background"}


class AmazonPushPayload(BaseModel):
    results: list[dict[str, Any]]


@app.post("/sync/amazon-push")
async def amazon_push(req: Request, payload: AmazonPushPayload):
    """
    Receives Amazon earnings from the local Mac cron (sync_amazon_local.py).
    Writes each result to platform_earnings. Called from residential IP to
    bypass Railway's AWS IP being blocked by Amazon Associates.
    """
    _check_secret(req)

    if not payload.results:
        return {"status": "ok", "upserted": 0}

    synced_at = datetime.now(timezone.utc)
    conn = SyncConn(_get_dsn())
    upserted = 0
    errors = []

    try:
        for r in payload.results:
            creator_id = r.get("creator_id")
            period_start = r.get("period_start")
            period_end = r.get("period_end")
            if not creator_id or not period_start or not period_end:
                errors.append(f"Missing fields in result: {r}")
                continue
            try:
                conn.execute(
                    """
                    INSERT INTO platform_earnings
                        (creator_id, platform, period_start, period_end,
                         revenue, commission, clicks, orders, synced_at)
                    VALUES ($1, 'amazon', $2::date, $3::date, $4, $5, $6, $7, $8)
                    ON CONFLICT (creator_id, platform, period_start, period_end)
                    DO UPDATE SET
                        revenue    = EXCLUDED.revenue,
                        commission = EXCLUDED.commission,
                        clicks     = EXCLUDED.clicks,
                        orders     = EXCLUDED.orders,
                        synced_at  = EXCLUDED.synced_at
                    """,
                    creator_id,
                    period_start,
                    period_end,
                    str(r.get("revenue", 0)),
                    str(r.get("commission", 0)),
                    int(r.get("clicks", 0)),
                    int(r.get("orders", 0)),
                    synced_at,
                )
                upserted += 1
                logger.info(
                    "Amazon push upserted %s: clicks=%s orders=%s commission=%s",
                    creator_id, r.get("clicks"), r.get("orders"), r.get("commission"),
                )
            except Exception as e:
                logger.error("Amazon push DB error for %s: %s", creator_id, e)
                errors.append(str(e))
    finally:
        conn.close()

    return {
        "status": "ok",
        "upserted": upserted,
        "errors": errors,
        "synced_at": synced_at.isoformat(),
    }


@app.get("/jobs")
async def list_jobs(req: Request):
    _check_secret(req)
    return [{"id": j.id, "next_run": str(j.next_run_time)} for j in scheduler.get_jobs()]


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run("main:app", host="0.0.0.0", port=port, log_level="info")
