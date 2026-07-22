"""Run the full RxIP Radar pipeline: fetch -> join -> emit site JSON.

Usage:
  python etl/run_all.py                                   # trailing 60 days
  START_DATE=2026-01-01 python etl/run_all.py             # Jan 1 through today
  START_DATE=2026-01-01 END_DATE=2026-06-30 python ...    # fixed window
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_site_data import build
from fetch_approvals import fetch_recent_approvals
from fetch_federal_register import fetch_fda_documents
from fetch_orange_book import load_orange_book


def main() -> None:
    print("[1/4] Downloading FDA Orange Book bulk data...")
    orange_book = load_orange_book()
    print(f"      {sum(len(v) for v in orange_book['patents'].values())} patent listings "
          f"across {len(orange_book['patents'])} applications")

    print("[2/4] Fetching approval actions from openFDA...")
    approvals, window = fetch_recent_approvals()
    print(f"      {len(approvals)} applications with approvals in {window['start']}..{window['end']}")

    print("[3/4] Fetching recent FDA Federal Register documents...")
    fedreg = fetch_fda_documents()
    print(f"      {len(fedreg)} documents")

    print("[4/4] Joining and writing site data...")
    meta = build(approvals, window, orange_book, fedreg)
    stats = meta["stats"]
    print(f"      new drugs: {stats['new_drugs']}  biologics: {stats['biologics']}  "
          f"generics: {stats['generics']}  supplements: {stats['supplements']}")
    print(f"      median patent runway (new drugs): {stats['median_patent_runway_years']} years")
    print("Done. Output in docs/data/")


if __name__ == "__main__":
    main()
