#!/usr/bin/env node
// False-positive analysis harness for Section 6.7 of the thesis.
//
// Polls live ADS-B + METAR for the chosen airport, runs THE PRODUCTION DETECTOR
// POPULATION on every snapshot, and records per-category / per-severity alert
// counts to a CSV. Designed to run for 24+ hours unattended.
//
// Usage (tsx is required — see "Why tsx" below):
//   ./node_modules/.bin/tsx scripts/fp-analysis.mjs --airport=KJFK --hours=24
//   ./node_modules/.bin/tsx scripts/fp-analysis.mjs --summarise=fp-kjfk-24h.csv
//
// Flags:
//   --airport=KJFK     ICAO code; must exist in src/sim/airports.ts
//   --hours=24         wall-clock duration
//   --interval=20      seconds between snapshots (matches LIVE_POLL_MS in live-store.ts)
//   --dump-prox=FILE   one row per proximity-envelope pair per snapshot, with
//                      both aircraft's runway assignment, heading and phase.
//                      Answers whether proximity volume is parallel approaches.
//   --dump-pairs=FILE  one row per candidate wake pair per snapshot, with the
//                      wake categories and the requirement applied. Off by
//                      default. Use it while a wake question is open: the
//                      aggregate columns cannot say WHY a pair failed.
//   --out=FILE         CSV path (default fp-<airport>-<hours>h.csv)
//   --summarise=FILE   skip sampling; just re-print the summary for an existing CSV
//
// ---------------------------------------------------------------------------
// METHODOLOGICAL NOTE — read before changing this file.
//
// An earlier version of this script hand-rolled its own `countAlerts()` that
// reimplemented two of the nine detectors with inlined thresholds. Numbers
// produced that way describe the reimplementation, not the system the thesis
// describes, so they cannot support a false-positive claim about it.
//
// This version imports the unmodified production modules:
//
//   fetchLiveTraffic     src/sim/live-adsb.ts    ADS-B record -> Flight mapping
//   fetchAirportWeather  src/sim/live-weather.ts METAR -> Weather mapping
//   runPredictiveRules   src/sim/predict.ts      detectors + forward projections + de-dup
//   updateTrails         src/sim/trails.ts       trail state (mirrors the live reducer)
//   AIRPORTS             src/sim/airports.ts     runway/gate geometry
//
// `runPredictiveRules` — not the bare `runAllRules` — is the entry point the
// live operator surface uses (see the reducer in live-store.ts), so it is what
// gets exercised here: detectors, +60/+120/+180s projections, and the
// de-duplication in Section 6.6 all included.
//
// The ONE deviation from the browser path is HTTP transport. The app fetches
// through relative Vite dev-proxy paths (`/api/adsb`, `/api/wx`) which have no
// meaning in Node, so `fetch` is shimmed below to apply exactly the rewrites
// declared in vite.config.ts. No application source is modified, and no
// detector logic is duplicated in this file.
//
// Why tsx: the app's .ts modules use extensionless relative imports
// (`from "./rules"`). Node's native type stripping does not resolve those, so
// plain `node` fails with ERR_MODULE_NOT_FOUND. tsx handles both.
// ---------------------------------------------------------------------------

import { dirname } from "node:path";
import { appendFile, readFile, writeFile, readdir} from "node:fs/promises";
import { existsSync } from "node:fs";
import process, { argv } from "node:process";

const args = Object.fromEntries(
  argv
    .slice(2)
    .map((a) => a.replace(/^--/, "").split("="))
    .map(([k, v]) => [k, v ?? "true"]),
);

// --- fetch shim: replicate the vite.config.ts dev-server proxy ---------------
// '/api/adsb/X' -> 'https://api.adsb.lol/X'
// '/api/wx/X'   -> 'https://aviationweather.gov/api/X'
const upstreamFetch = globalThis.fetch;

// ADS-B with fallback. adsb.lol soft-throttles by IP: HTTP 200 with an empty
// ac[] instead of an error (measured 2026-08-09 — four airports empty while a
// fifth returned data, then direct curls empty too). An empty bubble within
// 40 NM of a major US airport is not a plausible sky, so empty triggers the
// fallback to airplanes.live, whose /v2/point API carries the same readsb
// record shape including dst. Its anonymous limit is 1 req/s; this harness
// issues one request per 15 s.
// Every upstream request carries a hard timeout: a single hung TCP connection
// froze the whole sampling loop for 24 hours on 2026-08-09/10 (last row
// 21:33Z, process alive and blocked ever since), because native fetch waits
// indefinitely by default.
const FETCH_TIMEOUT_MS = 20_000;

// Identify the client. Both upstreams are volunteer-run networks, and an
// anonymous poller is indistinguishable from abuse; this carries a contact
// address so anyone unhappy with the load can find the author.
const USER_AGENT =
  "atc-research/0.5 (+https://www.fbritoferreira.com/research/atc-decision-support/; me@fbritoferreira.com)";
