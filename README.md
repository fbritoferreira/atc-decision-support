# ATC Decision-Support Prototype

A research prototype exploring whether air traffic control conflict alerting can be built from a population of small, independent, deterministic detectors rather than a single monolithic rule function. It ships a browser application that runs twenty-eight scenarios: nine reconstruct publicly documented aviation incidents, eight as detection shape checks and one, American 11 in 2001, as a documented blind spot the population is asserted NOT to see. An eleven-scenario negative-control corpus covers events that resolved safely. A live mode ingests ADS-B and METAR for seventeen airports, ten US and seven international.

This is not certified software and is not usable for operational air traffic control. Read the limitations below before drawing conclusions from anything it prints.

## The paper this supports

A manuscript describing this architecture and its measurements is under review at
the Journal of Open Aviation Science as a software article, submitted 2026-09-02.
Under review means exactly that: not accepted, not published, and not peer
reviewed yet.

The sampling windows behind every measured figure are archived separately at
`github.com/fbritoferreira/atc-joas-paper`, which is the paper's open-data
target. They are not committed here, so the analyses in `scripts/` run against a
window sampled locally unless you fetch them.

A longer write-up, the version this repository was extracted from, is at
`fbritoferreira.com/research/atc-decision-support/`, and a live deployment of the
prototype is at `atc.fbritoferreira.com`. The deployment's live traffic mode
depends on public ADS-B feeds that decline requests from its hosting provider's
address range; when that happens the interface says so rather than showing a
stale picture.

This section exists because the artifact had no pointer to the work it belongs
to. A reviewer who clones a software article's repository should not have to
search for the article.

## What it is

The architecture under study is a population of eleven detector functions with a shared contract, `SimState -> Alert[]`. Each is pure: no clock, no I/O, no shared mutable state. An orchestrator runs them over the current traffic picture and over projections at one, two and three minutes ahead, de-duplicates the results, and sorts by severity.

Determinism is the design constraint. The same traffic picture produces the same alerts every time, which is what makes the behaviour reviewable at all: a scenario can be loaded, inspected, and disagreed with.

A monolithic implementation of the same doctrinal rules is included at `src/sim/rules-baseline.ts` as a comparison point.

## Running it

