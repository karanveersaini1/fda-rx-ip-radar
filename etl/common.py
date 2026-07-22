"""Shared helpers for RxIP Radar ETL scripts. Stdlib only — no pip installs."""

import json
import time
import urllib.error
import urllib.request
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "docs" / "data"

# fda.gov sits behind Akamai bot detection, which reads a request carrying no
# Accept header as automated traffic and 302s it to an "abuse detection" page
# that 404s. urllib sends no Accept by default, so we set one explicitly.
# Keep the honest project User-Agent: a spoofed browser UA is *also* rejected.
HEADERS = {
    "User-Agent": "RxIP-Radar/0.1 (educational research project)",
    "Accept": "*/*",
}


def _worth_retrying(err: Exception) -> bool:
    """Retry transient failures only. A 404 or 403 returns the same answer on
    every attempt, so retrying it just delays a build failure by the backoff."""
    if isinstance(err, urllib.error.HTTPError):
        return err.code == 429 or err.code >= 500
    return True


def fetch(url: str, retries: int = 3, timeout: int = 90) -> bytes:
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except (urllib.error.URLError, TimeoutError, ConnectionError) as err:
            last_err = err
            if not _worth_retrying(err) or attempt == retries - 1:
                break
            time.sleep(2**attempt)
    raise RuntimeError(f"Failed to fetch {url}: {last_err}")


def fetch_json(url: str, **kwargs) -> dict:
    return json.loads(fetch(url, **kwargs))


def write_json(name: str, payload) -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    out = DATA_DIR / name
    out.write_text(json.dumps(payload, indent=1, ensure_ascii=False))
    return out


def ob_date_to_iso(text: str) -> str | None:
    """Orange Book dates look like 'Aug 24, 2026'."""
    text = text.strip()
    if not text:
        return None
    try:
        return datetime.strptime(text, "%b %d, %Y").date().isoformat()
    except ValueError:
        return None


def yyyymmdd_to_iso(text: str) -> str | None:
    text = (text or "").strip()
    if len(text) != 8 or not text.isdigit():
        return None
    return f"{text[:4]}-{text[4:6]}-{text[6:]}"


def today() -> date:
    return date.today()
