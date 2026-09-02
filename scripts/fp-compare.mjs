#!/usr/bin/env node
// Before/after comparison of two fp-analysis CSVs.
//
// The tuning loop's reporting step: given a baseline window and a
// post-change window for the same airport, print the deltas that decide
// whether the change worked — alerts per snapshot, critical rate, silent
// share, category volumes, and the critical crosstab where both files carry
// it. Rates are per-snapshot throughout, because the two windows rarely hold
// the same number of snapshots (upstream latency stretches cadence
// differently on different days).
//
// Usage:
//   node scripts/fp-compare.mjs baseline.csv tuned.csv [labelA] [labelB]

import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";

const [fileA, fileB, labelA = "baseline", labelB = "tuned"] = argv.slice(2);
if (!fileA || !fileB) {
  console.error("usage: fp-compare.mjs <baseline.csv> <tuned.csv> [labelA] [labelB]");
  exit(1);
}

const parse = (path) => {
  const lines = readFileSync(path, "utf8").trim().split("\n");
  const header = lines[0].split(",");
  return lines.slice(1).map((l) => {
    const cells = l.split(",");
    return Object.fromEntries(header.map((h, i) => [h, cells[i]]));
  });
};

const summarize = (rows) => {
  const n = rows.length;
  const num = (r, k) => Number(r[k] ?? 0);
  const sum = (k) => rows.reduce((t, r) => t + num(r, k), 0);
  const keys = Object.keys(rows[0] ?? {});
  const cats = keys.filter((k) => /^n_[a-z_]+$/.test(k) && !k.startsWith("n_crit_"))
    .filter((k) => !["n_flights", "n_contacts", "n_alerts_total", "n_active", "n_suppressed",
      "n_lookahead", "n_critical", "n_warning", "n_advisory", "n_info"].includes(k));
  const crits = keys.filter((k) => k.startsWith("n_crit_"));
  return {
    n,
    span: [(rows[0] ?? {}).timestamp_utc, (rows[n - 1] ?? {}).timestamp_utc],
    perSnap: sum("n_alerts_total") / n,
    critPerSnap: sum("n_critical") / n,
    silent: rows.filter((r) => r.n_alerts_total === "0").length / n,
    flights: sum("n_flights") / n,
    cats: Object.fromEntries(cats.map((k) => [k.slice(2), sum(k) / n])),
    crits: Object.fromEntries(crits.map((k) => [k.slice(7), sum(k)])),
    critTotal: sum("n_critical"),
  };
};

const a = summarize(parse(fileA));
const b = summarize(parse(fileB));

const pct = (x, y) => (x === 0 ? (y === 0 ? "0%" : "new") : `${(((y - x) / x) * 100).toFixed(0)}%`);
const row = (name, x, y, digits = 2) =>
  console.log(`  ${name.padEnd(24)} ${x.toFixed(digits).padStart(8)} ${y.toFixed(digits).padStart(8)} ${pct(x, y).padStart(8)}`);

console.log(`\n${labelA}: ${a.n} snapshots (${a.span[0]} -> ${a.span[1]})`);
console.log(`${labelB}: ${b.n} snapshots (${b.span[0]} -> ${b.span[1]})`);
console.log(`\n  ${"metric".padEnd(24)} ${labelA.padStart(8)} ${labelB.padStart(8)} ${"delta".padStart(8)}`);
row("alerts/snapshot", a.perSnap, b.perSnap);
row("critical/snapshot", a.critPerSnap, b.critPerSnap, 3);
row("silent share", a.silent, b.silent);
row("flights/snapshot", a.flights, b.flights, 1);

console.log("\n  per-snapshot volume by category:");
for (const k of new Set([...Object.keys(a.cats), ...Object.keys(b.cats)])) {
  const x = a.cats[k] ?? 0;
  const y = b.cats[k] ?? 0;
  if (x > 0.001 || y > 0.001) row(k, x, y, 3);
}

if (Object.keys(a.crits).length && Object.keys(b.crits).length) {
  console.log("\n  critical crosstab (window totals):");
  for (const k of new Set([...Object.keys(a.crits), ...Object.keys(b.crits)])) {
    const x = a.crits[k] ?? 0;
    const y = b.crits[k] ?? 0;
    if (x || y) console.log(`  ${k.padEnd(24)} ${String(x).padStart(8)} ${String(y).padStart(8)} ${pct(x, y).padStart(8)}`);
  }
} else {
  console.log(`\n  crosstab: ${Object.keys(a.crits).length ? labelB : labelA} lacks n_crit_ columns; totals only (baseline predates the crosstab harness).`);
  console.log(`  critical totals       ${String(a.critTotal).padStart(8)} ${String(b.critTotal).padStart(8)}`);
}
