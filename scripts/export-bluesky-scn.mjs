#!/usr/bin/env node
/**
 * Export every scenario to a BlueSky .SCN file, so the corpus can be replayed
 * in a simulator the ATM research community already recognises (Hoekstra and
 * Ellerbroek, "BlueSky ATC Simulator Project", ICRAT 2016; MIT-licensed,
 * github.com/TUDelft-CNS-ATM/bluesky).
 *
 * What is preserved: each aircraft's callsign, ICAO type, position, heading,
 * altitude and speed at the scenario's initial instant, placed at real-world
 * coordinates via the scenario airport's reference point. What is NOT
 * preserved: this project's detector semantics. BlueSky replays the traffic
 * picture; the claim a reviewer can check there is that the encoded geometry
 * is what the scenario says it is, not that BlueSky's own conflict logic
 * agrees with the detector population.
 *
 * Approximations, stated rather than hidden:
 * - Scenario positions are ARP-relative nautical miles on a flat local frame;
 *   the export inverts the same equirectangular conversion the live ingest
 *   uses, so round-trip error is far below the geometry the scenarios encode.
 * - speedKts is treated as calibrated airspeed in the CRE command. At the
 *   altitudes involved (mostly below 16,000 ft) the CAS/GS gap is small
 *   against the scenarios' speed semantics, which are themselves nominal.
 * - Centre-scale reconstructions (ZMA, ZNY) anchor to the nearest airport's
 *   reference point; relative geometry is exact, absolute placement is not.
 * - Aircraft with type UNKN (facts the source record does not state) export
 *   as B738 for BlueSky's performance model, with a comment on the line
 *   saying so; the detector-side encoding keeps UNKN.
 *
 * Usage:
 *   node scripts/export-bluesky-scn.mjs            # writes bluesky/*.scn
 *   node scripts/export-bluesky-scn.mjs --verify   # regenerates and diffs
 */
// Run with the repo's tsx, as every script here is:
//   ./node_modules/.bin/tsx scripts/export-bluesky-scn.mjs
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const { SCENARIOS } = await import("../src/sim/scenarios.ts");
const { AIRPORTS } = await import("../src/sim/airports.ts");

// Reference points for scenario airports outside the live registry, WGS-84.
// Source: OurAirports airports.csv (public domain), fetched 2026-08-24.
const EXTRA_ARP = {
  GCXO: { lat: 28.482752, lon: -16.341707 }, // Los Rodeos / Tenerife Norte
  LIML: { lat: 45.445099, lon: 9.27674 },
  KDCA: { lat: 38.8521, lon: -77.037697 },
  KLGA: { lat: 40.777199, lon: -73.872597 },
  KLEX: { lat: 38.035066, lon: -84.606738 },
  KEWR: { lat: 40.6894, lon: -74.170545 },
  KIAH: { lat: 29.9844, lon: -95.3414 },
  // Centre-scale reconstructions anchor to the nearest registry airport.
  ZMA: { lat: 25.796011, lon: -80.289751 }, // KMIA
  ZNY: { lat: 40.6398, lon: -73.7789 }, // KJFK
};

const arpFor = (sectorId) => {
  const icao = sectorId.split(" ")[0];
  return AIRPORTS[icao]?.arp ?? EXTRA_ARP[icao] ?? null;
};

const NM_PER_DEG_LAT = 60;
const toLatLon = (pos, arp) => {
  const lat = arp.lat - pos.y / NM_PER_DEG_LAT;
  const lon = arp.lon + pos.x / (NM_PER_DEG_LAT * Math.cos((arp.lat * Math.PI) / 180));
  return { lat, lon };
};

const scnFor = (scenario) => {
  const state = scenario.build();
  const arp = arpFor(state.sectorId);
  if (!arp) throw new Error(`no reference point for sector "${state.sectorId}"`);
  const lines = [
    `# ${scenario.name}`,
    `# ${scenario.brief}`,
    `# Exported from the ATC prototype scenario "${scenario.id}" by`,
    `# scripts/export-bluesky-scn.mjs. Regenerate rather than edit.`,
    `00:00:00.00>PAN ${arp.lat.toFixed(6)},${arp.lon.toFixed(6)}`,
    `00:00:00.00>ZOOM 2`,
  ];
  for (const f of state.flights) {
    const { lat, lon } = toLatLon(f.positionNm, arp);
    const unknownType = !f.aircraft || f.aircraft === "UNKN";
    const type = unknownType ? "B738" : f.aircraft;
    // The provenance note goes on its own line. It was a trailing comment on
    // the CRE line until 2026-09-01, which reads fine and is not what BlueSky
    // parses: the scenario format takes everything after the ">" as the
    // command, and only a whole line beginning with "#" is a comment, so the
    // note landed inside the speed argument of the two aircraft that carry it.
    // Those two would not have been created by a reader who ran the file.
    if (unknownType) {
      lines.push(
        `# ${f.callsign}: type not stated in the source record; B738 for the performance model only`,
      );
    }
    lines.push(
      `00:00:00.00>CRE ${f.callsign},${type},${lat.toFixed(6)},${lon.toFixed(6)},` +
        `${Math.round(f.headingDeg ?? 0)},${Math.round(f.altitudeFt)},${Math.round(f.speedKts)}`,
    );
  }
  lines.push("00:00:00.00>HOLD");
  return lines.join("\n") + "\n";
};

const OUT_DIR = new URL("../bluesky/", import.meta.url).pathname;
const VERIFY = process.argv.includes("--verify");
mkdirSync(OUT_DIR, { recursive: true });

let wrote = 0;
let drift = [];
for (const scenario of SCENARIOS) {
  const path = join(OUT_DIR, `${scenario.id}.scn`);
  const content = scnFor(scenario);
  if (VERIFY) {
    const existing = readFileSync(path, "utf8");
    if (existing !== content) drift.push(scenario.id);
  } else {
    writeFileSync(path, content);
    wrote++;
  }
}
if (VERIFY) {
  if (drift.length) {
    console.error(`DRIFT: ${drift.join(", ")} differ from their scenarios; regenerate`);
    process.exit(1);
  }
  console.log(`verified: all ${SCENARIOS.length} .scn files match their scenarios`);
} else {
  console.log(`wrote ${wrote} .scn files to bluesky/`);
  const stray = readdirSync(OUT_DIR).filter((f) => f.endsWith(".scn"))
    .filter((f) => !SCENARIOS.some((s) => `${s.id}.scn` === f));
  if (stray.length) console.warn(`stray files not matching any scenario: ${stray.join(", ")}`);
}
