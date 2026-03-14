#!/usr/bin/env python3
"""
Amazon PA API v5 — Product Lookup
===================================
Looks up product details by ASIN using the Product Advertising API v5.
Uses AWS Signature Version 4 (no external SDK needed).

Credentials in Doppler (ent-agency-analytics/prd):
  AMAZON_PAAPI_ACCESS_KEY    — access key ID
  AMAZON_PAAPI_SECRET_KEY    — secret access key
  AMAZON_PAAPI_ASSOCIATE_TAG — e.g. nickientenman-20

Usage:
  python3 tools/amazon-paapi.py B08N5WRWNW
  python3 tools/amazon-paapi.py B08N5WRWNW B07XJ8C8F7   # up to 10 ASINs
  python3 tools/amazon-paapi.py --search "creatine powder"
"""

import argparse
import hashlib
import hmac
import json
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone


HOST = "webservices.amazon.com"
REGION = "us-east-1"
SERVICE = "ProductAdvertisingAPI"
ENDPOINT = f"https://{HOST}/paapi5/getitems"
SEARCH_ENDPOINT = f"https://{HOST}/paapi5/searchitems"


def get_secret(key: str) -> str:
    r = subprocess.run(
        ["doppler", "secrets", "get", key, "--plain",
         "--project", "ent-agency-analytics", "--config", "prd"],
        capture_output=True, text=True,
    )
    return r.stdout.strip()


def sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def get_signature_key(secret: str, date: str) -> bytes:
    k = sign(("AWS4" + secret).encode("utf-8"), date)
    k = sign(k, REGION)
    k = sign(k, SERVICE)
    return sign(k, "aws4_request")