Requires Node 20 or newer and pnpm. The analysis scripts under `scripts/` are a mix of TypeScript run through `tsx` and Python 3; the Python ones use the standard library only, so there is nothing to install for them.

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm test         # 320 tests
pnpm typecheck
pnpm build
```

Scenarios load from the picker in the application header. Each starts paused, so the detector output can be read before anything moves.

Live mode needs no key. It calls `api.adsb.lol` for traffic and `aviationweather.gov` for METAR through a dev-server proxy declared in `vite.config.ts`.

## Engineering notes

`docs/` holds 16 notes recording defects found in this system and what
was done about them. They are cited from the papers where a finding needs its
working shown, and three of them were cited from nowhere until this index
existed, which is why the index exists: a record nothing links to is a record
nobody reads.

- [`cwt-migration.md`](docs/cwt-migration.md). Migrating the wake model from legacy weight classes to CWT
- [`data-dictionary.md`](docs/data-dictionary.md). What every column in the sampling dumps means, including the two that are easy to read as each other: `cross_track_nm` is the separation between a pair, `a_ct_own_nm` is one aircraft's distance from its own centreline. Also records that the schemas differ across windows, because the header is written when a file is created.
- [`departure-attribution-identity.md`](docs/departure-attribution-identity.md). Attributing departures exposed a units mismatch in the identity doctrine
- [`departure-fix-cost.md`](docs/departure-fix-cost.md). What removing the departure blind spot cost, measured
- [`departure-proximity-blindspot.md`](docs/departure-proximity-blindspot.md). The proximity detector cannot see airborne departures
- [`imc-first-violation.md`](docs/imc-first-violation.md). The first instrument-condition violation is one the visual-separation
- [`phase-vocabulary-audit.md`](docs/phase-vocabulary-audit.md). What phases live ingest produces, and what the detectors expect
- [`potomac-severity-margin.md`](docs/potomac-severity-margin.md). The flagship reconstruction produces a warning, not a critical
- [`projector-defects.md`](docs/projector-defects.md). Three defects in the forward projector
- [`proximity-first-read.md`](docs/proximity-first-read.md). Proximity warnings: first read from the per-pair dump
- [`runway-attribution-limit.md`](docs/runway-attribution-limit.md). Why runway attribution cannot be fixed without new data
- [`suppression-live-effect.md`](docs/suppression-live-effect.md). The suppression layer stopped mattering live, and nothing noticed
- [`tier-mover-verification.md`](docs/tier-mover-verification.md). Verifying that two tier-moving corrections execute on live data
- [`wake-floor-finding.md`](docs/wake-floor-finding.md). Why the admitted wake pairs read as violations
- [`wake-residual-open.md`](docs/wake-residual-open.md). The residual wake violations: what the full window settled, and what it did not
- [`window-count-unverifiable.md`](docs/window-count-unverifiable.md). The published window count could not be re-derived, so it was removed

## Reproducing the analysis

Seven scripts back the claims in the write-up. The two TypeScript ones run through `tsx`, because the app's modules use extensionless relative imports that Node's native type stripping does not resolve; the four Python ones need nothing beyond a Python 3 interpreter. Two files in `scripts/` are shared modules rather than scripts you run. `wilson.py` holds the score interval that `imc-pool.py` and `prox-runway-split.py` both report, kept in one place because a copied statistical function drifts and the two would then print different intervals for the same window with nothing in either output saying so. `window_files.py` opens a window CSV or explains what is missing: the tag, the fact that `data/` is gitignored so windows are never distributed, which tags this checkout does have, and the sampler command that makes one. Before it, running any of these with the `demo` tag below produced a `FileNotFoundError` traceback, which names a path and answers none of that.

```bash
# Monolith vs detector population across every scenario, plus a check
# that each declared Alert category has an emitter.
./node_modules/.bin/tsx scripts/baseline-compare.mjs

# Per-detector ablation: each detector is removed, the rest re-run through
# suppression, and the corpus compared alert by alert. Reports what is lost,
# what a removal reveals, and which scenarios lose a tier or go silent. Not the
# same question as the category split, which counts what each detector produced
# rather than what would be missing without it.
./node_modules/.bin/tsx scripts/ablation.mjs

# False-positive sampling against live traffic. The window is written to
# data/fp-<icao>-<tag>.csv, and --tag defaults to "run", so name it.
./node_modules/.bin/tsx scripts/fp-analysis.mjs --airport=KJFK --hours=24 --tag=demo
./node_modules/.bin/tsx scripts/fp-analysis.mjs --summarise=data/fp-kjfk-demo.csv

# The windows themselves are not distributed: data/ is gitignored, so the
# analyses below run on a window sampled here rather than replaying a published
# one. The figures in the write-up came from windows that no longer exist.
python3 scripts/prox-runway-split.py demo       # criticals by pair kind
python3 scripts/wake-condition-split.py demo    # wake violations by METAR condition
python3 scripts/hour-match-compare.py demo1 demo2   # two windows, traffic-normalised

# Checks the papers' countable claims against the code that produces them.
# Also runs inside the test suite, which passes the test count in because a
# suite cannot count itself. Run by hand it skips that one check and says so.
# It needs tsx for the same reason baseline-compare.mjs does: plain node dies
# on the first extensionless import, several seconds before checking anything.
./node_modules/.bin/tsx scripts/verify-paper-claims.mjs

# Asserts that TOTAL_TESTS in sim.test.ts equals the number of tests the
# suite actually runs. That constant is what verify-paper-claims.mjs quotes
# to the papers, so every published test count rests on it, and it cannot be
# measured from inside the suite it counts without recursing. Runs in CI.
./node_modules/.bin/tsx scripts/check-test-count.mjs

# Reports what the public site actually serves, by downloading the published
# PDF and comparing its page count against the one this checkout builds. A
# commit date cannot answer "what does a reader get"; three inferences from
# one in two days were wrong, and two of those would have put a false
# statement into a published paper. Not run in CI: it needs the network, and
# a gap is the expected state while anything sits unmerged. Since 2026-09-01
# it also fetches the served application bundles and reports whether they
# carry the current feed-unavailable panel, because both papers described
# what a refused feed looks like using behaviour that is in this checkout
# and not in the deployment.
./scripts/check-deployed.sh

