"""Download the FDA Orange Book bulk files and parse patents, exclusivities, and products.

The Orange Book is the statutory FDA<->USPTO bridge created by the Hatch-Waxman Act:
every approved small-molecule drug application lists the patents that cover it and its
regulatory exclusivity periods. Published monthly as a free zip of tilde-delimited files.
"""

import io
import zipfile

from common import fetch, ob_date_to_iso

EOB_URL = "https://www.fda.gov/media/76860/download?attachment"

# Common exclusivity codes -> human-readable labels (prefix-matched, longest first).
EXCLUSIVITY_LABELS = [
    ("NCE", "New Chemical Entity (5-year)"),
    ("NPP", "New Patient Population (3-year)"),
    ("NP", "New Product (3-year)"),
    ("NS", "New Strength (3-year)"),
    ("NDF", "New Dosage Form (3-year)"),
    ("NR", "New Route (3-year)"),
    ("NC", "New Combination (3-year)"),
    ("ODE", "Orphan Drug (7-year)"),
    ("PED", "Pediatric (+6 months)"),
    ("PC", "Patent Challenge (180-day first generic)"),
    ("GAIN", "GAIN Act antibiotic (+5 years)"),
    ("RTO", "Rx-to-OTC Switch (3-year)"),
    ("I-", "New Indication (3-year)"),
    ("D-", "New Dosing Schedule (3-year)"),
    ("M-", "Miscellaneous Change (3-year)"),
    ("W", "Pediatric Written Request"),
]


def exclusivity_label(code: str) -> str:
    for prefix, label in EXCLUSIVITY_LABELS:
        if code.startswith(prefix):
            return label
    return "Other exclusivity"


def _rows(zf: zipfile.ZipFile, name: str):
    with zf.open(name) as fh:
        lines = io.TextIOWrapper(fh, encoding="latin-1").read().splitlines()
    header = lines[0].split("~")
    for line in lines[1:]:
        if line.strip():
            yield dict(zip(header, line.split("~")))


def load_orange_book() -> dict:
    """Return {'patents': {...}, 'exclusivities': {...}, 'products': {...}} keyed by
    (Appl_Type, Appl_No) e.g. ('N', '020610'). Appl_Type: N = NDA, A = ANDA."""
    raw = fetch(EOB_URL)
    zf = zipfile.ZipFile(io.BytesIO(raw))

    patents: dict = {}
    for row in _rows(zf, "patent.txt"):
        key = (row["Appl_Type"], row["Appl_No"])
        patents.setdefault(key, []).append(
            {
                "patent_no": row["Patent_No"],
                "expires": ob_date_to_iso(row["Patent_Expire_Date_Text"]),
                "drug_substance": row["Drug_Substance_Flag"] == "Y",
                "drug_product": row["Drug_Product_Flag"] == "Y",
                "use_code": row["Patent_Use_Code"] or None,
                "submitted": ob_date_to_iso(row.get("Submission_Date", "")),
                "delisted": row.get("Delist_Flag") == "Y",
            }
        )

    exclusivities: dict = {}
    for row in _rows(zf, "exclusivity.txt"):
        key = (row["Appl_Type"], row["Appl_No"])
        code = row["Exclusivity_Code"]
        exclusivities.setdefault(key, []).append(
            {
                "code": code,
                "label": exclusivity_label(code),
                "expires": ob_date_to_iso(row["Exclusivity_Date"]),
            }
        )

    products: dict = {}
    for row in _rows(zf, "products.txt"):
        key = (row["Appl_Type"], row["Appl_No"])
        entry = products.setdefault(
            key,
            {"trade_names": set(), "ingredients": set(), "applicant": row["Applicant_Full_Name"]},
        )
        entry["trade_names"].add(row["Trade_Name"].title())
        entry["ingredients"].add(row["Ingredient"].title())

    for entry in products.values():
        entry["trade_names"] = sorted(entry["trade_names"])
        entry["ingredients"] = sorted(entry["ingredients"])

    # Dedupe patents (same patent can be listed per product/strength).
    for key, plist in patents.items():
        seen, unique = set(), []
        for p in plist:
            sig = (p["patent_no"], p["use_code"])
            if sig not in seen:
                seen.add(sig)
                unique.append(p)
        unique.sort(key=lambda p: p["expires"] or "")
        patents[key] = unique

    for key, elist in exclusivities.items():
        seen, unique = set(), []
        for e in elist:
            sig = (e["code"], e["expires"])
            if sig not in seen:
                seen.add(sig)
                unique.append(e)
        unique.sort(key=lambda e: e["expires"] or "")
        exclusivities[key] = unique

    return {"patents": patents, "exclusivities": exclusivities, "products": products}
