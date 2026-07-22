"""Pull FDA drug approval actions from the openFDA Drugs@FDA endpoint for a date window.

Window comes from START_DATE / END_DATE env vars (ISO dates), else the trailing
WINDOW_DAYS (default 60). openFDA matches an application if ANY of its submissions
matches the query, so we re-filter client-side to submissions approved (status AP)
inside the window. No API key required at this volume.
"""

import os
import urllib.parse
from datetime import date, timedelta

from common import fetch_json, today, yyyymmdd_to_iso

BASE = "https://api.fda.gov/drug/drugsfda.json"
PAGE_SIZE = 100


def window() -> tuple[date, date]:
    end_env, start_env = os.environ.get("END_DATE"), os.environ.get("START_DATE")
    end = date.fromisoformat(end_env) if end_env else today()
    if start_env:
        start = date.fromisoformat(start_env)
    else:
        start = end - timedelta(days=int(os.environ.get("WINDOW_DAYS", "60")))
    return start, end


def fetch_recent_approvals() -> tuple[list[dict], dict]:
    start, end = window()
    lo, hi = start.strftime("%Y%m%d"), end.strftime("%Y%m%d")
    search = f"submissions.submission_status:AP AND submissions.submission_status_date:[{lo} TO {hi}]"

    apps, skip, total = [], 0, None
    while total is None or skip < total:
        qs = urllib.parse.urlencode({"search": search, "limit": PAGE_SIZE, "skip": skip})
        payload = fetch_json(f"{BASE}?{qs}")
        total = payload["meta"]["results"]["total"]
        apps.extend(payload.get("results", []))
        skip += PAGE_SIZE

    records = []
    for app in apps:
        events = [
            {
                "date": yyyymmdd_to_iso(sub.get("submission_status_date")),
                "type": sub.get("submission_type"),
                "class": sub.get("submission_class_code_description"),
                "priority": sub.get("review_priority"),
                "letter_url": next(
                    (d["url"] for d in sub.get("application_docs", []) if d.get("type") == "Letter"),
                    None,
                ),
            }
            for sub in app.get("submissions", [])
            if sub.get("submission_status") == "AP"
            and lo <= (sub.get("submission_status_date") or "") <= hi
        ]
        if not events:
            continue
        events.sort(key=lambda e: e["date"] or "", reverse=True)

        products = app.get("products", [])
        brands = sorted({p["brand_name"].title() for p in products if p.get("brand_name")})
        generics = sorted(
            {
                ing["name"].title()
                for p in products
                for ing in p.get("active_ingredients", [])
                if ing.get("name")
            }
        )
        forms = sorted({p["dosage_form"].title() for p in products if p.get("dosage_form")})

        records.append(
            {
                "app": app.get("application_number", ""),
                "sponsor": (app.get("sponsor_name") or "").title(),
                "brands": brands,
                "generics": generics,
                "forms": forms,
                "events": events,
            }
        )

    records.sort(key=lambda r: r["events"][0]["date"] or "", reverse=True)
    return records, {"start": start.isoformat(), "end": end.isoformat()}
