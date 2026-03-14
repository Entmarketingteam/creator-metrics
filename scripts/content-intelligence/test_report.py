"""
test_report.py — Visual smoke-test for the Content Intelligence HTML report.

Usage:
    python test_report.py

Generates a sample report with mock data and writes it to:
    output/sample_report.html
"""

import sys
import os

# Make sure modules/ is importable from this script's directory
sys.path.insert(0, os.path.dirname(__file__))

from modules.report_generator import generate_sample_report

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "output", "sample_report.html")


def main():
    path = generate_sample_report(output_path=OUTPUT_PATH)
    print(f"Report generated at: {path}")

    # Basic sanity checks
    with open(path, encoding="utf-8") as f:
        html = f.read()

    checks = [
        ("DATA injection",        "const DATA = {" in html or '"meta"' in html),
        ("Chart.js CDN",          "chart.js" in html.lower()),
        ("Hero stats section",    "hero-stats" in html),
        ("Brands chart",          "brandsChart" in html),
        ("Attribution table",     "attribution-table" in html),
        ("Post cards grid",       "posts-grid" in html),
        ("Themes donut",          "themesChart" in html),
        ("Caption words chart",   "captionWordsChart" in html),
        ("Seasonal line chart",   "seasonalChart" in html),
        ("Reels table",           "reels-table" in html),
        ("Nicki Entenmann",       "Nicki Entenmann" in html),
    ]

    print("\nSection checks:")
    all_pass = True
    for label, result in checks:
        status = "PASS" if result else "FAIL"
        print(f"  [{status}] {label}")
        if not result:
            all_pass = False

    if all_pass:
        print(f"\nAll checks passed. Open in browser:\n  open \"{path}\"")
    else:
        print("\nSome checks failed — review the output above.")
        sys.exit(1)


if __name__ == "__main__":
    main()
