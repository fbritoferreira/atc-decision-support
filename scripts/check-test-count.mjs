#!/usr/bin/env node
/**
 * Assert that TOTAL_TESTS in sim.test.ts equals the number of tests the suite
 * actually runs.
 *
 * Why this is a separate process: the count cannot be measured from inside the
 * suite it counts without recursion, so sim.test.ts holds a hand-maintained
 * constant and passes it to verify-paper-claims.mjs, which checks the papers
 * against it. Every published test count therefore rests on that constant being
 * right, and until 2026-08-29 nothing checked it. The comment above it claimed
 * it was "asserted against the suite's own reported total in CI"; no such
 * assertion existed anywhere. Forget to bump it after adding a test and the
 * checker confirms the papers against a stale number, reporting no problem.
 *
 * Usage (from apps/atc):
 *   ./node_modules/.bin/tsx scripts/check-test-count.mjs
 *
 * Runs the suite once more with the JSON reporter. That is the cost of not
 * being able to ask a suite how big it is from within it.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const source = readFileSync(`${APP_DIR}/src/sim/sim.test.ts`, "utf8");
const declared = Number.parseInt(
  (source.match(/^const TOTAL_TESTS = (\d+);/m) ?? [])[1] ?? "",
  10,
);
if (!Number.isFinite(declared)) {
  console.error("no TOTAL_TESTS declaration found in src/sim/sim.test.ts");
  process.exit(2);
}

const run = spawnSync(
  "./node_modules/.bin/vitest",
  ["run", "--reporter=json", "--silent"],
  { cwd: APP_DIR, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
// The JSON reporter writes the report to stdout preceded by nothing, but a
// failing suite still exits non-zero with a valid report, and that is a
// different failure from this one. Report it as itself.
const start = run.stdout.indexOf("{");
if (start === -1) {
  console.error("vitest produced no JSON report");
  console.error(run.stderr.slice(-800));
  process.exit(2);
}
const report = JSON.parse(run.stdout.slice(start));
const actual = report.numTotalTests;

// Skipped tests count toward the total and not toward passed. The Table 1 check
// skips when the sibling repository is absent, so comparing against passed
// would fail on a clean checkout for a reason that is not a stale count.
console.log(
  `TOTAL_TESTS says ${declared}; the suite runs ${actual} ` +
    `(${report.numPassedTests} passed, ${report.numPendingTests} skipped, ` +
    `${report.numFailedTests} failed)`,
);
if (declared !== actual) {
  console.error(
    `MISMATCH: bump TOTAL_TESTS to ${actual} and re-run the claim checker, ` +
      "which quotes it to the papers.",
  );
  process.exit(1);
}
