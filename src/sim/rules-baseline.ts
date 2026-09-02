// Monolithic baseline implementation of the rule set for Section 6.9 comparison.
//
// Same `SimState -> Alert[]` contract as the orchestrated population in `rules.ts`,
// but every doctrine is inlined into a single function. The architectural claim of
// Section 3 is that the orchestrated population is more maintainable — not necessarily
// more accurate. This file exists so the two can be compared on the same scenarios
// against the same data feed.
//
// Maintenance metric the baseline is designed to expose:
//   • a doctrinal change (e.g., FAA revises the wake matrix) requires editing
//     a specific block of this single function rather than a single self-contained
//     detector file.
//
// Behavioural equivalence is intentionally close to but not bit-identical with the
// orchestrated population, mirroring how a monolith naturally drifts as it grows.

import type { Alert, Flight, Runway, SimState } from "./types";
import type { CwtCategory } from "./types-cwt";
import { cwtFromType } from "./cwt-lookup";

// FAA Consolidated Wake Turbulence on-approach minima, NM, [leader][follower];
// JO 7110.65 5-5-4 TBL 5-5-2, null where the table is blank and radar
// separation governs. Mirrors CWT_ON_APPROACH in rules.ts. Same revision as
// rules.ts: the monolith gets the identical doctrine, or the architectural
// comparison measures a doctrine difference rather than a structural one.
const CWT_ON_APPROACH: Record<CwtCategory, Record<CwtCategory, number | null>> = {
  A: { A: null, B: 5, C: 6, D: 6, E: 7, F: 7, G: 7, H: 8, I: 8 },
  B: { A: null, B: 3, C: 4, D: 4, E: 5, F: 5, G: 5, H: 5, I: 6 },
  C: { A: null, B: null, C: null, D: null, E: 3.5, F: 3.5, G: 3.5, H: 5, I: 6 },
  D: { A: null, B: 3, C: 4, D: 4, E: 5, F: 5, G: 5, H: 6, I: 6 },
  E: { A: null, B: null, C: null, D: null, E: null, F: null, G: null, H: null, I: 4 },
  F: { A: null, B: null, C: null, D: null, E: null, F: null, G: null, H: null, I: 4 },
  G: { A: null, B: null, C: null, D: null, E: null, F: null, G: null, H: null, I: null },
  H: { A: null, B: null, C: null, D: null, E: null, F: null, G: null, H: null, I: null },
  I: { A: null, B: null, C: null, D: null, E: null, F: null, G: null, H: null, I: null },
};
const RADAR_MIN_NM = 3;
const RADAR_MIN_FINAL_NM = 2.5;
const REDUCED_MIN_RANGE_NM = 10;

const WAKE_VERTICAL_BAND_FT = 1000;

const headingDelta = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

// Live ADS-B assigns a single runway END ("04L") while the registry stores paired
// strips ("04L/22R"), so a bare id comparison never matches on live data. The
// monolith gets the same predicate as rules.ts: the doctrine must be identical
// on both sides or the architectural comparison measures a bug fix instead.
const runwayHasEnd = (runway: Runway, designator: string | undefined): boolean => {
  if (!designator) return false;
  if (runway.id === designator) return true;
  return runway.id.split("/").includes(designator);
};

const runwayEndHeading = (runway: Runway, designator: string): number => {
  const ends = runway.id.split("/");
  return ends.length > 1 && ends[1] === designator
    ? (runway.headingDeg + 180) % 360
    : runway.headingDeg;
};

// DO NOT "fix" the true-versus-magnetic mismatch here, in this function or in
// the alignment gate above it. Both carry the same units error the detector
// population carried until 2026-09-01, and both keep it deliberately: this
// file is the frozen monolith the population is measured against, and a
// correctness change on one side of that comparison would be reported as an
// architectural difference.
//
// The question that raises, whether fixing the population and not the baseline
// biases the published comparison, was checked rather than argued: the
// comparison runs on the scenario corpus, and no scenario runway carries a
// true course, so on that corpus both sides read the magnetic value through
// the same fallback and neither moved. If a scenario ever gains surveyed
// geometry, that stops being true and this note is where to start.
const crosswindKts = (windDir: number, windKts: number, runwayHdg: number): number => {
  const angle = headingDelta(windDir, runwayHdg);
  return Math.abs(windKts * Math.sin((angle * Math.PI) / 180));
};

