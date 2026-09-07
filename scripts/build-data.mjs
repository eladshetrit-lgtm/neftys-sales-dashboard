#!/usr/bin/env node
// Builds /dist from /index.html + /data/raw/*.csv
//
// Each file in data/raw/ becomes one selectable "period" in the dashboard.
// Filename convention: "<order>-<anything>.csv", e.g. "01-FY2025.csv", "02-YTD2026.csv".
//   - The numeric prefix ALWAYS controls display order (and which period is shown by default
//     — the highest number). This part is required.
//   - The label shown in the dropdown comes from (in priority order):
//       1. A "Period" column in the CSV itself, if present — e.g. put "YTD May 2026" in every
//          row's Period column and that's exactly what shows up. This is the recommended way,
//          since it survives the file being renamed and makes the period explicit in the data.
//       2. Otherwise, the rest of the filename after the number, prettified
//          ("FY2025" -> "FY 2025", "YTD-May-2026" -> "YTD May 2026").
// To add a new period later (e.g. monthly data, or a historical year for growth comparisons),
// just drop another CSV into data/raw/ with the same 12 columns and push — no code changes needed.

import { readFileSync, readdirSync, writeFileSync, mkdirSync, cpSync, statSync } from "node:fs";
import { join, dirname, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const RAW_DIR = join(ROOT, "data", "raw");
const DIST_DIR = join(ROOT, "dist");
const DIST_DATA_DIR = join(DIST_DIR, "data", "processed");

const EXPECTED_COLUMNS = [
  "EU CODE", "EU Description", "Local item code", "Product", "QTY", "Sales",
  "Product Line", "Company", "Country", "Suppliers", "PROJECT CATEGORY", "Animal Type",
];

// ─── CSV parsing (RFC4180-ish, matches the in-app "Replace CSV" parser) ─────

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length < 2) return { headers: [], rows: [] };
  function splitLine(line) {
    const fields = [];
    let cur = "", inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === "," && !inQuote) {
        fields.push(cur); cur = "";
      } else {
        cur += ch;
      }
    }
    fields.push(cur);
    return fields;
  }
  const headers = splitLine(lines[0]).map(h => h.replace(/^﻿/, "").trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const vals = splitLine(line);
    const row = {};
    headers.forEach((h, idx) => { row[h] = (vals[idx] ?? "").trim(); });
    rows.push(row);
  }
  return { headers, rows };
}

