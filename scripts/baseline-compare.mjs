#!/usr/bin/env node
// Section 6.9 baseline comparison, measured rather than asserted.
//
// Runs the orchestrated detector population (runAllRules), the predictive
// wrapper the live surface actually uses (runPredictiveRules), and the
// monolithic baseline (runBaselineRules) over every scenario in the corpus,
// and reports alerts by severity and category for each.
//
// This exists because §6.9's claims about suppression behaviour, projection
// de-duplication, and per-scenario alert counts were previously stated without
// a reproducible measurement backing them.
//
// Usage:
//   ./node_modules/.bin/tsx scripts/baseline-compare.mjs
//   ./node_modules/.bin/tsx scripts/baseline-compare.mjs --scenario=incident-tenerife-1977
//   ./node_modules/.bin/tsx scripts/baseline-compare.mjs --markdown

import { argv } from "node:process";

const args = Object.fromEntries(
  argv
    .slice(2)
    .map((a) => a.replace(/^--/, "").split("="))
    .map(([k, v]) => [k, v ?? "true"]),
);

const { SCENARIOS } = await import("../src/sim/scenarios.ts");
const { runAllRules } = await import("../src/sim/rules.ts");
const { runBaselineRules } = await import("../src/sim/rules-baseline.ts");
const { runPredictiveRules } = await import("../src/sim/predict.ts");

const DECLARED_CATEGORIES = [
  "runway-conflict",
  "wake-spacing",
  "gate-conflict",
  "fuel-hold",
  "crosswind",
  "weather-shift",
  "cascading-delay",
  "proximity-conflict",
  "runway-surface",
  "runway-identity",
  "squawk-emergency",
];

const tally = (alerts) => {
  const sev = { critical: 0, warning: 0, advisory: 0, info: 0 };
  const cat = {};
  for (const a of alerts) {
    sev[a.severity] = (sev[a.severity] ?? 0) + 1;
    cat[a.category] = (cat[a.category] ?? 0) + 1;
  }
  return { n: alerts.length, sev, cat };
};

const fmtCat = (cat) =>
  Object.entries(cat)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}×${v}`)
    .join(" ") || "—";

const scenarios = args.scenario && args.scenario !== "true"
  ? SCENARIOS.filter((s) => s.id === args.scenario)
  : SCENARIOS;

if (scenarios.length === 0) {
  console.error(`No scenario matched. Known ids:\n  ${SCENARIOS.map((s) => s.id).join("\n  ")}`);
  process.exit(1);
}

const rows = [];
const seenCategories = new Set();

for (const scenario of scenarios) {
  // Scenario state as the app loads it. `state` is the SimState the picker installs.
  const state = scenario.state ?? scenario.build?.() ?? scenario;
  const orchestrated = tally(runAllRules(state));
  const predictive = tally(runPredictiveRules(state));
  const baseline = tally(runBaselineRules(state));

  for (const k of Object.keys(orchestrated.cat)) seenCategories.add(k);
  for (const k of Object.keys(baseline.cat)) seenCategories.add(k);

  rows.push({ id: scenario.id, orchestrated, predictive, baseline });
}

if (args.markdown) {
  console.log("| Scenario | Monolith | Orchestrated | Orchestrated + projections |");
  console.log("| --- | --- | --- | --- |");
  for (const r of rows) {
    console.log(
      `| \`${r.id}\` | ${r.baseline.n} | ${r.orchestrated.n} | ${r.predictive.n} |`,
    );
  }
} else {
  for (const r of rows) {
    console.log(`\n${r.id}`);
    console.log(`  monolithic baseline      n=${String(r.baseline.n).padStart(3)}  ` +
      `crit=${r.baseline.sev.critical} warn=${r.baseline.sev.warning} adv=${r.baseline.sev.advisory}  ${fmtCat(r.baseline.cat)}`);
    console.log(`  orchestrated (runAllRules) n=${String(r.orchestrated.n).padStart(3)}  ` +
      `crit=${r.orchestrated.sev.critical} warn=${r.orchestrated.sev.warning} adv=${r.orchestrated.sev.advisory}  ${fmtCat(r.orchestrated.cat)}`);
    console.log(`  orchestrated + projections n=${String(r.predictive.n).padStart(3)}  ` +
      `crit=${r.predictive.sev.critical} warn=${r.predictive.sev.warning} adv=${r.predictive.sev.advisory}  ${fmtCat(r.predictive.cat)}`);
  }
}

// --- corpus-level checks the thesis asserts ---------------------------------
console.log("\n=== declared-vs-emitted category coverage ===");
for (const c of DECLARED_CATEGORIES) {
  console.log(`  ${c.padEnd(20)} ${seenCategories.has(c) ? "emitted" : "NEVER EMITTED across corpus"}`);
}

const negative = rows.find((r) => r.id === "negative-control-asrs");
if (negative) {
  console.log("\n=== §6.8 negative-control assertion ===");
  const crit = negative.predictive.sev.critical;
  console.log(
    `  negative-control-asrs critical alerts: ${crit} → ${crit === 0 ? "PASS (no critical on a safe resolution)" : "FAIL (asserted zero)"}`,
  );
}
