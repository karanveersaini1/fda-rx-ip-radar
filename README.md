# ⚖️ RxIP Radar

**Live: <https://karanveersaini1.github.io/fda-rx-ip-radar/>**

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

Requires **Python 3.10+** (the ETL uses `X | None` annotations). macOS ships 3.9, which fails
at import with `TypeError: unsupported operand type(s) for |`.

```bash
START_DATE=2026-01-01 python3 etl/run_all.py   # fetch + join data (a couple of minutes)
cd docs && python3 -m http.server 8000          # then open http://localhost:8000
```

Omit `START_DATE` for a trailing 60-day window. `END_DATE` pins the far end; both are ISO dates.

## Automated refresh

`.github/workflows/refresh-data.yml` runs daily at **07:00 UTC**: it rebuilds `docs/data/` for a
year-to-date window ending yesterday, and commits only when the output actually changed. That
push republishes the Pages site. Run it on demand from the Actions tab → *Run workflow*.

If the job fails it opens (or comments on) an issue labelled `etl-failure`, since a broken cron
is otherwise invisible. The site keeps serving the last good data, so failures make it stale
rather than broken.

## Deploy to GitHub Pages

1. Create a **public** GitHub repo and push this folder.
2. Repo **Settings → Pages → Source**: `Deploy from a branch`, branch `master`, folder `/docs`.
3. The site appears at `https://<username>.github.io/<repo>/` in a minute or two.

`docs/.nojekyll` is required — without it Jekyll processes the directory and can drop files.

## Licence

MIT — see [LICENSE](LICENSE). The underlying FDA and Federal Register data is US Government
public domain.

## Disclaimer

Research/education project; not legal advice; not for clinical or investment decisions.
openFDA data is explicitly unvalidated.
