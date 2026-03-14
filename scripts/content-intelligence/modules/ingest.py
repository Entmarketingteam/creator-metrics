"""
ingest.py — Data ingestion module for the Content Intelligence Pipeline.

Loads and normalizes data from LTK and Instagram exports for Nicki Entenmann.
All data covers the Spring 2025 period (March–May 2025).
"""

import csv
import os
import re
from datetime import datetime
from typing import Optional


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_LTK_DATE_FMT = None  # ISO 8601 — parsed with datetime.fromisoformat
_IG_DATE_FMT = "%m/%d/%Y %H:%M"


def _to_float(value: str) -> Optional[float]:
    """Convert a string to float; return None if empty or unparseable."""
    if value is None:
        return None
    v = value.strip()
    if v == "" or v == "-":
        return None
    try:
        return float(v)
    except ValueError:
        return None


def _to_int(value: str) -> Optional[int]:
    """Convert a string to int; return None if empty or unparseable."""
    f = _to_float(value)
    return int(f) if f is not None else None


def _parse_ltk_date(value: str) -> Optional[datetime]:
    """Parse an ISO 8601 date string from LTK exports."""
    if not value or not value.strip():
        return None
    try:
        # Python 3.7+ handles timezone offset like +00:00
        return datetime.fromisoformat(value.strip())
    except ValueError:
        return None


def _parse_ig_datetime(value: str) -> Optional[datetime]:
    """Parse MM/DD/YYYY HH:MM datetime from Instagram exports."""
    if not value or not value.strip():
        return None
    try:
        return datetime.strptime(value.strip(), _IG_DATE_FMT)
    except ValueError:
        return None


def _normalize_key(raw: str) -> str:
    """
    Convert a CSV column header to a snake_case Python key.
    Strips surrounding quotes, lowercases, replaces spaces/special chars with _.
    """
    key = raw.strip().strip('"').strip("'")
    key = key.lower()
    # Replace non-alphanumeric runs with underscore
    key = re.sub(r"[^a-z0-9]+", "_", key)
    key = key.strip("_")
    return key


def _read_csv(filepath: str, encoding: str = "utf-8") -> list[dict]:
    """Read a CSV file and return a list of raw dicts (string values)."""
    rows = []
    with open(filepath, encoding=encoding, newline="") as f:
        reader = csv.DictReader(f)
        # Normalize fieldnames once
        if reader.fieldnames is None:
            return rows
        normalized_fields = [_normalize_key(h) for h in reader.fieldnames]
        for raw_row in reader:
            row = {}
            for raw_key, norm_key in zip(reader.fieldnames, normalized_fields):
                row[norm_key] = raw_row.get(raw_key)
            rows.append(row)
    return rows


# ---------------------------------------------------------------------------
# LTK loaders
# ---------------------------------------------------------------------------

def load_ltk_posts(filepath: str) -> list[dict]:
    """
    Load LTK Posts by performance export.

    Expected columns:
        hero_image, date_published, clicks, commissions, orders,
        items_sold, order_conversion_rate, items_sold_conversion_rate, share_url

    Returns a list of dicts with typed values and snake_case keys.
    """
    rows = _read_csv(filepath, encoding="utf-8")
    results = []
    for r in rows:
        results.append({
            "hero_image": r.get("hero_image") or None,
            "date_published": _parse_ltk_date(r.get("date_published", "")),
            "clicks": _to_int(r.get("clicks", "")),
            "commissions": _to_float(r.get("commissions", "")),
            "orders": _to_int(r.get("orders", "")),
            "items_sold": _to_int(r.get("items_sold", "")),
            "order_conversion_rate": _to_float(r.get("order_conversion_rate", "")),
            "items_sold_conversion_rate": _to_float(r.get("items_sold_conversion_rate", "")),
            "share_url": r.get("share_url") or None,
        })
    return results


