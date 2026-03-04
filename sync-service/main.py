"""
creator-metrics sync service
Handles LTK token refresh (Playwright/Airtop) + Mavely GraphQL sync.
Runs on Railway. APScheduler handles cron jobs.
FastAPI provides health + manual trigger endpoints.
"""
import os, logging, asyncio
from contextlib import asynccontextmanager
from datetime import datetime

import asyncpg
from fastapi import FastAPI, HTTPException, Request
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from sync_ltk import refresh_ltk_tokens, sync_ltk_data
from sync_mavely import sync_mavely

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ── DB connection ─────────────────────────────────────────────────────────────

_pool: asyncpg.Pool | None = None

async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        db_url = os.environ["DATABASE_URL"]
        # asyncpg requires postgresql:// not postgres://
        if db_url.startswith("postgres://"):
            db_url = db_url.replace("postgres://", "postgresql://", 1)
        _pool = await asyncpg.create_pool(db_url, min_size=1, max_size=5)
    return _pool


class SyncConn:
    """
    Synchronous DB wrapper for use inside asyncio.to_thread().
    Each call uses a fresh connection from the pool (thread-safe).
    """
    def __init__(self, dsn: str):
        self._dsn = dsn

    def execute(self, query: str, *args):
        import asyncpg as _asyncpg
        import asyncio

        async def _run():
            conn = await _asyncpg.connect(self._dsn)
            try:
                return await conn.execute(query, *args)
            finally:
                await conn.close()

        # Run in the current event loop
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
        return loop.run_until_complete(_run())


# ── Scheduler jobs ────────────────────────────────────────────────────────────

async def job_ltk_token_refresh():
    logger.info("=== JOB: LTK token refresh ===")
    try:
        result = await asyncio.to_thread(refresh_ltk_tokens)
        logger.info("LTK token refresh done: %s", result)
    except Exception as e:
        logger.error("LTK token refresh FAILED: %s", e)

def _make_sync_conn() -> SyncConn:
    db_url = os.environ["DATABASE_URL"]
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql://", 1)
    return SyncConn(db_url)

async def job_ltk_data_sync():
    logger.info("=== JOB: LTK data sync ===")
    try:
        result = await asyncio.to_thread(sync_ltk_data, _make_sync_conn())
        logger.info("LTK data sync done: %s", result)
    except Exception as e:
        logger.error("LTK data sync FAILED: %s", e)

async def job_mavely_sync():
    logger.info("=== JOB: Mavely sync ===")
    try:
        result = await asyncio.to_thread(sync_mavely, _make_sync_conn())
        logger.info("Mavely sync done: %s", result)
    except Exception as e:
        logger.error("Mavely sync FAILED: %s", e)


# ── App lifecycle ─────────────────────────────────────────────────────────────

scheduler = AsyncIOScheduler(timezone="UTC")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting sync service scheduler...")

    # LTK token refresh: every 3 hours (more frequent to avoid stale tokens)
    scheduler.add_job(job_ltk_token_refresh, CronTrigger(hour="*/3"), id="ltk_token_refresh")

    # LTK data sync: 6:30 UTC daily
    scheduler.add_job(job_ltk_data_sync, CronTrigger(hour=6, minute=30), id="ltk_data_sync")

    # Mavely sync: 8:00 UTC daily
    scheduler.add_job(job_mavely_sync, CronTrigger(hour=8, minute=0), id="mavely_sync")

    scheduler.start()
    logger.info("Scheduler started. Jobs: %s", [j.id for j in scheduler.get_jobs()])

    yield

    scheduler.shutdown()
    if _pool:
        await _pool.close()

app = FastAPI(title="creator-metrics sync", lifespan=lifespan)

# ── Auth ──────────────────────────────────────────────────────────────────────

def _check_secret(req: Request):
    auth = req.headers.get("authorization", "")
    secret = os.environ.get("SYNC_SECRET", "")
    if not secret or auth != f"Bearer {secret}":
        raise HTTPException(status_code=401, detail="Unauthorized")


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    jobs = [{"id": j.id, "next_run": str(j.next_run_time)} for j in scheduler.get_jobs()]
    return {"status": "ok", "utc": datetime.utcnow().isoformat(), "jobs": jobs}

@app.post("/sync/ltk-tokens")
async def trigger_ltk_token_refresh(req: Request):
    _check_secret(req)
    result = await asyncio.to_thread(refresh_ltk_tokens)
    return result

@app.post("/sync/ltk")
async def trigger_ltk_sync(req: Request):
    _check_secret(req)
    result = await asyncio.to_thread(sync_ltk_data, _make_sync_conn())
    return result

@app.post("/sync/mavely")
async def trigger_mavely_sync(req: Request):
    _check_secret(req)
    result = await asyncio.to_thread(sync_mavely, _make_sync_conn())
    return result

@app.get("/jobs")
async def list_jobs(req: Request):
    _check_secret(req)
    return [{"id": j.id, "next_run": str(j.next_run_time)} for j in scheduler.get_jobs()]


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run("main:app", host="0.0.0.0", port=port, log_level="info")
