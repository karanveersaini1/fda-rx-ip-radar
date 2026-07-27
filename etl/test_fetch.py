"""Tests for common.fetch's validate/retry path. Stdlib unittest only.

Covers the fix for fda.gov's Akamai edge returning an HTML bot-check page with
HTTP 200 where a zip was expected: a body that fails `validate` is retried like
a transient error rather than crashing the ETL.
"""

import io
import sys
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common


class _Resp:
    """Minimal stand-in for the urlopen context manager."""

    def __init__(self, body: bytes):
        self._body = body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self) -> bytes:
        return self._body


def _valid_zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("patent.txt", "hi")
    return buf.getvalue()


def _is_zip(body: bytes) -> bool:
    return zipfile.is_zipfile(io.BytesIO(body))


class FetchValidate(unittest.TestCase):
    def _patched(self, bodies):
        """Patch urlopen to return each body in turn (last repeats), no sleep."""
        state = {"i": 0}

        def fake_urlopen(req, timeout=None):
            body = bodies[min(state["i"], len(bodies) - 1)]
            state["i"] += 1
            return _Resp(body)

        return state, patch.object(common.urllib.request, "urlopen", fake_urlopen), \
            patch.object(common.time, "sleep", lambda _s: None)

    def test_retries_past_a_non_zip_body(self):
        good = _valid_zip()
        state, urlopen_p, sleep_p = self._patched([b"<html>bot check</html>", good])
        with urlopen_p, sleep_p:
            out = common.fetch("http://x", validate=_is_zip)
        self.assertEqual(out, good)
        self.assertEqual(state["i"], 2)  # took exactly one retry

    def test_raises_when_body_never_valid(self):
        state, urlopen_p, sleep_p = self._patched([b"<html>nope</html>"])
        with urlopen_p, sleep_p:
            with self.assertRaises(RuntimeError):
                common.fetch("http://x", retries=3, validate=_is_zip)
        self.assertEqual(state["i"], 3)  # exhausted all attempts

    def test_no_validator_returns_body_unchecked(self):
        state, urlopen_p, sleep_p = self._patched([b"anything"])
        with urlopen_p, sleep_p:
            self.assertEqual(common.fetch("http://x"), b"anything")
        self.assertEqual(state["i"], 1)  # no retry without a validator


if __name__ == "__main__":
    sys.exit(unittest.main())
