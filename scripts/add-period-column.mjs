#!/usr/bin/env node
// One-off helper: adds a "Period" column (constant value) to an existing raw CSV,
// using proper quote-aware CSV parsing/writing so it's safe even if fields contain
// commas, quotes, or embedded newlines.
//
// Usage: node add-period-column.mjs <path-to-csv> "<Period label>"

import { readFileSync, writeFileSync } from "node:fs";

const [, , filePath, periodLabel] = process.argv;
if (!filePath || !periodLabel) {
  console.error('Usage: node add-period-column.mjs <path-to-csv> "<Period label>"');
  process.exit(1);
}

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
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
    if (!lines[i].trim()) continue;
    rows.push(splitLine(lines[i]));
  }
  return { headers, rows };
}

function csvEscape(v) {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

const text = readFileSync(filePath, "latin1");
const { headers, rows } = parseCSV(text);

if (headers.some(h => h.trim().toLowerCase() === "period")) {
  console.error(`"${filePath}" already has a Period column — not touching it.`);
  process.exit(1);
}

const outHeaders = [...headers, "Period"];
const outLines = [outHeaders.map(csvEscape).join(",")];
for (const row of rows) {
  outLines.push([...row, periodLabel].map(csvEscape).join(","));
}

writeFileSync(filePath, outLines.join("\n") + "\n", "latin1");
console.log(`✓ Added Period="${periodLabel}" to ${rows.length.toLocaleString()} rows in ${filePath}`);
