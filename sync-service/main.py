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


@app.get("/jobs")
async def list_jobs(req: Request):
    _check_secret(req)
    return [{"id": j.id, "next_run": str(j.next_run_time)} for j in scheduler.get_jobs()]


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run("main:app", host="0.0.0.0", port=port, log_level="info")
