/**
 * Prints the per-airport heading agreement computed by
 * src/sim/heading-consistency.ts. The logic lives in the module so the test
 * suite and the typecheck both see it; this file only formats.
 *
 * Run: ./node_modules/.bin/tsx scripts/heading-consistency.mjs
 */
import { headingSpread } from "../src/sim/heading-consistency";

for (const row of headingSpread().sort((a, b) => b.spread - a.spread)) {
  const detail = row.offsets
    .map((o) => `${o.id}=${o.offset.toFixed(1)}`)
    .join(" ");
  console.log(`${row.icao} spread ${row.spread.toFixed(1).padStart(5)}  ${detail}`);
}