export const runBaselineRules = (state: SimState): Alert[] => {
  const alerts: Alert[] = [];

  // Group flights by runway for the runway-conflict and wake-spacing rules.
  const grouped: Record<string, Flight[]> = {};
  for (const f of state.flights) {
    if (!f.assignedRunway) continue;
    if (f.phase === "landed" || f.phase === "departed" || f.phase === "at-gate") continue;
    grouped[f.assignedRunway] = grouped[f.assignedRunway] ?? [];
    grouped[f.assignedRunway].push(f);
  }

  for (const [rwy, flights] of Object.entries(grouped)) {
    // wake-spacing. Distance-based on final, same revision as rules.ts; the
    // monolith must also filter by approach phase, skip followers above the
    // vortex band, and compute in-trail distance, all inline here.
    // Established-on-final gate, same revision as rules.ts: phase alone admits
    // downwind and base legs, whose cross-track offset carries no in-trail
    // meaning. The monolith repeats the runway lookup and the heading test
    // inline for each block that needs them.
    const runwayForWake = state.runways.find((r) => runwayHasEnd(r, rwy));
    const wakeFinalHdg =
      runwayForWake === undefined ? undefined : runwayEndHeading(runwayForWake, rwy);
    const arrivals = flights
      .filter(
        (f) =>
          f.type === "arrival" &&
          (f.phase === "approach" || f.phase === "final") &&
          wakeFinalHdg !== undefined &&
          headingDelta(f.headingDeg, wakeFinalHdg) <= 30,
      )
      .sort((a, b) => a.etaMin - b.etaMin);
    for (let i = 1; i < arrivals.length; i++) {
      const lead = arrivals[i - 1];
      const trail = arrivals[i];
      if (trail.altitudeFt - lead.altitudeFt > WAKE_VERTICAL_BAND_FT) continue;
      const gap = Math.hypot(
        lead.positionNm.x - trail.positionNm.x,
        lead.positionNm.y - trail.positionNm.y,
      );
      // The monolith repeats the wake-or-radar decision inline, as it repeats
      // every other shared rule.
      const leadCat = cwtFromType(lead.aircraft);
      const trailCat = cwtFromType(trail.aircraft);
      const wakeMin = leadCat && trailCat ? CWT_ON_APPROACH[leadCat][trailCat] : null;
      const required =
        wakeMin !== null
          ? wakeMin
          : [lead, trail].every(
                (f) =>
                  (f.phase === "final" || f.phase === "approach") &&
                  Math.hypot(f.positionNm.x, f.positionNm.y) <= REDUCED_MIN_RANGE_NM,
              )
            ? RADAR_MIN_FINAL_NM
            : RADAR_MIN_NM;
      if (gap < required) {
        // Same revision as rules.ts: in visual conditions a violation of the
        // radar floor (no stated wake minimum) caps at warning, because the
        // trailing pilot may hold visual separation, which voids the minimum
        // and is unobservable from surveillance.
        const vmc = state.weather.condition === "VFR" || state.weather.condition === "MVFR";
        const demoted = vmc && wakeMin === null;
        alerts.push({
          id: `wake-${rwy}-${lead.id}-${trail.id}`,
          severity: demoted ? "warning" : gap < required - 1 ? "critical" : "warning",
          category: "wake-spacing",
          title: `${trail.callsign} too close behind ${lead.callsign} on ${rwy}`,
          detail: `In-trail ${gap.toFixed(1)} NM, ${required} NM required for ${lead.aircraft} (CWT ${leadCat ?? "?"}) → ${trail.aircraft} (CWT ${trailCat ?? "?"})`,
          flightIds: [lead.id, trail.id],
          reason: `Wake separation rule.`,
          suggestedAction: `Vector trailing aircraft; consider re-sequencing.`,
          createdAtTick: state.tick,
        });
      }
    }

    // runway-conflict (arr+dep overlap)
    const arrFinal = flights.filter((f) => f.type === "arrival" && f.phase === "final");
    const depQueued = flights.filter(
      (f) => f.type === "departure" && (f.phase === "queued" || f.phase === "taxi-out"),
    );
    if (arrFinal.length > 0 && depQueued.length > 0) {
      alerts.push({
        id: `rwy-mix-${rwy}`,
        severity: "warning",
        category: "runway-conflict",
        title: `${rwy} arrival + departure overlap`,
        detail: `${arrFinal[0].callsign} final, ${depQueued[0].callsign} on runway`,
        flightIds: [arrFinal[0].id, depQueued[0].id],
        reason: `Runway cannot host overlapping clearances.`,
        suggestedAction: `Hold departure; route arrival to alternate runway.`,
        createdAtTick: state.tick,
      });
    }
    if (depQueued.length >= 2) {
      alerts.push({
        id: `rwy-multi-dep-${rwy}`,
        severity: "critical",
        category: "runway-conflict",
        title: `${rwy} multiple aircraft on runway`,
        detail: `${depQueued.map((f) => f.callsign).join(", ")}`,
        flightIds: depQueued.map((f) => f.id),
        reason: `Multiple aircraft on the same runway.`,
        suggestedAction: `Halt takeoff clearances; confirm positions.`,
        createdAtTick: state.tick,
      });
    }
    // Multiple-arrivals-on-final critical removed; see the note in rules.ts.
  }

  // gate-conflict
  const incomingByGate: Record<string, Flight[]> = {};
  for (const f of state.flights) {
    if (f.type !== "arrival" || !f.assignedGate) continue;
    if (f.phase === "landed" || f.phase === "at-gate") continue;
    incomingByGate[f.assignedGate] = incomingByGate[f.assignedGate] ?? [];
    incomingByGate[f.assignedGate].push(f);
  }
  for (const gate of state.gates) {
    const incoming = incomingByGate[gate.id] ?? [];
    if (gate.occupiedBy && incoming.length > 0) {
      const earliest = incoming.sort((a, b) => a.etaMin - b.etaMin)[0];
      if (earliest.etaMin < 15) {
        alerts.push({
          id: `gate-${gate.id}-${earliest.id}`,
          severity: earliest.etaMin < 5 ? "critical" : "warning",
          category: "gate-conflict",
          title: `Gate ${gate.id} occupied, ${earliest.callsign} inbound`,
          detail: `Occupied by ${gate.occupiedBy}; ${earliest.etaMin.toFixed(0)} min out`,
          flightIds: [earliest.id],
          reason: `Gate blocked.`,
          suggestedAction: `Reassign arrival or push occupant.`,
          createdAtTick: state.tick,
        });
      }
    }
  }

  // fuel-hold
  for (const f of state.flights) {
    if (f.type !== "arrival") continue;
    if (f.phase === "landed" || f.phase === "at-gate") continue;
    const reserve = f.etaMin + 45;
    if (f.fuelMin < reserve) {
      alerts.push({
        id: `fuel-${f.id}`,
        severity: f.fuelMin < f.etaMin + 15 ? "critical" : "warning",
        category: "fuel-hold",
        title: `${f.callsign} low fuel`,
        detail: `${f.fuelMin.toFixed(0)} min remaining, ${f.etaMin.toFixed(0)} ETA + 45 reserve`,
        flightIds: [f.id],
        reason: `14 CFR §91.167.`,
        suggestedAction: `Prioritise for direct approach.`,
        createdAtTick: state.tick,
      });
    }
  }

  // crosswind
  const CW_LIMIT = 25;
  for (const r of state.runways) {
    if (r.mode === "closed") continue;
    const cw = crosswindKts(
      state.weather.windDirDeg,
      Math.max(state.weather.windKts, state.weather.gustsKts),
      r.headingDeg,
    );
    if (cw > CW_LIMIT) {
      const using = state.flights.filter((f) => runwayHasEnd(r, f.assignedRunway));
      alerts.push({
        id: `cw-${r.id}`,
        severity: cw > CW_LIMIT + 5 ? "critical" : "warning",
        category: "crosswind",
        title: `Crosswind ${cw.toFixed(0)} kts on ${r.id}`,
        detail: `Wind ${state.weather.windDirDeg}°/${state.weather.windKts}G${state.weather.gustsKts}`,
        flightIds: using.map((f) => f.id),
        reason: `Type-certificate crosswind limit.`,
        suggestedAction: `Switch runway aligned with wind.`,
        createdAtTick: state.tick,
      });
    }
  }

  // runway-surface (added in the Section 6.9 doctrinal-change drill; same rule
  // as detectRunwaySurface in rules.ts, inlined here). Note the block must
  // reuse this function's existing iteration conventions and avoid colliding
  // with the crosswind block's `r` loop variable scope above — the composition
  // cost the drill measures.
  const SURFACE_SEVERITY: Record<string, "advisory" | "warning"> = {
    wet: "advisory",
    snow: "warning",
    ice: "warning",
  };
  for (const r of state.runways) {
    if (r.mode === "closed") continue;
    const severity = SURFACE_SEVERITY[r.surfaceFriction];
    if (!severity) continue;
    const usingSurface = state.flights.filter(
      (f) =>
        runwayHasEnd(r, f.assignedRunway) &&
        f.phase !== "landed" &&
        f.phase !== "at-gate" &&
        f.phase !== "departed",
    );
    if (usingSurface.length === 0) continue;
    alerts.push({
      id: `surface-${r.id}`,
      severity,
      category: "runway-surface",
      title: `${r.id} surface ${r.surfaceFriction} with traffic assigned`,
      detail: `${usingSurface.length} aircraft assigned to ${r.id}; braking action degraded`,
      flightIds: usingSurface.map((f) => f.id),
      reason: `A ${r.surfaceFriction} surface extends landing roll and degrades braking action; arrivals must be briefed and spacing widened.`,
      suggestedAction:
        severity === "warning"
          ? `Request a braking-action report from the next arrival; consider switching operations to a treated runway.`
          : `Brief arrivals on the ${r.surfaceFriction} surface; expect longer occupancy per landing.`,
      createdAtTick: state.tick,
      runwayId: r.id,
    });
  }

  // cascading-delay
  const arrivalsSoon = state.flights.filter(
    (f) => f.type === "arrival" && f.etaMin < 30 && f.phase !== "landed" && f.phase !== "at-gate",
  );
  const buckets: Record<string, number> = {};
  for (const f of arrivalsSoon) {
    if (!f.assignedRunway) continue;
    const bucket = `${f.assignedRunway}-${Math.floor(f.etaMin / 5)}`;
    buckets[bucket] = (buckets[bucket] ?? 0) + 1;
  }
  for (const [bucket, count] of Object.entries(buckets)) {
    if (count >= 3) {
      const [rwy] = bucket.split("-");
      alerts.push({
        id: `cascade-${bucket}`,
        severity: "advisory",
        category: "cascading-delay",
        title: `${count} arrivals stacking on ${rwy}`,
        detail: `Throughput exceeded.`,
        flightIds: arrivalsSoon.filter((f) => f.assignedRunway === rwy).map((f) => f.id),
        reason: `Compressed sequencing.`,
        suggestedAction: `Speed-control inbound stream.`,
        createdAtTick: state.tick,
      });
    }
  }

  // proximity-conflict
  const active = state.flights.filter(
    // Same revision as rules.ts: airborne departures are included, since
    // "departed" here means climbing out rather than gone, and excluding them
    // removed the whole departure population from proximity detection.
    (f) => f.phase !== "at-gate" && f.altitudeFt > 0,
  );
  const seen = new Set<string>();
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      const horizNm = Math.hypot(a.positionNm.x - b.positionNm.x, a.positionNm.y - b.positionNm.y);
      const vertFt = Math.abs(a.altitudeFt - b.altitudeFt);
      if (horizNm < 2 && vertFt < 1000) {
        const key = [a.id, b.id].sort().join("-");
        if (seen.has(key)) continue;
        seen.add(key);
        const critical = horizNm < 0.5 && vertFt < 200;
        // Same revision as rules.ts: a non-converging pair on distinct
        // parallel runways demotes to advisory. The monolith's critical test
        // is a distance box rather than tau, so "not critical" stands in for
        // "not converging" here, which is the monolith being the monolith.
        const pa = a.assignedRunway;
        const pb = b.assignedRunway;
        const na = pa ? Number.parseInt(pa.match(/\d+/)?.[0] ?? "", 10) : Number.NaN;
        const nb = pb ? Number.parseInt(pb.match(/\d+/)?.[0] ?? "", 10) : Number.NaN;
        const parallel =
          !critical && !!pa && !!pb && pa !== pb && !Number.isNaN(na) && !Number.isNaN(nb) &&
          Math.min(Math.abs(na - nb), 36 - Math.abs(na - nb)) <= 1;
        alerts.push({
          id: `prox-${key}`,
          severity: critical ? "critical" : parallel ? "advisory" : "warning",
          category: "proximity-conflict",
          title: `${a.callsign} and ${b.callsign} converging`,
          detail: `${horizNm.toFixed(1)} NM / ${Math.round(vertFt)} ft`,
          flightIds: [a.id, b.id],
          reason: `TCAS RA threshold approximation.`,
          suggestedAction: `Issue vector or altitude change.`,
          createdAtTick: state.tick,
        });
      }
    }
  }

  return alerts;
};
