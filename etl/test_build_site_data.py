"""Tests for build_site_data. Stdlib unittest only — no pip installs.

Run from the repo root:  python -m unittest discover etl
Or directly:             python etl/test_build_site_data.py
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import build_site_data
from build_site_data import build

EMPTY_OB = {"patents": {}, "exclusivities": {}, "products": {}}


def a_record() -> dict:
    """A minimal in-window approval, enough for build()/categorize() to run."""
    return {
        "app": "NDA020610",
        "events": [{"type": "ORIG", "date": "2026-03-01"}],
        "brands": [],
        "generics": [],
    }


class EmptyDatasetGuard(unittest.TestCase):
    """The guard refuses to write an empty dataset over a multi-week window, so
    a silent openFDA outage can't blank the site — see build_site_data.build."""

    def test_empty_over_wide_window_raises_and_writes_nothing(self):
        # Year-to-date window with zero approvals: a source failure, not a real
        # result. Must raise *before* any file is written.
        with patch.object(build_site_data, "write_json") as write_json:
            with self.assertRaises(RuntimeError):
                build([], {"start": "2026-01-01", "end": "2026-07-26"}, EMPTY_OB, [])
            write_json.assert_not_called()

    def test_empty_over_narrow_window_is_allowed(self):
        # A narrow manual window can legitimately have no approvals — allow it,
        # writing all three site files.
        with patch.object(build_site_data, "write_json") as write_json:
            meta = build([], {"start": "2026-07-20", "end": "2026-07-26"}, EMPTY_OB, [])
        self.assertEqual(meta["stats"]["total_applications"], 0)
        self.assertEqual(write_json.call_count, 3)

    def test_boundary_exactly_14_days_is_allowed(self):
        # The guard trips on span > 14 days; exactly 14 must pass.
        with patch.object(build_site_data, "write_json"):
            build([], {"start": "2026-07-12", "end": "2026-07-26"}, EMPTY_OB, [])

    def test_boundary_15_days_raises(self):
        with patch.object(build_site_data, "write_json"):
            with self.assertRaises(RuntimeError):
                build([], {"start": "2026-07-11", "end": "2026-07-26"}, EMPTY_OB, [])

    def test_nonempty_over_wide_window_is_allowed(self):
        # Real data over a wide window is the normal path — must not trip.
        with patch.object(build_site_data, "write_json") as write_json:
            meta = build([a_record()], {"start": "2026-01-01", "end": "2026-07-26"}, EMPTY_OB, [])
        self.assertEqual(meta["stats"]["total_applications"], 1)
        self.assertEqual(write_json.call_count, 3)


if __name__ == "__main__":
    unittest.main()
