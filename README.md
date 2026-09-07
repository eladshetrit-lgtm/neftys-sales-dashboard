# Neftys Sales Dashboard

Live site: https://eladshetrit-lgtm.github.io/neftys-sales-dashboard/

A self-contained sales dashboard (React, no backend) that reads its data from
small JSON files generated automatically from CSV files you drop into this repo.

## How to update the data

1. Go to the [`data/raw`](data/raw) folder on GitHub.
2. Click **Add file → Upload files**, and upload your new/replacement CSV.
   - The CSV must have these 12 columns (same as before): `EU CODE, EU Description,
     Local item code, Product, QTY, Sales, Product Line, Company, Country,
     Suppliers, PROJECT CATEGORY, Animal Type`.
   - **Add a 13th column called `Period`**, filled with the exact label you want
     shown in the dashboard's dropdown for every row — e.g. `YTD May 2026`,
     `YTD June 2026`, `FY 2025`. This is the recommended way to control the
     label: it lives in the data itself, so it's correct no matter what the
     file gets renamed to. (If you skip this column, the label falls back to
     the filename instead — see below.)
   - Name the file `<order>-<anything>.csv`, e.g. `01-FY2025.csv`,
     `02-YTD2026.csv`, `03-YTD-Jun-2026.csv`. **The leading number is required**
     — it controls the order in the dropdown, and the highest number is shown
     by default when the site loads. The rest of the filename only matters if
     you didn't add a `Period` column (in which case it becomes the label,
     prettified — `YTD-Jun-2026` → "YTD Jun 2026").
   - To **replace** a period's data, just re-upload a file with the exact same
     name — GitHub will ask to overwrite it.
   - To **add** a new period (e.g. next month's YTD, or a prior year for
     comparison), upload a new file with a new number and `Period` value.
     No code changes needed.
3. Commit directly to the `main` branch.
4. Wait about a minute — GitHub Actions rebuilds the dashboard and republishes it
   automatically. You can watch progress under the **Actions** tab.

That's it — there's nothing to install and no script to run by hand.

## How it works

- `data/raw/*.csv` — the source files you upload (kept as-is, for a full history).
- `scripts/build-data.mjs` — converts each CSV into a cleaned, normalized JSON file
  (fixes inconsistent capitalization like "POLAND" vs "Poland") and writes
  `data/processed/index.json` listing all available periods.
- `index.html` — the dashboard itself. On load it fetches `data/processed/index.json`
  to find out which periods exist, then loads the selected one.
- `.github/workflows/deploy.yml` — runs the build on every push to `main` and
  publishes the result to GitHub Pages.

The dashboard also has a **"Quick preview CSV"** button for looking at a one-off
file in your browser without publishing it — that data is never saved anywhere;
refreshing the page brings back the published data.

## Local development (optional)

```
node scripts/build-data.mjs   # writes ./dist
cd dist && python3 -m http.server 8000
```

## Adding a "Period" column to an old CSV (one-off)

If you have an existing CSV without a `Period` column, `scripts/add-period-column.mjs`
adds one for you (every row gets the same label):

```
node scripts/add-period-column.mjs data/raw/02-YTD2026.csv "YTD May 2026"
```

This was already run for the initial FY2025 and YTD2026 files in this repo.
