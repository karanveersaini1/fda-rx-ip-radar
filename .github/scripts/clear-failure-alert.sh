#!/usr/bin/env bash
# Close any open etl-failure issue now that a refresh has succeeded, re-arming
# the alert for the next real break. Run by the "Clear failure alert" step of
# refresh-data.yml; expects GH_TOKEN and RUN_URL in the environment.
set -euo pipefail

today=$(date -u +%F)
for n in $(gh issue list --label etl-failure --state open \
    --json number --jq '.[].number'); do
  gh issue close "$n" \
    --comment "Refresh succeeded on ${today}; auto-closing. ${RUN_URL}"
done
