"""Tests for the recovery auto-close step (.github/scripts/clear-failure-alert.sh).

Runs the real script with a stubbed `gh` on PATH so we exercise the shipped
shell, not a copy of it. Stdlib unittest only — no pip installs.
"""

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / ".github" / "scripts" / "clear-failure-alert.sh"

# A `gh` stub: `issue list ...` prints the numbers in $FAKE_OPEN_ISSUES (one per
# line, none if empty); `issue close <n> ...` records the close to $FAKE_GH_LOG.
GH_STUB = """#!/usr/bin/env bash
if [ "$1 $2" = "issue list" ]; then
  if [ -n "${FAKE_OPEN_ISSUES:-}" ]; then printf '%s\\n' $FAKE_OPEN_ISSUES; fi
elif [ "$1 $2" = "issue close" ]; then
  echo "close $3" >> "$FAKE_GH_LOG"
fi
"""


class ClearFailureAlert(unittest.TestCase):
    def _run(self, open_issues: str) -> list[str]:
        """Run the script with a stubbed gh; return the list of closed issue #s."""
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            gh = tmp / "gh"
            gh.write_text(GH_STUB)
            gh.chmod(0o755)
            log = tmp / "gh.log"

            env = {
                **os.environ,
                "PATH": f"{tmp}{os.pathsep}{os.environ['PATH']}",
                "FAKE_OPEN_ISSUES": open_issues,
                "FAKE_GH_LOG": str(log),
                "GH_TOKEN": "test-token",
                "RUN_URL": "https://example.test/run/1",
            }
            subprocess.run(["bash", str(SCRIPT)], env=env, check=True)
            if not log.exists():
                return []
            return [ln.split()[1] for ln in log.read_text().splitlines() if ln.strip()]

    def test_closes_every_open_issue(self):
        # Two open etl-failure issues on recovery -> both get closed.
        self.assertEqual(self._run("3 7"), ["3", "7"])

    def test_no_open_issues_is_a_noop(self):
        # Nothing open (the normal steady state) -> no close calls, clean exit.
        self.assertEqual(self._run(""), [])


if __name__ == "__main__":
    sys.exit(unittest.main())
