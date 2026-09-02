#!/usr/bin/env node
/**
 * Watch METARs at the US registry airports and launch a sampling window when
 * IMC appears.
 *
 * Why this exists: the visual-separation finding (JO 7110.65 7-2-1, see
 * docs/wake-residual-open.md) predicts a lower wake-violation rate under IMC,
 * where visual approaches stop and the radar minima genuinely bind. Both
 * completed windows were essentially all-VFR (two MVFR snapshots in 1,823),
 * so the prediction is untested, and IMC at a measured field is a matter of
 * waiting for weather rather than of scheduling. This script does the
 * waiting.
 *
 * Usage:
 *   node scripts/imc-watch.mjs            # single check; launches if IMC
 *   node scripts/imc-watch.mjs --loop     # re-check every 20 min until launch
 *   node scripts/imc-watch.mjs --dry-run  # report, never launch
 *
 * A launched window samples ONLY the airports reporting IFR/LIFR, tagged
 * imc-<UTC timestamp>, with both per-pair dumps on, so imc-pool.py can read
 * the result directly.
 *
 * Two design corrections after the first firing, 2026-08-24. Boston went IFR,
 * the watcher launched a 12-hour window, and the IFR condition cleared within
 * about eighty minutes: 55 instrument-condition snapshots out of 1,431, and
 * no wake pairs at all. Twelve hours was the wrong length for two reasons.
 * It dilutes the window, which matters less than it looks because the pooler
 * filters by condition anyway. And it BLOCKS the next IMC event for twelve
 * hours, because the watcher refuses to launch while a sampler runs, which
 * matters a great deal: the contrast needs many short events, not one long
 * window. Windows are now four hours, and the watcher re-arms instead of
 * exiting, so a second front the same day is sampled rather than missed.
 *
 * It still refuses to launch while another fp-analysis process is running.
 * Caveat that has burned this project twice: a laptop that sleeps kills the
 * window; run under `caffeinate -s` for anything unattended.
 */
import { execSync, spawn } from "node:child_process";
import { appendFileSync } from "node:fs";

const AIRPORTS = ["KATL", "KORD", "KDFW", "KJFK", "KLAX", "KSFO", "KSEA", "KBOS", "KMIA", "KDEN"];
const LOOP = process.argv.includes("--loop");
const DRY = process.argv.includes("--dry-run");
const CHECK_EVERY_MIN = 20;
// Four hours rather than twelve: short enough that a second IMC event the
// same day is not blocked by the first window still running.
const WINDOW_HOURS = 4;
const LOG = "data/imc-watch.log";

const log = (msg) => {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    appendFileSync(LOG, line + "\n");
  } catch {
    /* logging must never kill the watcher */
  }
};

const fetchFlightCategories = async () => {
  const url = `https://aviationweather.gov/api/data/metar?ids=${AIRPORTS.join(",")}&format=json`;
  const res = await fetch(url, { headers: { "user-agent": "atc-prototype-imc-watch" } });
  if (!res.ok) throw new Error(`aviationweather.gov ${res.status}`);
  const metars = await res.json();
  return metars.map((m) => ({ icao: m.icaoId, cat: m.fltCat ?? "UNKN" }));
};

/**
 * Airports already being sampled by a running fp-analysis process, read from
 * its command line. Returns null when nothing is running.
 *
 * The guard this replaces refused to launch whenever ANY sampler was running,
 * and that cost the study its scarcest resource. Measured 2026-08-25: the log
 * held eleven refusals, and one of them was San Francisco reporting IFR while
 * a three-airport window at Atlanta, O'Hare and Dallas Fort Worth had two
 * hours left to run. Instrument conditions at a sampled field are rare enough
 * that 55 snapshots had accumulated across a month of sampling; declining them
 * to protect a window that shares no airport with them is the wrong trade.
 *
 * The remaining reason for caution is real but smaller: both upstream feeds
 * rate-limit by source IP, so a second sampler adds load even on a different
 * airport. That is bounded rather than avoided, by launching only for airports
 * the running window does not cover and by polling the IMC window more slowly.
 * The failure mode if it goes wrong is a throttled feed, which the harness
 * already records as a failed snapshot rather than fabricating data.
 */
const samplerAirports = () => {
  // `ps -Ao args=` rather than pgrep, for two reasons found by testing this on
  // the machine it runs on. macOS pgrep ignores -a and prints bare pids, so an
  // args regex silently matched nothing and the guard passed everything. And
  // pgrep -fl matches this watcher's own supervising shell when that shell's
  // command line happens to contain the sampler's name, which is a phantom
  // sampler. Requiring an --airports= flag on the line excludes both.
  try {
    const out = execSync("ps -Ao args=", { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    const covered = new Set();
    for (const line of out.split("\n")) {
      if (!line.includes("fp-analysis.mjs")) continue;
      const m = line.match(/--airports=([A-Z,]+)/);
      if (!m) continue;
      for (const a of m[1].split(",")) covered.add(a);
    }
    return covered.size > 0 ? covered : null;
  } catch {
    return null;
  }
};

// A second sampler polls more slowly, so the added load on the shared upstream
// feeds stays modest while an instrument-condition event is being captured.
const IMC_INTERVAL_SEC = 60;

const launch = (imcAirports) => {
  // Timestamped to the minute, not the day: a second event on the same date
  // would otherwise append to the first window's files and mix two samples
  // under one tag.
  const tag = `imc-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}`;
  const args = [
    "scripts/fp-analysis.mjs",
    `--airports=${imcAirports.join(",")}`,
    `--hours=${WINDOW_HOURS}`,
    `--interval=${IMC_INTERVAL_SEC}`,
    `--tag=${tag}`,
    `--dump-pairs=data/pairs-${tag}.csv`,
    `--dump-prox=data/prox-${tag}.csv`,
  ];
  const child = spawn("./node_modules/.bin/tsx", args, {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  });
  child.unref();
  log(`LAUNCHED ${tag} at ${imcAirports.join(",")} for ${WINDOW_HOURS}h (pid ${child.pid}); ` +
      `analyse with: python3 scripts/imc-pool.py ${tag} (after adding it to CORRECTED_WINDOWS)`);
};

const checkOnce = async () => {
  const cats = await fetchFlightCategories();
  const imc = cats.filter((c) => c.cat === "IFR" || c.cat === "LIFR").map((c) => c.icao);
  log(cats.map((c) => `${c.icao}:${c.cat}`).join(" "));
  if (imc.length === 0) return false;
  const covered = samplerAirports();
  if (covered) {
    const fresh = imc.filter((a) => !covered.has(a));
    if (fresh.length === 0) {
      log(`IMC at ${imc.join(",")} but a sampler already covers those airports; not launching`);
      return false;
    }
    if (fresh.length !== imc.length) {
      log(`IMC at ${imc.join(",")}; ${fresh.join(",")} not already sampled`);
    }
    imc.length = 0;
    imc.push(...fresh);
  }
  if (DRY) {
    log(`IMC at ${imc.join(",")}; dry run, not launching`);
    return true;
  }
  launch(imc);
  return true;
};

const main = async () => {
  do {
    try {
      const launched = await checkOnce();
      // Re-arm rather than exit. The contrast this watcher serves needs many
      // instrument-condition events accumulated across windows, and the first
      // firing showed why: one event supplied eighty minutes of IMC and no
      // wake pairs at all.
      if (launched && !LOOP) return;
    } catch (e) {
      log(`check failed: ${e.message}`);
    }
    if (LOOP) await new Promise((r) => setTimeout(r, CHECK_EVERY_MIN * 60 * 1000));
  } while (LOOP);
};

await main();