def load_ltk_products(filepath: str) -> list[dict]:
    """
    Load LTK Products/Links export.

    Expected columns:
        product_name, advertiser_name, image, sku, description, price, currency,
        url, clicks, commissions, orders, items_sold, active_links,
        order_conversion_rate, items_sold_conversion_rate

    Returns a list of dicts with typed values and snake_case keys.
    """
    rows = _read_csv(filepath, encoding="utf-8")
    results = []
    for r in rows:
        results.append({
            "product_name": r.get("product_name") or None,
            "advertiser_name": r.get("advertiser_name") or None,
            "image": r.get("image") or None,
            "sku": r.get("sku") or None,
            "description": r.get("description") or None,
            "price": _to_float(r.get("price", "")),
            "currency": r.get("currency") or None,
            "url": r.get("url") or None,
            "clicks": _to_int(r.get("clicks", "")),
            "commissions": _to_float(r.get("commissions", "")),
            "orders": _to_int(r.get("orders", "")),
            "items_sold": _to_int(r.get("items_sold", "")),
            "active_links": _to_int(r.get("active_links", "")),
            "order_conversion_rate": _to_float(r.get("order_conversion_rate", "")),
            "items_sold_conversion_rate": _to_float(r.get("items_sold_conversion_rate", "")),
        })
    return results


def load_ltk_brands(filepath: str) -> list[dict]:
    """
    Load LTK Brands aggregate export.

    Expected columns:
        advertiser_name, clicks, commissions, orders, items_sold,
        order_conversion_rate, items_sold_conversion_rate

    Returns a list of dicts with typed values and snake_case keys.
    """
    rows = _read_csv(filepath, encoding="utf-8")
    results = []
    for r in rows:
        results.append({
            "advertiser_name": r.get("advertiser_name") or None,
            "clicks": _to_int(r.get("clicks", "")),
            "commissions": _to_float(r.get("commissions", "")),
            "orders": _to_int(r.get("orders", "")),
            "items_sold": _to_int(r.get("items_sold", "")),
            "order_conversion_rate": _to_float(r.get("order_conversion_rate", "")),
            "items_sold_conversion_rate": _to_float(r.get("items_sold_conversion_rate", "")),
        })
    return results


# ---------------------------------------------------------------------------
# Instagram loaders
# ---------------------------------------------------------------------------

def load_ig_stories(filepath: str) -> list[dict]:
    """
    Load Instagram Stories export.

    Files have a UTF-8 BOM and quoted column headers.
    The Date column is either 'Lifetime' (aggregate row) or a specific date.

    Expected columns (normalized):
        post_id, account_id, account_username, account_name, description,
        duration_sec, publish_time, permalink, post_type, data_comment,
        date, views, reach, likes, shares, profile_visits, replies,
        link_clicks, navigation, follows, sticker_taps

    Returns a list of dicts with typed values.
    """
    rows = _read_csv(filepath, encoding="utf-8-sig")
    results = []
    for r in rows:
        date_raw = r.get("date", "")
        date_val: Optional[datetime] = None
        date_is_lifetime = False
        if date_raw and date_raw.strip().lower() == "lifetime":
            date_is_lifetime = True
        else:
            date_val = _parse_ig_datetime(date_raw) if date_raw else None

        results.append({
            "post_id": r.get("post_id") or None,
            "account_id": r.get("account_id") or None,
            "account_username": r.get("account_username") or None,
            "account_name": r.get("account_name") or None,
            "description": r.get("description") or None,
            "duration_sec": _to_float(r.get("duration_sec", "")),
            "publish_time": _parse_ig_datetime(r.get("publish_time", "")),
            "permalink": r.get("permalink") or None,
            "post_type": r.get("post_type") or None,
            "data_comment": r.get("data_comment") or None,
            "date": date_raw.strip() if date_raw else None,
            "date_parsed": date_val,
            "date_is_lifetime": date_is_lifetime,
            "views": _to_int(r.get("views", "")),
            "reach": _to_int(r.get("reach", "")),
            "likes": _to_int(r.get("likes", "")),
            "shares": _to_int(r.get("shares", "")),
            "profile_visits": _to_int(r.get("profile_visits", "")),
            "replies": _to_int(r.get("replies", "")),
            "link_clicks": _to_int(r.get("link_clicks", "")),
            "navigation": _to_int(r.get("navigation", "")),
            "follows": _to_int(r.get("follows", "")),
            "sticker_taps": _to_int(r.get("sticker_taps", "")),
        })
    return results