def build_headers(payload: dict, endpoint: str) -> dict:
    access_key = get_secret("AMAZON_PAAPI_ACCESS_KEY")
    secret_key = get_secret("AMAZON_PAAPI_SECRET_KEY")

    now = datetime.now(timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")

    body = json.dumps(payload, separators=(",", ":"))
    body_hash = hashlib.sha256(body.encode()).hexdigest()

    path = "/" + endpoint.split(HOST + "/")[1]
    canonical = "\n".join([
        "POST",
        path,
        "",
        f"content-encoding:amz-sdk-invocation-id\n"
        f"content-type:application/json; charset=UTF-8\n"
        f"host:{HOST}\n"
        f"x-amz-date:{amz_date}\n"
        f"x-amz-target:com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems\n",
        "content-encoding;content-type;host;x-amz-date;x-amz-target",
        body_hash,
    ])

    # Simpler approach using standard SigV4
    headers_to_sign = {
        "content-type": "application/json; charset=UTF-8",
        "host": HOST,
        "x-amz-date": amz_date,
        "x-amz-target": (
            "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems"
            if "getitems" in endpoint else
            "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems"
        ),
    }

    signed_headers = ";".join(sorted(headers_to_sign.keys()))
    canonical_headers = "".join(f"{k}:{v}\n" for k, v in sorted(headers_to_sign.items()))

    canonical_request = "\n".join([
        "POST", path, "",
        canonical_headers, signed_headers, body_hash,
    ])

    credential_scope = f"{date_stamp}/{REGION}/{SERVICE}/aws4_request"
    string_to_sign = "\n".join([
        "AWS4-HMAC-SHA256", amz_date, credential_scope,
        hashlib.sha256(canonical_request.encode()).hexdigest(),
    ])

    sig_key = get_signature_key(secret_key, date_stamp)
    signature = hmac.new(sig_key, string_to_sign.encode(), hashlib.sha256).hexdigest()

    auth = (
        f"AWS4-HMAC-SHA256 Credential={access_key}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    return {
        **headers_to_sign,
        "Authorization": auth,
        "Content-Type": "application/json; charset=UTF-8",
    }


def get_items(asins: list[str]) -> list[dict]:
    """Fetch product details for up to 10 ASINs."""
    tag = get_secret("AMAZON_PAAPI_ASSOCIATE_TAG")

    payload = {
        "ItemIds": asins[:10],
        "PartnerTag": tag,
        "PartnerType": "Associates",
        "Marketplace": "www.amazon.com",
        "Resources": [
            "ItemInfo.Title",
            "ItemInfo.ByLineInfo",
            "ItemInfo.Classifications",
            "Images.Primary.Large",
            "Images.Primary.Medium",
            "Offers.Listings.Price",
            "Offers.Listings.Availability.Message",
            "BrowseNodeInfo.BrowseNodes",
        ],
    }

    headers = build_headers(payload, ENDPOINT)
    body = json.dumps(payload, separators=(",", ":")).encode()

    req = urllib.request.Request(ENDPOINT, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f"HTTP {e.code}: {err[:300]}")
        sys.exit(1)

    results = []
    for item in data.get("ItemsResult", {}).get("Items", []):
        asin = item.get("ASIN")
        title = item.get("ItemInfo", {}).get("Title", {}).get("DisplayValue")
        img = (item.get("Images", {}).get("Primary", {})
               .get("Large", {}).get("URL"))
        price_obj = (item.get("Offers", {}).get("Listings", [{}])[0]
                     .get("Price", {}))
        price = price_obj.get("DisplayAmount")
        url = item.get("DetailPageURL")
        category = (item.get("BrowseNodeInfo", {})
                    .get("BrowseNodes", [{}])[0].get("DisplayName"))
        results.append({
            "asin": asin,
            "title": title,
            "image_url": img,
            "price": price,
            "category": category,
            "url": url,
        })
    return results


def search_items(keywords: str, category: str = "All") -> list[dict]:
    """Search products by keyword."""
    tag = get_secret("AMAZON_PAAPI_ASSOCIATE_TAG")

    payload = {
        "Keywords": keywords,
        "SearchIndex": category,
        "PartnerTag": tag,
        "PartnerType": "Associates",
        "Marketplace": "www.amazon.com",
        "ItemCount": 10,
        "Resources": [
            "ItemInfo.Title",
            "Images.Primary.Medium",
            "Offers.Listings.Price",
        ],
    }

    headers = build_headers(payload, SEARCH_ENDPOINT)
    body = json.dumps(payload, separators=(",", ":")).encode()

    req = urllib.request.Request(SEARCH_ENDPOINT, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()[:300]}")
        sys.exit(1)

    results = []
    for item in data.get("SearchResult", {}).get("Items", []):
        asin = item.get("ASIN")
        title = item.get("ItemInfo", {}).get("Title", {}).get("DisplayValue")
        img = (item.get("Images", {}).get("Primary", {})
               .get("Medium", {}).get("URL"))
        price = (item.get("Offers", {}).get("Listings", [{}])[0]
                 .get("Price", {}).get("DisplayAmount"))
        results.append({"asin": asin, "title": title, "image_url": img, "price": price})
    return results


def main():
    ap = argparse.ArgumentParser(description="Amazon PA API v5 product lookup")
    ap.add_argument("asins", nargs="*", help="ASINs to look up (max 10)")
    ap.add_argument("--search", help="Search by keyword instead")
    ap.add_argument("--category", default="All", help="Search category (default: All)")
    args = ap.parse_args()

    if args.search:
        print(f"Searching: {args.search}\n")
        items = search_items(args.search, args.category)
    elif args.asins:
        print(f"Looking up {len(args.asins)} ASIN(s)...\n")
        items = get_items(args.asins)
    else:
        ap.print_help()
        sys.exit(0)

    for item in items:
        print(f"ASIN   : {item['asin']}")
        print(f"Title  : {item.get('title', 'N/A')}")
        print(f"Price  : {item.get('price', 'N/A')}")
        print(f"Image  : {item.get('image_url', 'N/A')}")
        if item.get("category"):
            print(f"Category: {item['category']}")
        print()

    print(json.dumps(items, indent=2))


if __name__ == "__main__":
    main()
