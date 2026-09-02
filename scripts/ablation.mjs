#!/usr/bin/env tsx
/**
 * Per-detector ablation across the scenario corpus.
 *
 * Two independent strategy reviews asked for ablation studies showing what each detector
 * contributes, and nothing here measured it. The category split in the papers
 * looks like the same thing and is not: it counts the alerts each detector
 * raised, which is what it produced, not what would be lost without it.
 * Suppression is why those differ. It drops an alert subsumed by another, so a
 * detector whose output is always subsumed contributes nothing while still
 * appearing in the split, and removing a detector can let a previously
 * suppressed alert through, which the split cannot show at all.
 *
 * So each detector is removed, the rest re-run through suppression, and the
 * corpus compared alert by alert. Reported per detector:
 *
 *   lost       alerts present with the full population and absent without it
 *   revealed   alerts absent with the full population and present without it
 *   scenarios  scenarios whose top severity drops when it is removed
 *   sole       scenarios that go silent entirely without it
 *
 * `revealed` is the number that makes this worth running: a positive value
 * means the detector is masking another's output through suppression.
 *
 * Usage: ./node_modules/.bin/tsx scripts/ablation.mjs [--json]
 */
const { SCENARIOS } = await import("../src/sim/scenarios.ts");
const { runAllRules, runRulesWithout, DETECTORS } = await import(
  "../src/sim/rules.ts"
);

const RANK = { none: 0, info: 1, advisory: 2, warning: 3, critical: 4 };
const top = (alerts) =>
  alerts.reduce((acc, a) => (RANK[a.severity] > RANK[acc] ? a.severity : acc), "none");
// Compared by identifier and severity, never by position: the two lists have
// different lengths by construction, so index comparison would pair unrelated
// alerts. That mistake has been made in this repository before.
const key = (a) => `${a.category}|${a.severity}|${a.id}`;

const baseline = new Map();
for (const s of SCENARIOS) baseline.set(s.id, runAllRules(s.build()));

const rows = [];
for (const d of DETECTORS) {
  let lost = 0, revealed = 0, dropped = 0, silenced = 0;
  for (const s of SCENARIOS) {
    const before = baseline.get(s.id);
    const after = runRulesWithout(s.build(), d.category);
    const b = new Set(before.map(key));
    const a = new Set(after.map(key));
    for (const k of b) if (!a.has(k)) lost++;
    for (const k of a) if (!b.has(k)) revealed++;
    if (RANK[top(after)] < RANK[top(before)]) dropped++;
    if (before.length > 0 && after.length === 0) silenced++;
  }
  rows.push({ detector: d.category, lost, revealed, scenariosDowngraded: dropped, scenariosSilenced: silenced });
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ scenarios: SCENARIOS.length, rows }, null, 2));
} else {
  const total = [...baseline.values()].reduce((n, a) => n + a.length, 0);
  console.log(`ablation across ${SCENARIOS.length} scenarios, ${total} alerts with the full population\n`);
  console.log("detector             lost  revealed  downgraded  silenced");
  for (const r of rows.sort((x, y) => y.lost - x.lost)) {
    console.log(
      `${r.detector.padEnd(20)} ${String(r.lost).padStart(4)}  ${String(r.revealed).padStart(8)}  ` +
        `${String(r.scenariosDowngraded).padStart(10)}  ${String(r.scenariosSilenced).padStart(8)}`,
    );
  }
  // The masking column needs its own control, because zero can mean two things.
  // Suppression can only remove alerts, so `revealed` is structurally incapable
  // of being positive on a corpus where suppression removes nothing, and it
  // removes nothing here. Reporting "no detector masks another" without saying
  // that would dress a tautology as a result. The papers give the live figures:
  // 15 pre-subsumed alerts of 4,958 in one window and 1 of 8,501 in the next.
  const raw = SCENARIOS.reduce(
    (n, s) => n + DETECTORS.flatMap((d) => d.run(s.build())).length,
    0,
  );
  const suppressed = raw - total;
  const masking = rows.filter((r) => r.revealed > 0);
  if (suppressed === 0) {
    console.log(
      `\nSuppression removes 0 of ${raw} alerts across this corpus, so the ` +
        `revealed column cannot be positive and says nothing here. Ablation by ` +
        `removal equals the category split on this corpus for that reason, not ` +
        `by coincidence.`,
    );
  } else if (masking.length) {
    console.log(
      `\n${masking.length} detector(s) mask another through suppression ` +
        `(${suppressed} of ${raw} alerts suppressed): ` +
        masking.map((r) => `${r.detector} (${r.revealed})`).join(", "),
    );
  } else {
    console.log(
      `\nSuppression removes ${suppressed} of ${raw} alerts and no removal ` +
        `reveals a new one, which is a result rather than a tautology.`,
    );
  }
}