function toNum(v) {
  if (v == null) return 0;
  const s = String(v).trim().replace(/[€$£\s ]/g, "").replace(/,/g, "");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// ─── Label prettifying: "FY2025" -> "FY 2025", "YTD2026" -> "YTD 2026" ──────

function prettifyLabel(stem) {
  const m = stem.match(/^(FY|YTD|Q[1-4]|H[12])[\s_-]?(\d{4})$/i);
  if (m) return `${m[1].toUpperCase()} ${m[2]}`;
  return stem.replace(/[_-]+/g, " ").trim();
}

function slugify(label) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// ─── Optional "Period" column: lets the CSV itself say what period it is  ──
// ─── ("YTD May 2026"), instead of relying on the filename.                ──

const PERIOD_COLUMN_ALIASES = ["period", "reporting period", "period label"];

function findPeriodColumn(headers) {
  return headers.find(h => PERIOD_COLUMN_ALIASES.includes(h.trim().toLowerCase())) || null;
}

function extractPeriodLabel(rawRows, periodColumn, file) {
  if (!periodColumn) return null;
  const counts = {};
  for (const row of rawRows) {
    const v = String(row[periodColumn] ?? "").trim();
    if (!v) continue;
    counts[v] = (counts[v] || 0) + 1;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return null;
  if (entries.length > 1) {
    console.warn(`⚠ ${file}: the "${periodColumn}" column has more than one value (${entries.map(([v, c]) => `"${v}" ×${c}`).join(", ")}) — using the most common: "${entries[0][0]}".`);
  }
  return entries[0][0];
}

// ─── Known misspellings in the source data — fixed automatically for every ─
// ─── period, past and future, so nobody has to hand-edit CSVs. Add more   ─
// ─── entries here (lowercased key -> corrected display value) as they turn up. ─

const KNOWN_CORRECTIONS = {
  "PROJECT CATEGORY": {
    "accssesories": "Accessories",
    "accssories": "Accessories",
  },
};

// ─── Canonical casing map, built across ALL periods so the same value  ─────
// ─── (e.g. "POLAND" / "Poland") always renders identically everywhere. ─────

const canonical = {}; // field -> lowercased value -> chosen display casing
const CASE_NORMALIZED_FIELDS = ["Country", "Company", "Suppliers", "Product Line", "PROJECT CATEGORY", "Animal Type"];

function canonicalize(field, raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return trimmed;
  if (!CASE_NORMALIZED_FIELDS.includes(field)) return trimmed;
  const key = trimmed.toLowerCase();
  const corrected = KNOWN_CORRECTIONS[field]?.[key];
  if (corrected) return corrected;
  canonical[field] ??= {};
  if (!canonical[field][key]) canonical[field][key] = trimmed;
  return canonical[field][key];
}

function normalizeRow(row) {
  const out = {};
  for (const col of EXPECTED_COLUMNS) {
    const raw = row[col];
    if (col === "QTY" || col === "Sales") {
      out[col] = toNum(raw);
    } else {
      out[col] = canonicalize(col, raw);
    }
  }
  return out;
}

// ─── Main build ──────────────────────────────────────────────────────────

function main() {
  mkdirSync(DIST_DATA_DIR, { recursive: true });

  const files = readdirSync(RAW_DIR)
    .filter(f => f.toLowerCase().endsWith(".csv"))
    .sort(); // numeric prefix in the filename drives order

  if (files.length === 0) {
    console.error(`No CSV files found in ${RAW_DIR}`);
    process.exit(1);
  }

  const periods = [];
  const usedSlugs = new Set();

  for (const file of files) {
    const fullPath = join(RAW_DIR, file);
    // Source CSVs may arrive as latin1/cp1252 (Excel exports); latin1 decoding
    // never throws and matches the in-app CSV-replace behaviour.
    const text = readFileSync(fullPath, "latin1");
    const { headers, rows: rawRows } = parseCSV(text);

    const missing = EXPECTED_COLUMNS.filter(c => !headers.includes(c));
    if (missing.length) {
      console.warn(`⚠ ${file}: missing expected column(s): ${missing.join(", ")} — those fields will be blank/0 for this period.`);
    }

    const rows = rawRows.map(normalizeRow);
    const totalSales = rows.reduce((a, r) => a + r.Sales, 0);
    const totalQty = rows.reduce((a, r) => a + r.QTY, 0);
    const companies = new Set(rows.map(r => r.Company).filter(Boolean));
    const countries = new Set(rows.map(r => r.Country).filter(Boolean));

    const stem = basename(file, extname(file));
    const m = stem.match(/^(\d+)[-_]?(.*)$/);
    if (!m) {
      console.error(`✗ ${file}: filename must start with a number to control ordering, e.g. "03-${file}". Skipping.`);
      continue;
    }
    const order = parseInt(m[1], 10);
    const rawLabel = m[2] || stem;

    const periodColumn = findPeriodColumn(headers);
    const periodColumnLabel = extractPeriodLabel(rawRows, periodColumn, file);
    const label = periodColumnLabel || prettifyLabel(rawLabel);
    let slug = slugify(label) || `period-${order}`;
    if (usedSlugs.has(slug)) {
      console.warn(`⚠ ${file}: period label "${label}" collides with an earlier file — disambiguating using the order number.`);
      slug = `${slug}-${order}`;
    }
    usedSlugs.add(slug);

    writeFileSync(join(DIST_DATA_DIR, `${slug}.json`), JSON.stringify(rows));

    periods.push({
      id: slug,
      label,
      file: `data/processed/${slug}.json`,
      order,
      sourceFile: file,
      rows: rows.length,
      totalSales,
      totalQty,
      companies: companies.size,
      countries: countries.size,
      generatedAt: new Date().toISOString(),
    });

    console.log(`✓ ${file} → ${label}: ${rows.length.toLocaleString()} rows, €${Math.round(totalSales).toLocaleString()} total sales`);
  }

  periods.sort((a, b) => a.order - b.order);
  const defaultPeriodId = periods[periods.length - 1].id; // highest numeric prefix = default

  writeFileSync(
    join(DIST_DATA_DIR, "index.json"),
    JSON.stringify({ periods, defaultPeriodId, generatedAt: new Date().toISOString() }, null, 2)
  );

  // Copy the static app shell into dist/
  cpSync(join(ROOT, "index.html"), join(DIST_DIR, "index.html"));

  console.log(`\nBuilt ${periods.length} period(s) into ${DIST_DIR}`);
  console.log(`Default period: ${defaultPeriodId}`);
}

main();
