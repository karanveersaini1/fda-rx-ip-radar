# ⚖️ RxIP Radar

**FDA approval actions and their patent consequences** — a static web app that joins the FDA's
drug approval feed to the Orange Book (the Hatch-Waxman statutory bridge between FDA and the
USPTO) and renders, for every approved drug: its listed patents, when they expire, its
regulatory exclusivity periods, and the earliest window for generic competition.

Built by a life-science student headed to law school, as a working demonstration that every FDA
action has a legal architecture wrapped around it.

## What it shows

- **Approval actions by month** — new drugs (NDA), biologics (BLA), generics (ANDA), supplements
- **Patent cliff timelines** — per drug: each Orange Book patent (compound / formulation /
  method-of-use) and exclusivity period as a runway from approval to expiry
- **The biologics transparency gap** — BLAs have no Orange Book equivalent; the BPCIA "patent
  dance" is private. The app says so instead of pretending otherwise.
- **FDA in the Federal Register** — the official forward calendar: rules, notices, meetings

## Data sources (all free, all official)

| Source | What | Access |
|---|---|---|
| [openFDA](https://open.fda.gov) Drugs@FDA | approval actions | JSON API, no key |
| [FDA Orange Book](https://www.fda.gov/drugs/drug-approvals-and-databases/approved-drug-products-therapeutic-equivalence-evaluations-orange-book) | patents + exclusivities per application | monthly bulk zip |
| [Federal Register API](https://www.federalregister.gov/developers/documentation/api/v1) | FDA rules/notices | JSON API, no key |

## Architecture

```
etl/*.py  (Python, stdlib only)  →  docs/data/*.json  →  docs/ (static site, GitHub Pages)
        ↑ GitHub Actions cron, daily
```

No server, no database, no build step, no dependencies.

## Run locally

```bash
START_DATE=2026-01-01 python3 etl/run_all.py   # fetch + join data (a couple of minutes)
cd docs && python3 -m http.server 8000          # then open http://localhost:8000
```

## Deploy to GitHub Pages

1. Create a **public** GitHub repo and push this folder.
2. Repo **Settings → Pages → Source**: `Deploy from a branch`, branch `main`, folder `/docs`.
3. The site appears at `https://<username>.github.io/<repo>/` in a minute or two.
4. The included workflow (`.github/workflows/daily.yml`) refreshes the data every morning and
   commits it, which re-publishes the page automatically. Trigger it manually anytime from the
   Actions tab ("Run workflow").

## Disclaimer

Research/education project; not legal advice; not for clinical or investment decisions.
openFDA data is explicitly unvalidated.