const timedFetch = (url) =>
  upstreamFetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "user-agent": USER_AGENT },
  });

// Mirror circuit breaker. airplanes.live returned 403 to this client after
// several days of sampling (2026-08-13), and continuing to poll an endpoint
// that has refused us is both useless and rude, so after three consecutive
// refusals the mirror is dropped for the rest of the run and the primary is
// used alone.
let mirrorStrikes = 0;
const MIRROR_STRIKE_LIMIT = 3;

const fetchAdsbWithFallback = async (path) => {
  const m = path.match(/\/v2\/lat\/([-\d.]+)\/lon\/([-\d.]+)\/dist\/([\d.]+)/);
  let primaryStatus = "unreached";
  try {
    const res = await timedFetch(`https://api.adsb.lol${path}`);
    primaryStatus = String(res.status);
    if (res.ok) {
      const data = await res.json();
      if ((data.ac ?? []).length > 0) {
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
    }
  } catch (e) {
    primaryStatus = `error ${e.name}`;
  }
  if (!m || mirrorStrikes >= MIRROR_STRIKE_LIMIT) {
    // Upstream named honestly: an earlier revision reported every failure as
    // "adsb.lol", which hid ten hours of mirror 403s behind the primary's name.
    return new Response(
      JSON.stringify({ error: `adsb.lol ${primaryStatus}, mirror unavailable` }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  }
  const [, lat, lon, dist] = m;
  const mirror = await timedFetch(`https://api.airplanes.live/v2/point/${lat}/${lon}/${dist}`);
  if (mirror.status === 403) {
    mirrorStrikes += 1;
    if (mirrorStrikes === MIRROR_STRIKE_LIMIT) {
      console.warn(
        `\n[fp-analysis] airplanes.live refused ${MIRROR_STRIKE_LIMIT} times (403); dropping the mirror for this run`,
      );
    }
  } else {
    mirrorStrikes = 0;
  }
  return mirror;
};

globalThis.fetch = (input, init) => {
  let url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.startsWith("/api/adsb")) {
    return fetchAdsbWithFallback(url.slice("/api/adsb".length));
  }
  if (url.startsWith("/api/wx")) {
    url = `https://aviationweather.gov/api${url.slice("/api/wx".length)}`;
    return timedFetch(url);
  }
  return upstreamFetch(url, init);
};

// Production modules. Imported after the shim is installed.
const { AIRPORTS } = await import("../src/sim/airports.ts");
const { fetchLiveTrafficDetailed } = await import("../src/sim/live-adsb.ts");
const { fetchAirportWeather } = await import("../src/sim/live-weather.ts");
const { runPredictiveRules } = await import("../src/sim/predict.ts");
const { wakeGapMargins, wakeCandidatePairs, proximityPairs } = await import("../src/sim/rules.ts");
const { cwtFromType } = await import("../src/sim/cwt-lookup.ts");
const { airportEndGeometries, crossTrackToEndNm } = await import(
  "../src/sim/runway-geometry.ts",
);
const { updateTrails } = await import("../src/sim/trails.ts");
const { smoothEtas } = await import("../src/sim/smoothing.ts");

const SEVERITIES = ["critical", "warning", "advisory", "info"];
const CATEGORIES = [
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

const COLUMNS = [
  "timestamp_utc",
  "airport",
  "n_contacts",
  "n_flights",
  "n_alerts_total",
  "n_active",
  "n_suppressed",
  "n_lookahead",
  // Alert turnover between consecutive snapshots at this airport, which tests
  // the premise behind the alert lifecycle layer. That layer holds an alert
  // for a grace period after the detectors stop emitting it, on the argument
  // that live threshold jitter makes alerts appear and vanish on consecutive
  // polls. Nothing had ever measured whether that happens: the lifecycle runs
  // in the browser store, and this harness calls the detector pass directly,
  // so every published live figure is raw detector output rather than the
  // operator's view. n_alerts_returned counts ids that came back after
  // exactly one absent snapshot, which is flicker in the sense the layer was
  // built for.
  "n_alerts_new",
  "n_alerts_gone",
  "n_alerts_returned",
  ...SEVERITIES.map((s) => `n_${s}`),
  ...CATEGORIES.map((c) => `n_${c.replace(/-/g, "_")}`),
  ...CATEGORIES.map((c) => `n_crit_${c.replace(/-/g, "_")}`),
  "n_wake_pairs",
  "wake_margin_min",
  "n_wake_margin_lt_m1",
  "n_wake_margin_m1_0",
  "n_wake_margin_0_1",
  // Vortex-band selection effect. Hypothesis under test (stated in the paper
  // 2026-08-18, not yet answered): because a follower further back on a 3
  // degree glideslope is also higher, the 1,000 ft band may admit mostly
  // close-together pairs and exclude the well-separated ones, which would
  // inflate the share of pairs reading as violations.
  "n_wake_candidates",
  "n_wake_band_excluded",
  "adm_gap_med_nm",
  "excl_gap_med_nm",
  "n_adm_legal",
  "n_excl_legal",
  // Wake-candidate aircraft whose type designator has no CWT assignment, per
  // snapshot. The doctrine falls to the radar floor for these rather than
  // guessing a category, and the rate has to be visible for that choice to be
  // auditable: the MAX and neo families are absent from the 2021 FAA table, so
  // this is expected to be common, not exotic.
  "n_cwt_unmapped",
  "wind_dir_deg",
  "wind_kts",
  "gusts_kts",
  "visibility_nm",
  "ceiling_ft",
  "wx_condition",
  // Which airport the weather block was actually observed for, empty when no
  // METAR has arrived and the seeded block is still in place. Added
  // 2026-09-01: the application has carried this since the carry-across fix,
  // and the sampler was dropping it, so every window recorded a weather triple
  // with no way to tell a real clear day from a never-observed default. Ten
  // miles and twenty thousand feet is both the seed and a genuinely cloudless
  // sky, so the other three weather columns cannot answer the question between
  // them; 1,512 of 3,065 snapshots collected before this column existed carry
  // that triple and are unresolvable. Both papers name this as the field the
  // schema did not carry, which is true of every window closed before today.
  "wx_observed_for",
  // Whether the condition string came from the observation or from the default
  // that reads a category-less METAR as visual. Separate from the column above,
  // which only says an observation arrived: a METAR without a flight category
  // sets that one and still defaults this. Both were needed and running them
  // together was the first mistake made here.
  //
  // They do overlap in one direction, which is worth knowing when reading a
  // window: this flag can only be true if a report arrived, so a true here
  // with a blank above means the observation happened and the airport was not
  // recorded, not that no observation happened. That is exactly the state of
  // the window opened at 10:04Z on 2026-09-01, which ran under a sampler that
  // predated the fix. The reverse does not hold: a blank here says nothing
  // about whether a report arrived.
  "wx_condition_observed",
];

// --- summary -----------------------------------------------------------------
const quantile = (sorted, q) => {
  if (sorted.length === 0) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

const summarise = (rows, label) => {
  if (rows.length === 0) {
    console.log("\nNo snapshots recorded — nothing to summarise.");
    return;
  }
  // A column this summary reads but the file does not carry would otherwise
  // become a zero in every row, and a zero here is a measurement: it lowers a
  // mean, empties a share, and reads exactly like a quiet window. The schema
  // has grown before, so summarising an older file with a newer script is the
  // case this guards. Named rather than counted, so the message says which.
  const REQUIRED = [
    "n_alerts_total",
    "n_active",
    "n_contacts",
    "n_flights",
    "n_lookahead",
    "n_suppressed",
  ];
  const absent = REQUIRED.filter((k) => !(k in rows[0]));
  if (absent.length > 0) {
    console.log(
      `\nNOT SUMMARISED: ${label} lacks ${absent.join(", ")}. ` +
        `Reading them as zero would report a quiet window rather than a missing column.`,
    );
    return;
  }
  const num = (r, k) => Number(r[k] ?? 0);
  const perSnap = rows.map((r) => num(r, "n_alerts_total")).sort((a, b) => a - b);
  const flights = rows.map((r) => num(r, "n_flights"));
  const sum = (k) => rows.reduce((t, r) => t + num(r, k), 0);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

  const spanMin = (() => {
    const ts = rows.map((r) => Date.parse(r.timestamp_utc)).filter((n) => !Number.isNaN(n));
    if (ts.length < 2) return 0;
    return (Math.max(...ts) - Math.min(...ts)) / 60000;
  })();

  console.log(`\n=== Section 6.7 false-positive summary${label ? ` — ${label}` : ""} ===`);
  console.log(`  Snapshots:              ${rows.length}`);
  console.log(`  Wall-clock span:        ${(spanMin / 60).toFixed(2)} h (${spanMin.toFixed(0)} min)`);
  console.log(`  Aircraft per snapshot:  mean ${mean(flights).toFixed(1)}  min ${Math.min(...flights)}  max ${Math.max(...flights)}`);

  // Ingest coverage: share of nearby ADS-B contacts the classifier attributes
  // to this airport. The remainder never reaches the detector population.
  const contacts = rows.map((r) => num(r, "n_contacts"));
  if (contacts.some((n) => n > 0)) {
    const totalContacts = contacts.reduce((a, b) => a + b, 0);
    const totalFlights = flights.reduce((a, b) => a + b, 0);
    console.log(`  ADS-B contacts/snapshot: mean ${mean(contacts).toFixed(1)}`);
    console.log(
      `  Ingest coverage:        ${((totalFlights / totalContacts) * 100).toFixed(1)}% classified ` +
        `(${(100 - (totalFlights / totalContacts) * 100).toFixed(1)}% of nearby contacts unclassified, never seen by detectors)`,
    );
  }
  console.log(`  Total alerts:           ${sum("n_alerts_total")}`);
  console.log(`  Alerts per snapshot:    mean ${mean(perSnap).toFixed(2)}  p50 ${quantile(perSnap, 0.5).toFixed(1)}  p95 ${quantile(perSnap, 0.95).toFixed(1)}  max ${Math.max(...perSnap)}`);
  console.log(`  Snapshots with 0 alerts: ${perSnap.filter((n) => n === 0).length} (${((perSnap.filter((n) => n === 0).length / rows.length) * 100).toFixed(1)}%)`);
  console.log(`  Of which look-ahead:    ${sum("n_lookahead")}`);
  if (rows.some((r) => r.n_active !== undefined)) {
    console.log(
      `  Operator view (unsuppressed): ${sum("n_active")} total, ` +
        `${(sum("n_active") / rows.length).toFixed(2)}/snapshot ` +
        `(${sum("n_suppressed")} suppressed)`,
    );
  }
  console.log("\n  By severity:");
  for (const s of SEVERITIES) {
    const t = sum(`n_${s}`);
    console.log(`    ${s.padEnd(10)} ${String(t).padStart(8)}   ${(t / rows.length).toFixed(3)}/snapshot`);
  }
  const hasCrosstab = rows.some((r) => r[`n_crit_${CATEGORIES[0].replace(/-/g, "_")}`] !== undefined);
  if (hasCrosstab) {
    console.log("\n  Critical alerts by category:");
    for (const c of CATEGORIES) {
      const t = sum(`n_crit_${c.replace(/-/g, "_")}`);
      if (t > 0) console.log(`    ${c.padEnd(20)} ${String(t).padStart(8)}   ${(t / rows.length).toFixed(3)}/snapshot`);
    }
  }
  console.log("\n  By category:");
  for (const c of CATEGORIES) {
    const t = sum(`n_${c.replace(/-/g, "_")}`);
    console.log(`    ${c.padEnd(20)} ${String(t).padStart(8)}   ${(t / rows.length).toFixed(3)}/snapshot`);
  }
  console.log("");
};

const parseCsv = (text) => {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(header.map((h, i) => [h, cells[i]]));
  });
};

// --- summarise-only mode -----------------------------------------------------
if (args.summarise && args.summarise !== "true") {
  // A missing file used to throw an uncaught ENOENT with a stack trace. The
  // README documents this flag against a demo CSV that does not exist and never
  // did, so the documented command crashed for every reader. The sibling Python
  // analyses already answer this case by naming the tags actually present, and
  // saying data/ is gitignored, which is the useful reply: the file is absent
  // because measurement windows are not distributed, not because anything broke.
  let text;
  try {
    text = await readFile(args.summarise, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    const dir = dirname(args.summarise) || ".";
    let present = [];
    try {
      present = (await readdir(dir)).filter((f) => f.startsWith("fp-") && f.endsWith(".csv"));
    } catch {
      // the directory itself is absent on a fresh clone, which the message covers
    }
    console.error(`${args.summarise} not found.

Measurement windows are not distributed. apps/atc/data/ is gitignored, so this
file exists only if it was sampled here. Sampled files present: ${present.join(", ") || "none"}

To produce one:
  ./node_modules/.bin/tsx scripts/fp-analysis.mjs --airport=KJFK --hours=24`);
    process.exit(1);
  }
  summarise(parseCsv(text), args.summarise);
  process.exit(0);
}

// --- sampling mode -----------------------------------------------------------
// Accepts one airport (--airport=KJFK) or several (--airports=KJFK,KATL,...).
// Several airports share ONE request stream, round-robin: adsb.lol
// rate-limits per source IP, and N independent pollers starve each other —
// measured 2026-08-09, four of five parallel samplers receiving empty (but
// HTTP 200) responses while the fifth held the rate slot. One stream at the
// solo cadence stays inside the budget; each airport's effective cadence is
// N × interval, which the CSV timestamps record truthfully.
// Sampling starts on bare invocation otherwise, because the airport, the
// duration and the tag all had defaults. Running this file to see what it does
// begins a 24-hour live poll of KJFK writing fp-kjfk-run.csv, which is what
// happened on 2026-09-01: a check of whether the script still ran appended 31
// real snapshots to an existing dump. Nothing published moved, because that
// file has no per-pair dump and no window list names it, but the next such
// accident need not be as harmless. Reading a script must not start one.
if (!args.airports && !args.airport) {
  console.error(
    `fp-analysis.mjs: sampling needs an explicit --airport or --airports.\n` +
      `  ./node_modules/.bin/tsx scripts/fp-analysis.mjs --airport=KJFK --hours=24\n` +
      `  ./node_modules/.bin/tsx scripts/fp-analysis.mjs --summarise=data/fp-kjfk-run.csv`,
  );
  process.exit(2);
}
const AIRPORT_LIST = (args.airports ?? args.airport)
  .toUpperCase()
  .split(",")
  .map((a) => a.trim())
  .filter(Boolean);
const HOURS = Number.parseFloat(args.hours ?? "24");
const INTERVAL_SEC = Number.parseInt(args.interval ?? "20", 10);
const WX_REFRESH_SEC = 300; // mirrors WX_POLL_MS in live-store.ts
const RUN_TAG = args.tag ?? "run";
// Per-pair wake diagnostic. Off by default: one row per candidate pair per
// snapshot is far more volume than the per-snapshot CSV and is only wanted
// while a specific question is open.
const DUMP_PAIRS = args["dump-pairs"] ?? null;
// Proximity pair diagnostic. Proximity is now the largest alert category by
// volume and its warning tier is a raw distance box over all active aircraft,
// so the open question is whether that volume is simultaneous parallel
// approaches. Answering it needs both aircraft's runway assignment and heading
// per pair, which no aggregate carries.
const DUMP_PROX = args["dump-prox"] ?? null;

const freshState = (airport) => ({
  tick: 0,
  clockMin: new Date().getUTCHours() * 60 + new Date().getUTCMinutes(),
  sectorId: `${airport.icao} TWR`,
  flights: [],
  runways: airport.runways,
  gates: airport.gates,
  weather: {
    windDirDeg: 270,
    windKts: 0,
    gustsKts: 0,
    visibilityNm: 10,
    ceilingFt: 20000,
    condition: "VFR",
    precipitation: "none",
  },
  alerts: [],
  speed: 1,
  trails: {},
  live: true,
});

const contexts = [];
for (const code of AIRPORT_LIST) {
  const airport = AIRPORTS[code];
  if (!airport) {
    console.error(`Unknown airport: ${code}. Known: ${Object.keys(AIRPORTS).join(", ")}`);
    process.exit(1);
  }
  const out =
    AIRPORT_LIST.length === 1 && args.out
      ? args.out
      : `data/fp-${code.toLowerCase()}-${RUN_TAG}.csv`;
  if (!existsSync(out)) await writeFile(out, `${COLUMNS.join(",")}\n`);
  const PROX_HEADER =
    "timestamp_utc,icao,a,a_type,a_phase,a_runway,a_hdg,a_alt,b,b_type,b_phase," +
    "b_runway,b_hdg,b_alt,horiz_nm,vert_ft,cross_track_nm,along_track_nm,a_ct_own_nm,b_ct_own_nm,ft_per_nm," +
    "critical,both_arrivals,same_runway";
  if (DUMP_PROX) {
    if (!existsSync(DUMP_PROX)) {
      await writeFile(DUMP_PROX, `${PROX_HEADER}\n`);
    } else {
      // A dump is only appended to and its header is written once, so a window
      // resumed against a file from before a schema change writes rows wider
      // than the header describes. Every reader resolves columns by name from
      // that header, so the extra fields do not land in a new column: they
      // shift the ones after them, and ft_per_nm starts being read as critical.
      // Nothing about that looks wrong in the file. The two centreline columns
      // added on 2026-09-02 sit mid-row, which is what made this reachable.
      // Refusing is right, because the alternative is a window whose last hours
      // are quietly wrong.
      const existingHeader = (await readFile(DUMP_PROX, "utf8"))
        .split("\n")[0]
        .trim();
      if (existingHeader && existingHeader !== PROX_HEADER) {
        console.error(
          `${DUMP_PROX} was written with a different column set. Appending ` +
            `would shift every column after the change.\n` +
            `  file:   ${existingHeader}\n  writer: ${PROX_HEADER}\n` +
            `Sample to a new tag, or migrate the file first.`,
        );
        process.exit(1);
      }
    }
  }
  if (DUMP_PAIRS && !existsSync(DUMP_PAIRS)) {
    await writeFile(
      DUMP_PAIRS,
      "timestamp_utc,icao,runway,lead,lead_wake,trail,trail_wake,gap_nm,required_nm," +
        // Cross-track and along-track separation, the discriminator the first
        // wake dump lacked. Three explanations for the residual violations were
        // tested and rejected on that dump; what survives is that the pairing may
        // be joining aircraft that are not on the same localiser. Two aircraft in
        // trail on one approach differ almost entirely along-track. Two abreast on
        // adjacent parallels differ cross-track by the runway spacing.
        "cross_track_nm,along_track_nm,a_ct_own_nm,b_ct_own_nm," +
        "margin_nm,vert_gap_ft,within_band,lead_alt_ft,trail_alt_ft,lead_eta_min,trail_eta_min," +
        // Type designator and CWT category per aircraft, appended for the CWT
        // migration: the requirement column is only interpretable per pair if
        // the categories that produced it are recorded with it. Empty CWT cell
        // means the type has no FAA assignment and the radar floor governed.
        "lead_type,lead_cwt,trail_type,trail_cwt\n",
    );
  }
  contexts.push({ code, airport, out, state: freshState(airport), written: [], lastWxAt: 0 });
}

const endAt = Date.now() + HOURS * 3600 * 1000;
console.log(
  `[fp-analysis] airports=${AIRPORT_LIST.join(",")} hours=${HOURS} ` +
    `interval=${INTERVAL_SEC}s/request (per-airport cadence ~${INTERVAL_SEC * AIRPORT_LIST.length}s)`,
);
console.log("[fp-analysis] detector entry point: runPredictiveRules (production path)");

const printSummariesAndExit = () => {
  for (const ctx of contexts) {
    summarise(ctx.written, `${ctx.out} (interrupted)`);
    console.log(`CSV at ${ctx.out}`);
  }
  process.exit(0);
};
process.on("SIGINT", printSummariesAndExit);
process.on("SIGTERM", printSummariesAndExit);

const sampleOne = async (ctx) => {
  const { flights, contacts } = await fetchLiveTrafficDetailed(ctx.airport);

  // Zero contacts within 40 NM of a registry airport is a throttled feed,
  // not an empty sky (both upstreams soft-throttle with 200-and-empty).
  // Recording it as a row would fabricate silent snapshots and drag every
  // per-snapshot rate down, so it is a failed snapshot instead. Cost: the
  // rare genuinely dead overnight bubble is also skipped; that bias is far
  // smaller than the throttle pollution it prevents.
  if (contacts === 0) {
    throw new Error("empty feed from both sources; treating as throttle");
  }

  if (Date.now() - ctx.lastWxAt > WX_REFRESH_SEC * 1000) {
    try {
      // weatherObservedFor is set beside the block it describes. Adding the
      // column on 2026-09-01 was not enough on its own: the application sets
      // this field in its store and the sampler builds its own state, so the
      // column wrote an empty field on every row of the first window collected
      // after it existed, which reads as "no observation ever arrived" for a
      // window whose weather was plainly observed. Caught by opening that
      // window rather than by any check, because an empty column is exactly
      // what an honest absence looks like.
      ctx.state = {
        ...ctx.state,
        weather: await fetchAirportWeather(ctx.airport.icao),
        weatherObservedFor: ctx.airport.icao,
      };
      ctx.lastWxAt = Date.now();
    } catch {
      /* METAR gaps are expected; keep the previous observation */
    }
  }

  const now = new Date();
  // Mirror the live reducer exactly: ETA smoothing against the previous
  // snapshot, then trails. The harness must exercise the same pipeline the
  // operator display runs, or its numbers describe a different system.
  const smoothed = smoothEtas(ctx.state.flights, flights);
  ctx.state = {
    ...ctx.state,
    tick: ctx.state.tick + 1,
    clockMin: now.getUTCHours() * 60 + now.getUTCMinutes(),
    flights: smoothed,
    trails: updateTrails(ctx.state.trails, smoothed),
  };
  const alerts = runPredictiveRules(ctx.state);
  ctx.state = { ...ctx.state, alerts };

  // Wake-gap margin distribution (gap minus required, NAUTICAL MILES since the
  // model became distance-based) for boundary design; the critical line sits
  // at -1.
  const margins = wakeGapMargins(ctx.state);
  const wakeStats = {
    pairs: margins.length,
    min: margins.length ? Math.min(...margins).toFixed(2) : "",
    ltM1: margins.filter((m) => m < -1).length,
    m1to0: margins.filter((m) => m >= -1 && m < 0).length,
    zeroTo1: margins.filter((m) => m >= 0 && m < 1).length,
  };

  // Vortex-band selection effect, read from the production enumeration rather
  // than recomputed here. If the band is neutral, the two gap medians and the
  // two legal shares should be comparable; if it selects for close pairs, the
  // excluded set carries the wider gaps and most of the legal ones.
  const median = (xs) => {
    if (!xs.length) return "";
    const v = [...xs].sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)].toFixed(2);
  };
  const candidates = wakeCandidatePairs(ctx.state);
  const admitted = candidates.filter((p) => p.withinBand);
  const excluded = candidates.filter((p) => !p.withinBand);
  const bandStats = {
    candidates: candidates.length,
    excluded: excluded.length,
    admGapMed: median(admitted.map((p) => p.gap)),
    exclGapMed: median(excluded.map((p) => p.gap)),
    admLegal: admitted.filter((p) => p.gap >= p.required).length,
    exclLegal: excluded.filter((p) => p.gap >= p.required).length,
    cwtUnmapped: new Set(
      candidates
        .flatMap((p) => [p.lead, p.trail])
        .filter((f) => cwtFromType(f.aircraft) === undefined)
        .map((f) => f.id),
    ).size,
  };

  // Per-pair dump, off unless --dump-pairs=FILE is passed.
  //
  // Measured 2026-08-19 on tuned8: of the pairs the vortex band admits, only 5
  // per cent are legal, at a median in-trail gap of 2.58 NM. US airports do not
  // routinely violate wake separation, so the aggregate columns are not enough
  // to say what is wrong. The leading hypothesis is that the detector compares
  // raw ADS-B positions against an exact threshold with no allowance for
  // measurement error, so traffic at the legal radar minimum of 3 NM reads as
  // violating whenever position noise or ETA smoothing puts the computed gap a
  // few tenths low. Competing explanations are non-sequential pairing when
  // etaMin is noisy, and parallel streams merging under LATERAL_CLUSTER_NM.
  //
  // Distinguishing them needs the wake categories and the requirement that was
  // applied, per pair, which no aggregate can carry.
  if (DUMP_PAIRS) {
    for (const p of candidates) {
      // Resolve against the mean heading of the pair, as the proximity dump does.
      // Both aircraft are established on final by the time a wake pair forms, so
      // their headings agree to within the alignment gate.
      const wakeHdg = ((p.lead.headingDeg + p.trail.headingDeg) / 2) * (Math.PI / 180);
      const wdx = p.lead.positionNm.x - p.trail.positionNm.x;
      const wdy = p.lead.positionNm.y - p.trail.positionNm.y;
      const wakeCross = Math.abs(wdx * Math.cos(wakeHdg) + wdy * Math.sin(wakeHdg));
      const wakeAlong = Math.abs(-wdx * Math.sin(wakeHdg) + wdy * Math.cos(wakeHdg));
      await appendFile(
        DUMP_PAIRS,
        [
          now.toISOString(),
          ctx.airport.icao,
          p.runwayId,
          p.lead.callsign ?? p.lead.id,
          p.lead.wake,
          p.trail.callsign ?? p.trail.id,
          p.trail.wake,
          p.gap.toFixed(2),
          p.required,
          wakeCross.toFixed(2),
          wakeAlong.toFixed(2),
          (p.gap - p.required).toFixed(2),
          p.vertGapFt,
          p.withinBand,
          p.lead.altitudeFt,
          p.trail.altitudeFt,
          p.lead.etaMin?.toFixed?.(2) ?? p.lead.etaMin,
          p.trail.etaMin?.toFixed?.(2) ?? p.trail.etaMin,
          p.lead.aircraft,
          cwtFromType(p.lead.aircraft) ?? "",
          p.trail.aircraft,
          cwtFromType(p.trail.aircraft) ?? "",
        ].join(",") + "\n",
      );
    }
  }

  if (DUMP_PROX) {
    for (const p of proximityPairs(ctx.state)) {
      const bothArr = p.a.type === "arrival" && p.b.type === "arrival";
      const hdg = (p.a.headingDeg + p.b.headingDeg) / 2;
      const rad = (hdg * Math.PI) / 180;
      const dx = p.a.positionNm.x - p.b.positionNm.x;
      const dy = p.a.positionNm.y - p.b.positionNm.y;
      // Each aircraft's own distance from the centreline of the runway it is
      // assigned, which is a different quantity from the cross-track separation
      // below: that one measures how far apart the pair is, this one measures
      // how far each has strayed from where it should be. Finding 311 asked
      // whether the parallel-runway downgrade should require convergence before
      // it applies, and the dumps could not answer it, because a pair abreast on
      // adjacent parallels and an aircraft leaving its localiser toward the
      // traffic beside it look identical in pair geometry. They do not look
      // identical here. Added 2026-09-02; windows sampled before that date carry
      // empty columns rather than wrong ones.
      const ends = airportEndGeometries(ctx.airport);
      const ownCt = (f) => {
        if (!f.assignedRunway) return "";
        // endLabel, not runwayId: inferRunway returns the end an aircraft
        // lands on ("26R"), while runwayId is the strip ("08L/26R").
        // Matching the wrong one returns undefined for every flight and
        // fills the column with blanks that read as missing data.
        const end = ends.find((e) => e.endLabel === f.assignedRunway);
        return end ? crossTrackToEndNm(f.positionNm, end).toFixed(2) : "";
      };
      const crossTrack = Math.abs(dx * Math.cos(rad) + dy * Math.sin(rad));
      const alongTrack = Math.abs(-dx * Math.sin(rad) + dy * Math.cos(rad));
      await appendFile(
        DUMP_PROX,
        [
          now.toISOString(),
          ctx.airport.icao,
          p.a.callsign ?? p.a.id, p.a.type, p.a.phase, p.a.assignedRunway ?? "", Math.round(p.a.headingDeg), p.a.altitudeFt,
          p.b.callsign ?? p.b.id, p.b.type, p.b.phase, p.b.assignedRunway ?? "", Math.round(p.b.headingDeg), p.b.altitudeFt,
          p.horizNm.toFixed(2), Math.round(p.vertFt),
          // Cross-track and along-track separation resolved against the shared
          // runway heading. This is the discriminator the first dump lacked:
          // two aircraft in trail on one localiser differ almost entirely
          // along-track, while two abreast on adjacent parallels differ
          // cross-track by the runway spacing. `same_runway` cannot answer it,
          // because inferRunway assigns by heading and every KATL parallel
          // carries the same heading, so both cases label identically.
          crossTrack.toFixed(2), alongTrack.toFixed(2),
          ownCt(p.a), ownCt(p.b),
          // Ratio against a 3 degree glideslope, roughly 318 ft/NM. Near it
          // means in trail and descending; far below means abreast.
          p.horizNm > 0.05 ? (p.vertFt / p.horizNm).toFixed(0) : "",
          p.critical,
          bothArr,
          p.a.assignedRunway && p.b.assignedRunway ? p.a.assignedRunway === p.b.assignedRunway : "",
        ].join(",") + "\n",
      );
    }
  }

  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  const critByCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  let lookahead = 0;
  let suppressed = 0;
  for (const a of alerts) {
    if (a.suppressedBy) suppressed++;
    if (a.severity in bySeverity) bySeverity[a.severity]++;
    if (a.category in byCategory) byCategory[a.category]++;
    if (a.severity === "critical" && a.category in critByCategory) critByCategory[a.category]++;
    if (a.lookaheadMin) lookahead++;
  }

  // Alert turnover against this airport's previous snapshot. ctx.prevAlertIds
  // holds the ids emitted last snapshot and ctx.goneAlertIds those that
  // vanished the snapshot before, so a return after exactly one absence is
  // detectable. Cadence matters when reading these: this harness polls each
  // airport about every 90 seconds, while the lifecycle's three-tick grace
  // assumes a 20-second poll, so a flicker here is a coarser event than the
  // one the layer smooths.
  const alertIds = new Set(alerts.map((a) => a.id));
  const prevIds = ctx.prevAlertIds ?? new Set();
  const goneIds = ctx.goneAlertIds ?? new Set();
  let newCount = 0;
  let returnedCount = 0;
  for (const id of alertIds) {
    if (prevIds.has(id)) continue;
    newCount++;
    if (goneIds.has(id)) returnedCount++;
  }
  const goneNow = new Set([...prevIds].filter((id) => !alertIds.has(id)));
  ctx.goneAlertIds = goneNow;
  ctx.prevAlertIds = alertIds;

  const row = {
    timestamp_utc: now.toISOString(),
    airport: ctx.code,
    n_contacts: contacts,
    n_flights: flights.length,
    n_alerts_total: alerts.length,
    n_active: alerts.length - suppressed,
    n_suppressed: suppressed,
    n_lookahead: lookahead,
    n_alerts_new: newCount,
    n_alerts_gone: goneNow.size,
    n_alerts_returned: returnedCount,
    ...Object.fromEntries(SEVERITIES.map((s) => [`n_${s}`, bySeverity[s]])),
    ...Object.fromEntries(CATEGORIES.map((c) => [`n_${c.replace(/-/g, "_")}`, byCategory[c]])),
    ...Object.fromEntries(
      CATEGORIES.map((c) => [`n_crit_${c.replace(/-/g, "_")}`, critByCategory[c]]),
    ),
    n_wake_pairs: wakeStats.pairs,
    wake_margin_min: wakeStats.min,
    n_wake_margin_lt_m1: wakeStats.ltM1,
    n_wake_margin_m1_0: wakeStats.m1to0,
    n_wake_margin_0_1: wakeStats.zeroTo1,
    n_wake_candidates: bandStats.candidates,
    n_wake_band_excluded: bandStats.excluded,
    adm_gap_med_nm: bandStats.admGapMed,
    excl_gap_med_nm: bandStats.exclGapMed,
    n_adm_legal: bandStats.admLegal,
    n_excl_legal: bandStats.exclLegal,
    n_cwt_unmapped: bandStats.cwtUnmapped,
    wind_dir_deg: ctx.state.weather.windDirDeg,
    wind_kts: ctx.state.weather.windKts,
    gusts_kts: ctx.state.weather.gustsKts,
    visibility_nm: ctx.state.weather.visibilityNm,
    ceiling_ft: ctx.state.weather.ceilingFt,
    wx_condition: ctx.state.weather.condition,
    wx_observed_for: ctx.state.weatherObservedFor ?? "",
    wx_condition_observed:
      ctx.state.weather.conditionObserved === undefined
        ? ""
        : String(ctx.state.weather.conditionObserved),
  };
  await appendFile(ctx.out, `${COLUMNS.map((c) => row[c]).join(",")}\n`);
  ctx.written.push(row);

  process.stdout.write(
    `\r[${ctx.code} #${ctx.state.tick}] flights=${String(flights.length).padStart(3)} ` +
      `alerts=${String(alerts.length).padStart(3)} ` +
      `crit=${bySeverity.critical} warn=${bySeverity.warning} adv=${bySeverity.advisory} ` +
      `wx=${ctx.state.weather.condition}    `,
  );
};

while (Date.now() < endAt) {
  for (const ctx of contexts) {
    if (Date.now() >= endAt) break;
    const t0 = Date.now();
    try {
      await sampleOne(ctx);
    } catch (e) {
      console.warn(`\n[fp-analysis] ${ctx.code} snapshot failed: ${e.message}`);
    }
    const sleepMs = Math.max(0, INTERVAL_SEC * 1000 - (Date.now() - t0));
    if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs));
  }
}

for (const ctx of contexts) {
  summarise(ctx.written, ctx.out);
  console.log(`CSV at ${ctx.out}`);
}