# Reports whether live mode works on the deployed application, probing the two
# fields at the path live-adsb.ts builds rather than one that looks right: a
# hand probe of a plausible-but-unused path reported one refusing upstream
# where two were refusing. A test holds this script's URL to the client's.
# Not run in CI, and exits zero either way, because a volunteer feed refusing
# is not this repository's defect and a check that fails on the expected state
# gets ignored.
./scripts/check-live-feed.sh

# Runs every command deploy.yml runs, in its order, and fails if the workflow
# grows one this script lacks. Written after 245 passing tests hid three type
# errors: the suite is what gets run after a change, and the suite was green.
./scripts/verify-like-ci.sh

# The edge proxy targets the Cloudflare Pages runtime, so it sits outside the
# app's tsconfig and was checked by nothing at all: three files, every live
# request, including the one whose missing User-Agent header stopped the
# deployed site fetching data. It typechecks clean; the gap was coverage.
pnpm typecheck:functions

# Reports, per airport, whether stored runway headings agree with the bearings
# the surveyed thresholds imply. Every runway at one field shares one magnetic
# variation, so the difference has to be constant; where it is not, the field
# contradicts itself. Five US airports do. Needs no external source: the
# thresholds are already NASR.
./node_modules/.bin/tsx scripts/heading-consistency.mjs
```

`fp-analysis.mjs` imports the production detector modules and calls `runPredictiveRules`, the same entry point the browser uses. Its only deviation from the browser path is HTTP transport: `fetch` is shimmed to apply the rewrites that `vite.config.ts` declares, since the app fetches through relative proxy paths that do not resolve under Node. A local reimplementation of any detector would produce numbers describing the reimplementation rather than this system. That is why the import path is load-bearing and should not be replaced with a copy.  <!-- claim-verified: a subset that does something, not a count of the population -->

### The rest of `scripts/`

Six scripts back the claims and are listed above. The others are tools rather
than evidence, and are listed here because not knowing a tool exists is how a
measurement gets reimplemented: on 2026-09-01 a hand-written join over the pair
dumps produced a plausible figure that disagreed with a correct paper, because it
counted recorded pairs where `imc-pool.py` counts admitted ones.

| script | what it is for |
| --- | --- |
| `imc-watch.mjs` | Watches METARs at the registry airports and launches a sampling window when instrument conditions appear. |
| `imc-pool.py` | Pools the instrument windows and prints pairs by condition. The admission rule lives here; do not restate it elsewhere. |
| `fp-compare.mjs` | Before-and-after comparison of two `fp-analysis` CSVs. |
| `export-bluesky-scn.mjs` | Exports every scenario to a BlueSky `.SCN`, so the corpus replays in a simulator the ATM community recognises. |
| `gen-runway-geometry.py` | Rebuilds runway geometry from the FAA's current 28-day NASR subscription. |
| `extract-standalone.sh` | Extracts `apps/atc` into a standalone repository, ready to publish. |
| `absolute-claims.mjs` | Inventories the sentences asserting the system cannot, never or provably does something, and pins the set in `docs/absolute-claims.txt`. `--check` fails when the set moves. It cannot tell whether a claim is true; it tells you which are new, and a new one is the one nothing has verified. |
| `postbuild.mjs` | Build step; not an analysis tool. |

## Limitations

These are the reasons not to trust this prototype, in rough order of how much they matter.

**The incident corpus is a shape check, not a validation.** The nine scenarios are reconstructions built from published investigation reports, with the outcome already known. That the system flags a condition on a reconstruction of an accident says the detector fires on the shape of that accident. It does not establish that the system would have prevented it, nor that it would fire in time on live data.

**Live ingest sees a quarter to a half of nearby traffic, and less in shared airspace.** The classifier in `src/sim/live-adsb.ts` infers intent from geometry: descending and inbound means arrival, climbing and outbound means departure, anything else is discarded. Around KJFK that drops LaGuardia, Newark and Teterboro traffic along with high-altitude transits, leaving between 10 and 18 per cent classified depending on the window, and KJFK is the worst case in the registry rather than the typical one: the same comparison measured 25.3% at Atlanta, and an earlier O'Hare spot check reached 43%. This heading said "about a tenth" until 2026-08-29, quoting the KJFK number as though it described the system, which overstated a real limitation by roughly half and is the same error as understating one. A deployed system would receive flight-plan-correlated tracks from the facility instead of inferring intent from position reports.

**Several inputs are synthesised rather than measured.** ADS-B carries no fuel state and no gate assignment. It does carry a wake-relevant emitter category, present on 96 to 100 per cent of records measured on 2026-08-29 and reading A1 through A7, which is weight bands plus rotorcraft; it is too coarse for the CWT spacing this project applies, so `wakeFromType` uses the ICAO type designator instead, and the emitter category is not read at all. Saying ADS-B carries no reliable wake category, as this paragraph did, overstated that into an absence. Vertical rate is supplied and not read. `baro_rate` was measured on 2026-08-29 across four fields and reached 82 to 100 per cent of airborne records, 63 of 69, so the proximity tau test's vertical check stays instantaneous because this ingest does not consume the field, not because the feed lacks it. This paragraph said the opposite until that measurement, which turned an unavoidable limit into an unmade choice. Wake is inferred from the type code. Fuel is fabricated as `max(30, etaMin + 60)`, which is always above the fuel detector's `etaMin + 45` trigger, so that detector cannot fire on live data at all. Gate assignment is absent in live mode.

**Thresholds are untuned and the critical-alert rate on ordinary traffic is high.** A short early sample suggested roughly two to three critical alerts per twenty-second snapshot. A full 24-hour window measured 0.685 per snapshot at KJFK and 0.960 at KATL, which is the figure to use: it is a larger sample over a whole diurnal cycle, and it still means ordinary traffic draws a critical on roughly every snapshot. Sustained critical alerting on routine operations is the alert-fatigue failure mode decision-support systems are judged on. Correction rounds since have cut it 90 to 99 per cent per thousand aircraft at five airports; the write-up reports what that cost, because part of the fall is narrower coverage rather than better precision.

**`weather-shift` cannot detect a shift.** `SimState` carries one weather observation and no history, so the detector reports adverse conditions and an unstable wind rather than a trend. A real trend test needs a weather series the state does not hold.

**Projection demotion ignores the horizon.** A projected `critical` becomes a `warning` and everything else an `advisory`, identically at one, two and three minutes out. Demotion that deepens with the horizon, and with how far the threshold was exceeded, is unbuilt.

**The forward projector assumes constant heading and speed.** Aircraft in a turn or on a speed change are projected wrongly, which matters most in exactly the terminal-area geometry the prototype targets.

## Layout

```
src/sim/rules.ts             eleven detector functions, suppression, orchestrator
src/sim/rules-baseline.ts    monolithic implementation, for comparison
src/sim/predict.ts           projections and de-duplication
src/sim/scenarios.ts         28 scenarios: 9 incidents, 11 negative controls, 8 operational demonstrations
src/sim/live-adsb.ts         ADS-B ingest and arrival/departure classification
src/sim/live-weather.ts      METAR ingest
src/sim/sim.test.ts          320 tests: one per claim in the write-up,
#                             plus invariants the corpus must satisfy to be
#                             a corpus of its kind, which no claim asserts
src/sim/lifecycle.ts         cross-tick alert tracking and flicker suppression
scripts/fp-analysis.mjs      false-positive sampling harness
scripts/baseline-compare.mjs monolith vs detector population
```

## Data sources

Traffic from [adsb.lol](https://adsb.lol), a volunteer ADS-B feed. Weather from the [NOAA Aviation Weather Center](https://aviationweather.gov). Neither endorses this work. Incident reconstructions draw on published NTSB, ICAO, CIAIAC and ANSV reports, cited per scenario in `src/sim/scenarios.ts`.

## Licence

Apache License 2.0. See `LICENSE`.