def load_ig_reels(filepath: str) -> list[dict]:
    """
    Load Instagram Reels export.

    Files have a UTF-8 BOM and quoted column headers.

    Expected columns (normalized):
        post_id, account_id, account_username, account_name, description,
        duration_sec, publish_time, permalink, post_type, data_comment,
        date, views, reach, likes, shares, follows, comments, saves

    Returns a list of dicts with typed values.
    """
    rows = _read_csv(filepath, encoding="utf-8-sig")
    results = []
    for r in rows:
        date_raw = r.get("date", "")
        date_val: Optional[datetime] = None
        date_is_lifetime = False
        if date_raw and date_raw.strip().lower() == "lifetime":
            date_is_lifetime = True
        else:
            date_val = _parse_ig_datetime(date_raw) if date_raw else None

        results.append({
            "post_id": r.get("post_id") or None,
            "account_id": r.get("account_id") or None,
            "account_username": r.get("account_username") or None,
            "account_name": r.get("account_name") or None,
            "description": r.get("description") or None,
            "duration_sec": _to_float(r.get("duration_sec", "")),
            "publish_time": _parse_ig_datetime(r.get("publish_time", "")),
            "permalink": r.get("permalink") or None,
            "post_type": r.get("post_type") or None,
            "data_comment": r.get("data_comment") or None,
            "date": date_raw.strip() if date_raw else None,
            "date_parsed": date_val,
            "date_is_lifetime": date_is_lifetime,
            "views": _to_int(r.get("views", "")),
            "reach": _to_int(r.get("reach", "")),
            "likes": _to_int(r.get("likes", "")),
            "shares": _to_int(r.get("shares", "")),
            "follows": _to_int(r.get("follows", "")),
            "comments": _to_int(r.get("comments", "")),
            "saves": _to_int(r.get("saves", "")),
        })
    return results


# ---------------------------------------------------------------------------
# Unified loader
# ---------------------------------------------------------------------------

def load_all_data(data_dir: str) -> dict:
    """
    Load all five data sources from a directory.

    Looks for:
        LTK-export (21).csv   — LTK Posts
        LTK-export (19).csv   — LTK Products
        LTK-export (18).csv   — LTK Brands
        Mar-01-2025_May-31-2025_1876201469692602.csv  — IG Stories
        Mar-01-2025_May-31-2025_776313942216639.csv   — IG Reels

    Returns:
        {
            'ltk_posts': list[dict],
            'ltk_products': list[dict],
            'ltk_brands': list[dict],
            'ig_stories': list[dict],
            'ig_reels': list[dict],
            'loaded_at': datetime,
            'date_range': {'start': datetime | None, 'end': datetime | None},
        }
    """
    files = {
        "ltk_posts":    os.path.join(data_dir, "LTK-export (21).csv"),
        "ltk_products": os.path.join(data_dir, "LTK-export (19).csv"),
        "ltk_brands":   os.path.join(data_dir, "LTK-export (18).csv"),
        "ig_stories":   os.path.join(data_dir, "Mar-01-2025_May-31-2025_1876201469692602.csv"),
        "ig_reels":     os.path.join(data_dir, "Mar-01-2025_May-31-2025_776313942216639.csv"),
    }

    ltk_posts    = load_ltk_posts(files["ltk_posts"])
    ltk_products = load_ltk_products(files["ltk_products"])
    ltk_brands   = load_ltk_brands(files["ltk_brands"])
    ig_stories   = load_ig_stories(files["ig_stories"])
    ig_reels     = load_ig_reels(files["ig_reels"])

    # Compute date range — strip timezone info so LTK and IG dates are comparable
    def _naive(dt: datetime) -> datetime:
        return dt.replace(tzinfo=None) if dt.tzinfo is not None else dt

    ltk_dates = [_naive(r["date_published"]) for r in ltk_posts if r["date_published"] is not None]
    ig_dates  = [r["publish_time"] for r in ig_stories + ig_reels if r["publish_time"] is not None]
    all_dates = ltk_dates + ig_dates

    date_start = min(all_dates) if all_dates else None
    date_end   = max(all_dates) if all_dates else None

    return {
        "ltk_posts":    ltk_posts,
        "ltk_products": ltk_products,
        "ltk_brands":   ltk_brands,
        "ig_stories":   ig_stories,
        "ig_reels":     ig_reels,
        "loaded_at":    datetime.now(),
        "date_range":   {"start": date_start, "end": date_end},
    }
