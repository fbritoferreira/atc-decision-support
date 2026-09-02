/**
 * Inventories the sentences that make an absolute claim, and pins the set.
 *
 * Why this exists. The claim checker verifies numbers. On 2026-09-01 an audit of
 * the sentences making absolute claims found three false ones that no numeric
 * check could ever have caught: the fuel doctrine recorded in three places as
 * unable to fire on live data, when it fires; a premise removed a week earlier
 * still cited in five places as the current reason for a conclusion; and a
 * divergence between the two implementations blamed on a threshold difference
 * where the thresholds are identical. Each had been read past many times.
 *
 * What this does and does not do. It cannot tell whether a claim is true. It
 * tells you which claims exist and, run against the pinned file, which are new
 * since the last audit. A new absolute claim is the one most likely to be
 * unverified, because the older ones have at least been read in context.
 *
 * Usage:
 *   tsx scripts/absolute-claims.mjs           # rewrite the pinned inventory
 *   tsx scripts/absolute-claims.mjs --check   # exit non-zero if the set moved
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PINNED = resolve(APP_DIR, "docs/absolute-claims.txt");

const SOURCES = [
  "src/sim/rules.ts",
  "src/sim/rules-baseline.ts",
  "src/sim/predict.ts",
  "src/sim/live-adsb.ts",
  "src/sim/live-store.ts",
  "src/sim/live-weather.ts",
  "src/sim/smoothing.ts",
  "src/sim/engine.ts",
  "../web/src/papers/atc-decision-support.md",
];

// The long-form paper lives in a separate checkout beside this one, and its
// directory name is not recorded here because this repository is public and
// that one is not. Found by looking for the paper in each sibling directory;
// when it is absent the inventory simply covers one paper fewer and says so.
const siblingPaper = (() => {
  const parent = resolve(APP_DIR, "../../..");
  try {
    for (const entry of readdirSync(parent)) {
      const candidate = resolve(parent, entry, "atc_whitepaper.md");
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    // nothing to search
  }
  return null;
})();
if (siblingPaper) SOURCES.push(siblingPaper);

// "cannot" alone is too broad: the papers use it constantly for genuine limits
// ("ADS-B cannot carry a clearance"), which are disclosures rather than claims
// about this system's behaviour. These are the forms that assert the system
// does or does not do something, which is what turned out to be wrong.
const PATTERNS =
  /\b(by construction|provably|cannot fire|can never|never fires|never escalat|is impossible|guarantees that|structurally dead|unreachable)\b/i;

const claims = [];
for (const rel of SOURCES) {
  const file = resolve(APP_DIR, rel);
  if (!existsSync(file)) continue;
  const text = readFileSync(file, "utf8");
  for (const raw of text.split(/(?<=[.!?])\s+|\n\n/)) {
    const line = raw.replace(/\s+/g, " ").replace(/^[\s*/#|>-]+/, "").trim();
    if (line.length < 25 || line.length > 400) continue;
    if (!PATTERNS.test(line)) continue;
    // The sibling paper is labelled by what it is rather than by where it is.
    // A relative path would rebuild the private checkout's directory name in a
    // file this public repository commits, which is the thing the discovery
    // above exists to avoid.
    const label =
      file === siblingPaper ? "the long-form paper" : relative(APP_DIR, file);
    claims.push(`${label}: ${line}`);
  }
}
claims.sort();

const body = `${claims.length} absolute claims, pinned. Regenerate with scripts/absolute-claims.mjs.\n\n${claims.join("\n")}\n`;

if (process.argv.includes("--check")) {
  if (!existsSync(PINNED)) {
    console.log("absolute claims: no pinned inventory; run without --check");
    process.exit(1);
  }
  const was = readFileSync(PINNED, "utf8");
  if (was === body) {
    console.log(`absolute claims: unchanged (${claims.length})`);
    process.exit(0);
  }
  // The count line changes whenever anything else does, so it is dropped from
  // the diff: reporting it as an addition and a removal buried the one line
  // that matters behind two that never do.
  const isClaim = (l) => l.trim() && l.includes(": ");
  const before = new Set(was.split("\n").filter(isClaim));
  const after = new Set(body.split("\n").filter(isClaim));
  const added = [...after].filter((l) => !before.has(l));
  const removed = [...before].filter((l) => !after.has(l));
  console.log(`absolute claims: the set moved, ${added.length} added, ${removed.length} removed`);
  for (const l of added.slice(0, 8)) console.log(`  + ${l.slice(0, 150)}`);
  for (const l of removed.slice(0, 4)) console.log(`  - ${l.slice(0, 150)}`);
  console.log("  each addition is a claim nothing has verified; read it, then re-pin");
  process.exit(1);
}

writeFileSync(PINNED, body);
console.log(`absolute claims: pinned ${claims.length} from ${SOURCES.length} source(s)`);
