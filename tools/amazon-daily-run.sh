#!/bin/bash
# Refresh cookies then immediately sync — runs as single LaunchAgent job at 8:00am
# Secrets injected via `doppler run` in the plist (env vars available here)
# NOTE: cookie-refresh requires SMS 2FA (Amazon sends to phone ~946) — non-automatable.
# It is attempted opportunistically; failure is non-fatal so data-sync still runs
# with whatever cookies are currently stored in Doppler.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "[$(date)] Attempting Amazon cookie refresh (may fail if SMS 2FA required)..."
/usr/bin/python3 "$SCRIPT_DIR/amazon-cookie-refresh.py" --creator nicki \
  && echo "[$(date)] Cookie refresh succeeded." \
  || echo "[$(date)] Cookie refresh failed (SMS 2FA?) — proceeding with stored cookies."

echo "[$(date)] Syncing Amazon data..."
/usr/bin/python3 "$SCRIPT_DIR/amazon-data-sync.py" --creator nicki --months 3
