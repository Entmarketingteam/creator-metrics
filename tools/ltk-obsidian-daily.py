#!/usr/bin/env python3
"""
LTK Daily Commission Summary → Obsidian Vault
Runs via LaunchAgent at 7am daily.
Fetches yesterday's LTK performance per creator and appends to their LTK.md note.
"""

import json
import os
import subprocess
import sys
from datetime import date, timedelta

import requests

# ── Config ────────────────────────────────────────────────────────────────────

AIRTABLE_BASE = "appQnKyfyRyhHX44h"
AIRTABLE_TABLE = "LTK_Credentials"
LTK_GATEWAY = "https://api-gateway.rewardstyle.com"

# Vault note paths (relative name — obsidian CLI resolves by filename)
CREATORS = [
    {"name": "Nicki Entenmann", "ltk_path": "02-Creators/Nicki Entenmann/Affiliate/LTK.md"},
    # Add others once publisher IDs are in Airtable:
    # {"name": "Ann Schulte", "ltk_path": "02-Creators/Ann Schulte/Affiliate/LTK.md"},
    # {"name": "Ellen Ludwig", "ltk_path": "02-Creators/Ellen Ludwig/Affiliate/LTK.md"},
    # {"name": "Sara Preston", "ltk_path": "02-Creators/Sara Preston/Affiliate/LTK.md"},
]


# ── Helpers ───────────────────────────────────────────────────────────────────

def doppler(key: str) -> str:
    result = subprocess.run(
        ["doppler", "secrets", "get", key, "--project", "ent-agency-automation", "--config", "dev", "--plain"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        raise RuntimeError(f"Doppler failed for {key}: {result.stderr}")
    return result.stdout.strip()


def get_ltk_tokens(airtable_token: str, creator_name: str) -> dict:
    """Fetch LTK tokens from Airtable for a specific creator."""
    url = (
        f"https://api.airtable.com/v0/{AIRTABLE_BASE}/{AIRTABLE_TABLE}"
        f"?filterByFormula={{Creator}}='{creator_name}'"
        f"&sort%5B0%5D%5Bfield%5D=Last_Refreshed&sort%5B0%5D%5Bdirection%5D=desc"
        f"&maxRecords=1"
    )
    res = requests.get(url, headers={"Authorization": f"Bearer {airtable_token}"})
    res.raise_for_status()
    records = res.json().get("records", [])
    if not records:
        raise RuntimeError(f"No LTK credentials found for {creator_name}")
    fields = records[0]["fields"]
    return {
        "access_token": fields["Access_Token"],
        "id_token": fields["ID_Token"],
        "publisher_id": str(fields["Publisher_ID"]),
    }


def ltk_headers(tokens: dict) -> dict:
    return {
        "Authorization": f"Bearer {tokens['access_token']}",
        "x-id-token": tokens["id_token"],
        "Origin": "https://creator.shopltk.com",
        "Referer": "https://creator.shopltk.com/",
        "Content-Type": "application/json",
    }


def fetch_performance(tokens: dict, start: str, end: str) -> dict:
    params = {
        "start_date": f"{start}T00:00:00Z",
        "end_date": f"{end}T23:59:59Z",
        "publisher_ids": tokens["publisher_id"],
        "platform": "rs,ltk",
        "timezone": "UTC",
    }
    res = requests.get(
        f"{LTK_GATEWAY}/api/creator-analytics/v1/performance_summary",
        headers=ltk_headers(tokens),
        params=params,
    )
    res.raise_for_status()
    return res.json().get("data", {})


def fetch_top_items(tokens: dict, start: str, end: str, limit=5) -> list:
    params = {
        "limit": "50",
        "start": f"{start}T00:00:00.000Z",
        "end": f"{end}T23:59:59.000Z",
        "currency": "USD",
    }
    res = requests.get(
        f"{LTK_GATEWAY}/api/creator-analytics/v1/items_sold/",
        headers=ltk_headers(tokens),
        params=params,
    )
    if not res.ok:
        return []
    items = res.json().get("items_sold", [])
    # Sort by commission value descending
    items.sort(key=lambda x: float(x.get("amount", {}).get("value", 0)), reverse=True)
    return items[:limit]


def obsidian_append(vault_path: str, content: str):
    """Append content to an Obsidian note via CLI. vault_path is relative to vault root."""
    env = {**os.environ, "PATH": f"/opt/homebrew/bin:{os.environ.get('PATH', '')}"}
    result = subprocess.run(
        ["obsidian", "vault=obsidian-vault", "append", f"path={vault_path}", f"content={content}"],
        capture_output=True, text=True, env=env,
    )
    if result.returncode != 0:
        raise RuntimeError(f"obsidian append failed: {result.stderr or result.stdout}")


def build_summary(creator_name: str, perf: dict, items: list, yesterday: str) -> str:
    clicks = perf.get("clicks", 0)
    orders = perf.get("orders", 0)
    commission = perf.get("net_commissions", 0)

    lines = [
        f"\n## {yesterday}",
        f"- Clicks: {clicks}",
        f"- Orders: {orders}",
        f"- Commission: ${commission:.2f}",
    ]

    if items:
        lines.append("- Top items:")
        for item in items:
            val = float(item.get("amount", {}).get("value", 0))
            retailer = item.get("advertiser_display_name", "?")
            title = item.get("product_title", "?")[:50]
            lines.append(f"  - {retailer} — {title} (${val:.2f})")

    return "\n".join(lines)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    yesterday = (date.today() - timedelta(days=1)).strftime("%Y-%m-%d")
    print(f"LTK daily sync for {yesterday}")

    airtable_token = doppler("AIRTABLE_TOKEN")

    errors = []
    for creator in CREATORS:
        name = creator["name"]
        try:
            print(f"  {name}...")
            tokens = get_ltk_tokens(airtable_token, name)
            perf = fetch_performance(tokens, yesterday, yesterday)
            items = fetch_top_items(tokens, yesterday, yesterday)
            summary = build_summary(name, perf, items, yesterday)
            obsidian_append(creator["ltk_path"], summary)
            commission = perf.get("net_commissions", 0)
            print(f"    ✓ ${commission:.2f} commission, {perf.get('clicks', 0)} clicks")
        except Exception as e:
            print(f"    ✗ {e}", file=sys.stderr)
            errors.append(f"{name}: {e}")

    if errors:
        print("\nErrors:", file=sys.stderr)
        for e in errors:
            print(f"  {e}", file=sys.stderr)
        sys.exit(1)

    print("Done.")


if __name__ == "__main__":
    main()
