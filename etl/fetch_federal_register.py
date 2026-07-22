"""Pull recent FDA documents (rules, proposed rules, notices) from the Federal Register API.

This is the official forward-looking 'FDA calendar': advisory committee meeting notices,
comment periods, and rulemaking all publish here. Free JSON, no key.
"""

import os
import urllib.parse
from datetime import timedelta

from common import fetch_json, today

BASE = "https://www.federalregister.gov/api/v1/documents.json"

FEDREG_DAYS = int(os.environ.get("FEDREG_DAYS", "30"))
MAX_PAGES = 3


def fetch_fda_documents() -> list[dict]:
    start = (today() - timedelta(days=FEDREG_DAYS)).isoformat()
    params = [
        ("conditions[agencies][]", "food-and-drug-administration"),
        ("conditions[publication_date][gte]", start),
        ("order", "newest"),
        ("per_page", "100"),
    ]
    url = f"{BASE}?{urllib.parse.urlencode(params)}"

    docs, pages = [], 0
    while url and pages < MAX_PAGES:
        payload = fetch_json(url)
        for item in payload.get("results", []):
            abstract = item.get("abstract") or ""
            if len(abstract) > 320:
                abstract = abstract[:317].rstrip() + "..."
            docs.append(
                {
                    "title": item.get("title"),
                    "type": item.get("type"),
                    "date": item.get("publication_date"),
                    "url": item.get("html_url"),
                    "abstract": abstract,
                }
            )
        url = payload.get("next_page_url")
        pages += 1
    return docs
