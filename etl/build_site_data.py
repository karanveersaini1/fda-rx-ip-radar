"""Join FDA approval events to Orange Book patents/exclusivities and emit site JSON.

Output (docs/data/):
  approvals.json  - one record per application with in-window approval events,
                    enriched with Orange Book patents + exclusivity periods
  fedreg.json     - recent FDA Federal Register documents
  meta.json       - generation timestamp, window, headline stats
"""

import statistics
from datetime import datetime, timezone

from common import write_json


def app_key(application_number: str) -> tuple[str, str] | None:
    """'NDA020610' -> ('N','020610'); 'ANDA215328' -> ('A','215328'); BLA -> None.

    Biologics (BLAs) have no Orange Book listing requirement — the BPCIA 'patent
    dance' is private. That transparency gap is a feature of the law, not a bug
    in this pipeline, and the UI says so explicitly.
    """
    if application_number.startswith("ANDA"):
        return ("A", application_number[4:].zfill(6))
    if application_number.startswith("NDA"):
        return ("N", application_number[3:].zfill(6))
    return None


def categorize(record: dict) -> str:
    orig = any(e["type"] == "ORIG" for e in record["events"])
    app = record["app"]
    if app.startswith("ANDA"):
        return "generic" if orig else "supplement"
    if app.startswith("BLA"):
        return "biologic" if orig else "supplement"
    if app.startswith("NDA"):
        return "new-drug" if orig else "supplement"
    return "other"


def build(approvals: list[dict], window: dict, orange_book: dict, fedreg: list[dict]) -> dict:
    enriched = []
    for rec in approvals:
        key = app_key(rec["app"])
        patents = orange_book["patents"].get(key, []) if key else []
        exclusivities = orange_book["exclusivities"].get(key, []) if key else []
        ob_product = orange_book["products"].get(key) if key else None

        live_patents = [p for p in patents if not p["delisted"]]
        expiries = [p["expires"] for p in live_patents if p["expires"]]
        excl_dates = [e["expires"] for e in exclusivities if e["expires"]]

        rec = dict(rec)
        if ob_product:
            rec["brands"] = rec["brands"] or ob_product["trade_names"]
            rec["generics"] = rec["generics"] or ob_product["ingredients"]
        rec["category"] = categorize(rec)
        rec["is_biologic"] = rec["app"].startswith("BLA")
        rec["patents"] = live_patents
        rec["exclusivities"] = exclusivities
        rec["cliff"] = {
            "patent_count": len(live_patents),
            "first_patent_expiry": min(expiries) if expiries else None,
            "last_patent_expiry": max(expiries) if expiries else None,
            "exclusivity_end": max(excl_dates) if excl_dates else None,
        }
        enriched.append(rec)

    stats = headline_stats(enriched, window)
    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "window": window,
        "stats": stats,
    }

    write_json("approvals.json", enriched)
    write_json("fedreg.json", fedreg)
    write_json("meta.json", meta)
    return meta


def headline_stats(records: list[dict], window: dict) -> dict:
    end_year = int(window["end"][:4])
    new_drugs = [r for r in records if r["category"] == "new-drug"]
    biologics = [r for r in records if r["category"] == "biologic"]
    generics = [r for r in records if r["category"] == "generic"]

    # Years of runway from approval to the LAST listed patent expiry, new drugs only.
    runways = []
    for r in new_drugs:
        last = r["cliff"]["last_patent_expiry"]
        if last:
            approved = r["events"][0]["date"]
            runways.append(round((int(last[:4]) - int(approved[:4])) + (int(last[5:7]) - int(approved[5:7])) / 12, 1))

    by_month: dict = {}
    for r in records:
        for e in r["events"]:
            month = e["date"][:7]
            bucket = by_month.setdefault(month, {"new-drug": 0, "biologic": 0, "generic": 0, "supplement": 0, "other": 0})
            if e["type"] == "ORIG" or r["category"] == "supplement":
                bucket[r["category"]] += 1

    return {
        "total_applications": len(records),
        "new_drugs": len(new_drugs),
        "biologics": len(biologics),
        "generics": len(generics),
        "supplements": sum(1 for r in records if r["category"] == "supplement"),
        "new_drugs_with_patents": sum(1 for r in new_drugs if r["cliff"]["patent_count"]),
        "median_patent_runway_years": round(statistics.median(runways), 1) if runways else None,
        "max_patent_expiry_year": max(
            (int(r["cliff"]["last_patent_expiry"][:4]) for r in records if r["cliff"]["last_patent_expiry"]),
            default=end_year,
        ),
        "by_month": dict(sorted(by_month.items())),
    }
