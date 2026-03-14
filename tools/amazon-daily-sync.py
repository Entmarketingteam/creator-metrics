#!/usr/bin/env python3
"""
Amazon Associates Daily Sync — full pipeline
=============================================
1. Refreshes credentials from live Chrome session
2. Syncs Nicki (+ other creators once their credentials are set up)

Run manually:   python3 tools/amazon-daily-sync.py
Task Scheduler: runs this at 8:30am daily
"""
import sys
import os

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# Add tools dir to path so we can import sibling scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from datetime import datetime, timezone
import subprocess

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PYTHON = sys.executable
TOOLS = os.path.join(PROJECT_DIR, "tools")


def refresh_credentials():
    """Import and call capture-amazon-request directly (avoids subprocess CDP issues)."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "capture", os.path.join(TOOLS, "capture-amazon-request.py")
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.main()


def run_sync(creator, months=6, days=90):
    cmd = [PYTHON, os.path.join(TOOLS, "amazon-data-sync.py"),
           "--creator", creator, "--months", str(months), "--days", str(days)]
    result = subprocess.run(cmd, cwd=PROJECT_DIR)
    return result.returncode == 0


def main():
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    print(f"\nAmazon Daily Sync -- {now}")
    print("=" * 60)

    # Step 1: Refresh credentials
    print("\nStep 1: Refreshing credentials from Chrome...")
    try:
        ok = refresh_credentials()
        if not ok:
            print("WARN: Credential refresh failed -- trying sync with existing credentials")
    except SystemExit as e:
        if e.code != 0:
            print("WARN: Credential refresh failed -- trying sync with existing credentials")
    except Exception as e:
        print(f"WARN: Credential refresh error: {e} -- trying sync with existing credentials")

    # Step 2: Sync creators
    print("\nStep 2: Syncing creators...")
    creators = ["nicki"]  # Add "ann", "ellen", "emily" once their credentials are set up
    for creator in creators:
        print(f"\n  [{creator}]")
        run_sync(creator)

    print(f"\nDone -- {datetime.now(timezone.utc).strftime('%H:%M:%S UTC')}")


if __name__ == "__main__":
    main()
