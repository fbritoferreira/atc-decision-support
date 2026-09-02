// Tests for the properties the thesis asserts about the detector population.
//
// Each block below corresponds to a claim in the write-up, so that a claim
// cannot quietly stop being true. Where a claim was found to be false, the test
// pins the ACTUAL behaviour and is labelled as such, rather than being written
// to fail; the write-up has been corrected to match.

import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
// The smoothing tests below annotate their fixtures with this. vitest
// transpiles without type checking, so the suite passed for a while with the
// name unbound and only `tsc --noEmit` said so.
import type { Flight } from "./types";
import { SQUAWK_CODES } from "./squawk-codes";
import { RUNWAY_ENDS } from "./runway-ends-data";
import { paletteByIndex } from "./runway-colors";
import { updateTrails } from "./trails";
import { liveReducer } from "./live-store";
import { wakeFromType } from "./wake-lookup";
import { tick } from "./engine";
import { fetchRoute } from "./live-routes";
import { lowestCloudFt, parsePrecipitation, parseVis } from "./live-weather";
import { headingSpread } from "./heading-consistency";
import {
  ALERT_GRACE_TICKS,
  activeAlerts,
  reconcileAlerts,
  type TrackedAlert,
} from "./lifecycle";
import { projectState, runPredictiveRules, demoteForHorizon } from "./predict";
import { AIRPORTS } from "./airports";
import { fetchLiveTrafficDetailed, phaseFromAlt } from "./live-adsb";
import { fetchAirportWeather } from "./live-weather";
import { smoothEtas, ETA_SMOOTHING_ALPHA } from "./smoothing";
import {
  airportEndGeometries,
  alongTrackToThresholdNm,
  crossTrackToEndNm,
  runwaysWithTrueCourse,
} from "./runway-geometry";
import { inferRunway } from "./runway-infer";
import { runBaselineRules } from "./rules-baseline";
import {
  applySuppression,
  runAllRules,
  proximityCandidatePairs,
  proximityPairs,
  wakeCandidatePairs,
  wakeMinimumNm,
  wakeGapMargins,
} from "./rules";
import { cwtFromType } from "./cwt-lookup";
import { SCENARIOS } from "./scenarios";
import type { Alert, SimState } from "./types";

// Kept beside the claims check below, which quotes it to the papers, so every
// published test count rests on this number being right.
//
// It cannot be measured from inside the suite it counts without recursion, so
// it is hand-maintained and checked from outside by
// scripts/check-test-count.mjs, which runs the suite with the JSON reporter and
// compares. Until 2026-08-29 this comment claimed it was "asserted against the
// suite's own reported total in CI" and no such assertion existed anywhere:
// forgetting to bump it after adding a test would have had the claim checker
// confirm the papers against a stale number and report no problem.
const TOTAL_TESTS = 320;

const byId = (id: string): SimState => {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown scenario: ${id}`);
  return s.build();
};

const INCIDENTS = [
  "incident-tenerife-1977",
  "incident-avianca052-1990",
  "incident-lax-1991",
  "incident-linate-2001",
  "incident-dca-2025",
  "incident-lga-2025",
  "incident-jfk-2026",
  "incident-comair5191-2006",
] as const;

const categories = (alerts: Alert[]) => new Set(alerts.map((a) => a.category));

// Section 4.1: determinism. Same input state, same alerts, every time.
describe("determinism (Section 4.1)", () => {
  for (const s of SCENARIOS) {
    it(`${s.id} produces identical output across repeated runs`, () => {
      const a = runPredictiveRules(s.build());
      const b = runPredictiveRules(s.build());
      expect(a.map((x) => `${x.id}:${x.severity}`)).toEqual(
        b.map((x) => `${x.id}:${x.severity}`),
      );
    });
  }

  it("does not mutate the state it is given", () => {
    const state = byId("crisis");
    const before = JSON.stringify(state);
    runPredictiveRules(state);
    expect(JSON.stringify(state)).toEqual(before);
  });
});

// Section 6.3: every incident scenario must raise at least one alert, and the
// category the incident write-up names must be among them.
describe("historical incident corpus (Section 6.3)", () => {
  for (const id of INCIDENTS) {
    it(`${id} raises at least one alert`, () => {
      expect(runPredictiveRules(byId(id)).length).toBeGreaterThan(0);
    });
  }

  it("Tenerife raises a runway conflict", () => {
    expect(categories(runAllRules(byId("incident-tenerife-1977")))).toContain(
      "runway-conflict",
    );
  });

  it("Avianca 052 raises a fuel hold", () => {
    expect(categories(runAllRules(byId("incident-avianca052-1990")))).toContain(
      "fuel-hold",
    );
  });

  it("JFK 2026 raises a proximity conflict", () => {
    expect(categories(runAllRules(byId("incident-jfk-2026")))).toContain(
      "proximity-conflict",
    );
  });
});

// Section 6.8: the negative-control corpus. Six scenarios encoding safe
// resolutions and legal operations. None may produce a critical alert; this is
// the load-bearing safety property of the architecture, and the property the
// withdrawn Table 1 failed (218 miscounted proximity pairs).
describe("negative-control corpus (Section 6.8)", () => {
  const controls = SCENARIOS.filter((s) => s.id.startsWith("negative-control"));

  it("the corpus has eleven scenarios", () => {
    expect(controls).toHaveLength(11);
  });

  for (const s of controls) {
    it(`${s.id} emits no critical alert`, () => {
      const alerts = runPredictiveRules(s.build());
      expect(alerts.filter((a) => a.severity === "critical")).toHaveLength(0);
    });
  }

  // These encode fully legal operations and must be silent, not merely
  // sub-critical. A population that murmurs on legal traffic drowns its own
  // signal.
  for (const id of [
    "negative-control-converging-deps",
    "negative-control-staggered",
    "negative-control-wake-at-minimum",
    "negative-control-vfr-corridor",
    "negative-control-crosswind-ops",
    "negative-control-asrs-iah",
    "negative-control-asrs-zma",
  ]) {
    it(`${id} is completely silent`, () => {
      expect(runPredictiveRules(byId(id))).toHaveLength(0);
    });
  }

  // Silence proves nothing unless the doctrine saw the traffic and rejected
  // it on a stated axis. Measured 2026-08-18, six controls asserting silence
  // formed zero wake pairs. Audited again 2026-08-25 one level deeper: four
  // controls asserted silence while forming zero pairs of ANY kind, including
  // the two whose whole purpose is to prove a proximity gate rejects the
  // geometry. These tests assert the rejection, so a change that stops the
  // proximity walk reaching these aircraft fails here instead of reading as a
  // cleaner corpus.
  it("the VFR-corridor control is rejected by the vertical gate, not by never pairing", () => {
    const cands = proximityCandidatePairs(byId("negative-control-vfr-corridor"));
    expect(cands).toHaveLength(1);
    const [c] = cands;
    expect(c.withinHorizontal).toBe(true);
    expect(c.withinVertical).toBe(false);
    // The geometry the withdrawn Table 1 miscounted 218 times: 1.9 NM
    // laterally, 1,500 ft apart.
    expect(c.horizNm).toBeLessThan(2);
    expect(c.vertFt).toBeGreaterThanOrEqual(1000);
    expect(proximityPairs(byId("negative-control-vfr-corridor"))).toHaveLength(0);
  });

  // These two tests pinned a DEFECT until 2026-08-25 and now pin its fix. The
  // proximity walk used to drop every aircraft whose phase is `departed`,
  // which in this model means airborne and climbing out, so an airborne
  // departure was invisible to proximity detection
  // (docs/departure-proximity-blindspot.md). The exclusion is gone; these
  // assertions inverted when it went, which is what they were written for.
  it("the IAH control now forms a candidate pair, rejected by the vertical gate", () => {
    // ASRS CALLBACK Issue 461: a DEPARTURE level at 2,000 ft with traffic
    // crossing 1,000 ft overhead. The control was written to exercise the
    // 1,000 ft vertical boundary and, until the fix, was silent for an
    // unrelated reason: its departure never entered the walk. It now enters,
    // and the boundary does the rejecting, which is the assertion the control
    // was always meant to make.
    const state = byId("negative-control-asrs-iah");
    expect(state.flights.some((f) => f.phase === "departed")).toBe(true);
    const cands = proximityCandidatePairs(state);
    expect(cands).toHaveLength(1);
    const [c] = cands;
    expect(c.withinHorizontal).toBe(true);
    expect(c.vertFt).toBe(1000);
    expect(c.withinVertical).toBe(false);
    expect(runPredictiveRules(state)).toHaveLength(0);
  });

  it("the converging-departures control forms no candidate pair at all", () => {
    // One departure airborne (excluded by phase), one queued at zero altitude
    // (excluded by the altitude filter). This control has never exercised the
    // proximity doctrine, on any axis.
    expect(proximityCandidatePairs(byId("negative-control-converging-deps"))).toHaveLength(0);
  });

  it("the Potomac reconstruction no longer depends on its helicopter's phase", () => {
    // Before the fix this reconstruction detected its collision only because
    // PAT25 is encoded `enroute`; re-encoded as `departed`, which is what a
    // live feed supplies for a departing rotor, it emitted nothing on the
    // category the NTSB named. The alert must now survive that re-encoding,
    // which is the whole point of removing the exclusion.
    const state = byId("incident-dca-2025");
    const asDeparted: SimState = {
      ...state,
      flights: state.flights.map((f) =>
        f.type === "departure" ? { ...f, phase: "departed" as const } : f,
      ),
    };
    for (const [label, s] of [["as encoded", state], ["as departed", asDeparted]] as const) {
      const prox = runAllRules(s).filter((a) => a.category === "proximity-conflict");
      expect(prox.length, label).toBeGreaterThan(0);
    }
  });

  // The one control that is EXPECTED to fire, and the reason it was written.
  //
  // Two arrivals abreast on parallel runways at 4,300 ft, the FAA minimum for
  // simultaneous independent ILS approaches, is ordinary high-density
  // operations. The critical tier correctly stays silent: the convergence test
  // sees no closure between two parallel tracks, which is exactly why it was
  // added. The warning tier fires, because it is still a raw distance box and
  // 0.708 NM sits well inside 2 NM.
  //
  // The test pins the ACTUAL behaviour rather than the desired behaviour, in
  // the same way the earlier false claims were pinned. It is the deterministic
  // form of the live finding that proximity became the largest alert category
  // and rose 100 per cent per aircraft at O'Hare.
  it("the parallel-approach control raises no critical", () => {
    const alerts = runPredictiveRules(byId("negative-control-parallel-approach"));
    expect(alerts.filter((a) => a.severity === "critical")).toHaveLength(0);
  });

  it("the parallel-approach control raises an advisory, no longer the warning it used to pin", () => {
    // This test previously pinned the defect: a stable abreast pair on 28L
    // and 28R drew a proximity WARNING, the nuisance class ASRS CALLBACK
    // documents. Centreline attribution made runway identity trustworthy
    // enough to act on (measured: 71 per cent of live proximity pairs are
    // distinct-parallel pairs at the runways' own spacing), so the
    // non-converging parallel case now demotes to advisory and the pair stays
    // visible without claiming operator attention.
    const alerts = runPredictiveRules(byId("negative-control-parallel-approach"));
    const prox = alerts.filter((a) => a.category === "proximity-conflict");
    expect(prox.length).toBeGreaterThan(0);
    for (const a of prox) {
      expect(a.severity).toBe("advisory");
      expect(a.reason).toContain("parallel runways");
    }
  });

  it("a converging pair on distinct parallels still escalates to critical", () => {
    // The blunder case PRM exists for: head-on closure inside DMOD between
    // aircraft assigned 28L and 28R. Tau is ~5 seconds, miss distance ~0,
    // vertical gap 100 ft, so the convergence test must fire critical and the
    // parallel demotion must not touch it.
    const base = byId("nominal");
    const [a, b] = base.flights;
    const state: SimState = {
      ...base,
      flights: [
        { ...a, id: "blunder-a", callsign: "TST301", type: "arrival", phase: "final",
          altitudeFt: 2000, speedKts: 150, headingDeg: 90,
          positionNm: { x: 0, y: 10 }, assignedRunway: "28L", etaMin: 6, fuelMin: 200 },
        { ...b, id: "blunder-b", callsign: "TST302", type: "arrival", phase: "final",
          altitudeFt: 2100, speedKts: 150, headingDeg: 270,
          positionNm: { x: 0.4, y: 10 }, assignedRunway: "28R", etaMin: 6, fuelMin: 200 },
      ],
    };
    const prox = runAllRules(state).filter((x) => x.category === "proximity-conflict");
    expect(prox).toHaveLength(1);
    expect(prox[0].severity).toBe("critical");
  });

  // Silence is only evidence if the doctrine ran. Measured 2026-08-18: every
  // one of the then-six controls formed ZERO wake pairs, so the corpus could
  // not distinguish "judged legal" from "never evaluated" for the detector
  // carrying the largest model correction in the paper. The staggered control's
  // arrivals sat 1.5 NM apart laterally against a 0.1 NM stream threshold and
  // split into three separate streams.
  //
  // These two tests pin the pairs FORMING, so a future change that silently
  // stops the wake doctrine from running fails here instead of reading as a
  // clean negative-control pass.
  it("the staggered control forms two wake pairs and judges both legal", () => {
    const margins = wakeGapMargins(byId("negative-control-staggered"));
    expect(margins).toHaveLength(2);
    for (const m of margins) expect(m).toBeGreaterThan(0);
  });

  // The brief of that scenario states its own geometry: two pairs at 9.2 and
  // 10.2 NM in trail against 5 and 3 NM requirements. A brief is documentation
  // and drifts like any other, and this is the most precise self-description in
  // the corpus, so it is worth holding to the numbers rather than to the shape.
  // Checked 2026-09-01 and exact: 9.167 and 10.185 against 5 and 3.
  it("the staggered control's geometry is what its brief says it is", () => {
    const pairs = wakeCandidatePairs(byId("negative-control-staggered"));
    expect(pairs).toHaveLength(2);
    // Numeric comparators: the default sort is lexicographic, which orders
    // 10.2 before 9.2 and failed this test on its first run.
    const asc = (a: number, b: number) => a - b;
    const gaps = pairs.map((p) => Number(p.gap.toFixed(1))).sort(asc);
    expect(gaps).toEqual([9.2, 10.2]);
    expect(pairs.map((p) => p.required).sort(asc)).toEqual([3, 5]);
  });

  // The vortex band is a tag, not a drop, so its selection effect can be
  // measured. These tests pin the relationship between the two sets, because
  // the harness reads the wider one and Section 6.7's withdrawn figures came
  // from a harness that had drifted away from the production enumeration.
  it("the admitted pairs are exactly the in-band subset of the candidates", () => {
    for (const s of SCENARIOS) {
      const state = s.build();
      const candidates = wakeCandidatePairs(state);
      const admitted = candidates.filter((p) => p.withinBand);
      expect(wakeGapMargins(state)).toHaveLength(
        admitted.filter((p) => p.required > 0).length,
      );
      expect(admitted.length).toBeLessThanOrEqual(candidates.length);
    }
  });

  // wake-violation carries one pair 900 ft apart (admitted) and one 2,400 ft
  // apart (excluded), so it demonstrates the band actually removing a pair
  // rather than the instrument reporting a set it never filters.
  // Proximity is the largest category by volume, so the harness reads its
  // pairing too. Same rule as the wake enumeration: the harness must consume the
  // production walk, never its own copy of the geometry.
  it("the exported proximity pairs match the alerts the detector emits", () => {
    for (const s of SCENARIOS) {
      const state = s.build();
      const pairs = proximityPairs(state);
      const alerts = runAllRules(state).filter((a) => a.category === "proximity-conflict");
      expect(pairs).toHaveLength(alerts.length);
      expect(pairs.filter((p) => p.critical)).toHaveLength(
        alerts.filter((a) => a.severity === "critical").length,
      );
    }
  });

  it("wake-violation has two candidate pairs and one inside the band", () => {
    const candidates = wakeCandidatePairs(byId("wake-violation"));
    expect(candidates).toHaveLength(2);
    expect(candidates.filter((p) => p.withinBand)).toHaveLength(1);
    const excluded = candidates.find((p) => !p.withinBand);
    expect(excluded?.vertGapFt).toBeGreaterThan(1000);
  });

  it("the at-minimum control forms one pair inside 0.5 NM of the requirement", () => {
    const margins = wakeGapMargins(byId("negative-control-wake-at-minimum"));
    expect(margins).toHaveLength(1);
    expect(margins[0]).toBeGreaterThan(0);
    expect(margins[0]).toBeLessThan(0.5);
  });

  it("the go-around control flags the pair at warning, not critical", () => {
    const alerts = runPredictiveRules(byId("negative-control-goaround"));
    const prox = alerts.filter((a) => a.category === "proximity-conflict");
    expect(prox.length).toBeGreaterThan(0);
    for (const a of prox) expect(a.severity).toBe("warning");
  });

  it("negative-control-asrs still flags the proximity, at warning or below", () => {
    const alerts = runPredictiveRules(byId("negative-control-asrs"));
    expect(categories(alerts)).toContain("proximity-conflict");
  });

  // Previously this scenario raised three critical fuel-hold alerts, because
  // seedState() put four of six arrivals below the FAR 91.167 45-minute reserve
  // and three into emergencies. The seed fuel loads were corrected to
  // etaMin + 45 + contingency, which is what an arrival not in difficulty
  // carries. A scenario named "nominal" must be quiet: it is the first entry in
  // the picker and therefore the reference a reader calibrates against.
  it("the nominal scenario is quiet", () => {
    expect(runPredictiveRules(byId("nominal"))).toHaveLength(0);
  });

  // What live-adsb.ts synthesises clears the trigger at the moment it is built:
  // fuelMin is max(30, etaMin + 60) against an etaMin + 45 threshold, so the
  // margin is 15 minutes at every ETA. That is a fact about ingest and not
  // about live mode, which is what this comment claimed until 2026-09-01 and
  // what five other places claimed with it. smoothEtas rewrites etaMin against
  // the previous tick before the detectors run and leaves fuelMin alone, so the
  // margin measured here is gone by the time the doctrine is evaluated; see
  // "live ETA smoothing makes a fuel warning reachable".
  it("synthesised live fuel values clear the trigger at the moment they are built", () => {
    for (const etaMin of [0, 5, 20, 60, 120]) {
      const fuelMin = Math.max(30, etaMin + 60);
      expect(fuelMin).toBeGreaterThanOrEqual(etaMin + 45);
    }
  });
});

// Section 6.6 / Appendix A.4: de-duplication between present state and
// projections. Implemented; these tests pin it.
describe("projection de-duplication (Appendix A.4 item 1)", () => {
  for (const s of SCENARIOS) {
    it(`${s.id} emits no duplicate alert ids`, () => {
      const ids = runPredictiveRules(s.build()).map((a) => a.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  }

  it("every present-state alert survives into the predictive output", () => {
    const state = byId("crisis");
    const present = runAllRules(state);
    const combined = runPredictiveRules(state).map((a) => a.id);
    for (const a of present) expect(combined).toContain(a.id);
  });

  it("the wrong-runway doctrine fires on the heading alone, not on a second match", () => {
    // Pinning what the detector does, which is not what its comment claimed
    // until 2026-09-01. The comment argued that the 20 degree tolerance is safe
    // because the alert needs two conditions: outside tolerance of the assigned
    // runway AND inside it for a different one. The second search only decides
    // the wording. An aircraft 25 degrees off its assigned runway, matching no
    // other runway at the field, still raises a critical.
    //
    // This is pinned rather than fixed because requiring the second condition is
    // a change to doctrine. It would cost nothing measured: the corpus produces
    // exactly one runway-identity alert, Comair 5191, and that aircraft was
    // aligned with runway 26.
    const field = AIRPORTS.KJFK;
    const strip = field.runways[0];
    const course = strip.trueCourseDeg ?? strip.headingDeg;
    const rolling = (headingDeg: number) =>
      ({
        id: "d1", callsign: "TEST1", type: "departure", aircraft: "B738", wake: "medium",
        origin: "KJFK", destination: "KBOS", phase: "queued", altitudeFt: 0, speedKts: 60,
        headingDeg, positionNm: { x: 0, y: 0 }, assignedRunway: strip.id, fuelMin: 200,
        etaMin: 0, squawk: "2400",
      }) as unknown as Flight;
    const identity = (headingDeg: number) =>
      runAllRules({
        tick: 0, clockMin: 0, sectorId: "KJFK TWR", runways: field.runways,
        gates: field.gates, flights: [rolling(headingDeg)], alerts: [], trackedAlerts: [],
        speed: 1, trails: {},
        weather: { windDirDeg: 0, windKts: 3, gustsKts: 3, visibilityNm: 10,
                   ceilingFt: 20000, condition: "VFR", precipitation: "none" },
      } as unknown as SimState).filter((a) => a.category === "runway-identity");

    // Lined up on its own runway: nothing.
    expect(identity(course)).toHaveLength(0);

    // Twenty-five degrees off, which matches no other runway here.
    const offOnly = identity((course + 25) % 360);
    expect(offOnly).toHaveLength(1);
    expect(offOnly[0].severity).toBe("critical");
    expect(offOnly[0].title).not.toContain("rolling on");
  });

  it("an empty traffic picture is silent only when the weather is", () => {
    // Both papers explained the silence metric by saying a snapshot whose
    // geometry classified no contacts carries no alerts by construction. Two of
    // the eleven doctrines are not scoped to traffic: crosswind is scoped to
    // runways and weather-shift to the field, so neither needs an aircraft. The
    // claim held for the measured windows only because their weather was clear
    // and dry, which is a property of those windows and not of the design.
    const field = AIRPORTS.KJFK;
    const withWeather = (weather: unknown) =>
      runAllRules({
        tick: 0,
        clockMin: 0,
        sectorId: "KJFK TWR",
        runways: field.runways,
        gates: field.gates,
        flights: [],
        alerts: [],
        trackedAlerts: [],
        speed: 1,
        trails: {},
        weather,
      } as unknown as SimState);

    const calm = withWeather({
      windDirDeg: 40, windKts: 5, gustsKts: 5,
      visibilityNm: 10, ceilingFt: 20000, condition: "VFR", precipitation: "none",
    });
    expect(calm).toEqual([]);

    const adverse = withWeather({
      windDirDeg: 10, windKts: 40, gustsKts: 45,
      visibilityNm: 0.5, ceilingFt: 200, condition: "LIFR", precipitation: "snow",
    });
    // Not a round number by accident: four runway ends exceed the crosswind
    // limit at this field on this wind, and the field itself is below minima.
    expect(adverse.length).toBeGreaterThan(0);
    expect(new Set(adverse.map((a) => a.category))).toEqual(
      new Set(["crosswind", "weather-shift"]),
    );
    expect(adverse.some((a) => a.severity === "critical")).toBe(true);
  });

  it("projected alerts are demoted, never critical", () => {
    // With a control on what was examined. Without it this passes having looked
    // at nothing, and it nearly did: the corpus produces three projected alerts
    // across twenty-eight scenarios and all three are already info, so the
    // assertion below holds whatever the demotion does. The property itself is
    // tested directly against demoteForHorizon; this pins the corpus coverage
    // so a drop to zero fails instead of reading as a pass.
    let examined = 0;
    for (const s of SCENARIOS) {
      const projected = runPredictiveRules(s.build()).filter((a) => a.lookaheadMin);
      examined += projected.length;
      for (const a of projected) expect(a.severity).not.toBe("critical");
    }
    expect(examined).toBe(3);
  });

  it("demotion maps every severity below critical, at every horizon", () => {
    // The property two arguments in the papers rest on: the critical tier is
    // reserved for conditions holding in the present state, so no projection
    // may carry it. The corpus cannot show this, because no scenario projects
    // an alert whose base severity is above info, which is why the function is
    // exercised directly here across all four tiers and both horizon bands.
    const severities = ["critical", "warning", "advisory", "info"] as const;
    for (const base of severities) {
      for (const horizon of [1, 2, 3]) {
        expect(demoteForHorizon(base, horizon)).not.toBe("critical");
      }
      // One step at one and two minutes, two at three, so the deeper horizon is
      // never the gentler of the two.
      const near = demoteForHorizon(base, 1);
      const far = demoteForHorizon(base, 3);
      const rank = { critical: 3, warning: 2, advisory: 1, info: 0 } as const;
      expect(rank[far]).toBeLessThanOrEqual(rank[near]);
    }
    // And the specific mapping, so a change to the table is a decision rather
    // than a silent shift: critical demotes to warning at a near horizon and to
    // advisory at three minutes.
    expect(demoteForHorizon("critical", 1)).toBe("warning");
    expect(demoteForHorizon("critical", 3)).toBe("advisory");
    expect(demoteForHorizon("info", 3)).toBe("info");
  });
});

// Appendix A.4 item 2: demotion deepens with the projection horizon (one step
// at 1-2 minutes, two at 3), and a projected alert is never critical whatever
// the horizon. Earlier the demotion ignored the horizon entirely.
describe("horizon-dependent demotion (Appendix A.4 item 2)", () => {
  it("demotes one step at nearer horizons and two at three minutes", () => {
    for (const s of SCENARIOS) {
      for (const a of runPredictiveRules(s.build())) {
        if (!a.lookaheadMin) continue;
        if (a.lookaheadMin >= 3) {
          // Two demotions from any base severity land at advisory or info.
          expect(["advisory", "info"]).toContain(a.severity);
        } else {
          expect(a.severity).not.toBe("critical");
        }
      }
    }
  });

  // Regression test for the cross-horizon de-duplication bug: the predicate
  // compared a prefixed id against an unprefixed one and could never match, so
  // the same conflict reached the operator at up to three horizons at once
  // (measured: Tenerife and Linate twice, the runway-conflict scenario three
  // times). Severity was horizon-independent at the time, so no assertion on
  // ids or severities could catch it.
  it("reports a projected condition at exactly one horizon", () => {
    for (const s of SCENARIOS) {
      const seen = new Map<string, number[]>();
      for (const a of runPredictiveRules(s.build())) {
        if (!a.lookaheadMin) continue;
        const base = a.id.replace(/^predicted-\d+-/, "");
        seen.set(base, [...(seen.get(base) ?? []), a.lookaheadMin]);
      }
      for (const [base, horizons] of seen) {
        expect(horizons, `${s.id}: ${base} reported at ${horizons}`).toHaveLength(1);
      }
    }
  });

  it("keeps the nearest horizon when a condition persists across projections", () => {
    // An overtake in trail: 300 kts closing on 150 kts along the same track,
    // 4.4 NM apart now. Closure is 2.5 NM/min, so the gap is 1.9 NM at +1 and
    // 0.6 NM at +2 (both inside the 2 NM proximity box) and 3.1 NM at +3,
    // past each other and separating. The condition exists at two horizons;
    // only the +1 report survives.
    //
    // This test used Tenerife until the projector fix. Both 747s there are
    // queued at 0 ft, which the proximity detector excludes; the old
    // projector's illegal queued climb lifted them to a projected altitude
    // and re-admitted them. The projected conflict was an artifact of the
    // defect, so the fix removed the alert and the vehicle with it.
    const base = byId("nominal");
    const [a, b] = base.flights;
    const state: SimState = {
      ...base,
      flights: [
        {
          ...a,
          id: "prox-lead",
          callsign: "TST100",
          type: "arrival",
          phase: "enroute",
          altitudeFt: 6000,
          speedKts: 150,
          headingDeg: 90,
          positionNm: { x: 0, y: 10 },
          etaMin: 20,
          fuelMin: 200,
        },
        {
          ...b,
          id: "prox-trail",
          callsign: "TST200",
          type: "arrival",
          phase: "enroute",
          altitudeFt: 6400,
          speedKts: 300,
          headingDeg: 90,
          positionNm: { x: -4.4, y: 10 },
          etaMin: 20,
          fuelMin: 200,
        },
      ],
    };
    const alerts = runPredictiveRules(state);
    expect(alerts.filter((x) => !x.lookaheadMin && x.category === "proximity-conflict"))
      .toHaveLength(0);
    const proj = alerts.filter(
      (x) => x.lookaheadMin && x.category === "proximity-conflict",
    );
    expect(proj).toHaveLength(1);
    expect(proj[0].lookaheadMin).toBe(1);
  });
});

// Section 6.9: the monolithic baseline and the orchestrated population agree on
// category and severity across the seven incident scenarios. Confirmed claim.
describe("baseline comparison (Section 6.9)", () => {
  // The monolith implements seven of the eight doctrines; it has no
  // weather-shift block. Equivalence therefore holds across the shared
  // doctrines, which is the comparison the architectural claim rests on.
  // Doctrines added after the baseline freeze (weather-shift, runway-identity)
  // exist only in the orchestrated population; equivalence is asserted on the
  // doctrines both implement.
  const FROZEN_OUT = new Set(["weather-shift", "runway-identity", "squawk-emergency"]);
  const sharedOnly = (alerts: Alert[]) =>
    alerts.filter((a) => !FROZEN_OUT.has(a.category));

  for (const id of INCIDENTS) {
    it(`${id} agrees between monolith and orchestrated population on shared doctrines`, () => {
      const state = byId(id);
      const orchestrated = sharedOnly(runAllRules(state));
      const baseline = sharedOnly(runBaselineRules(state));
      expect(orchestrated).toHaveLength(baseline.length);
      expect([...categories(orchestrated)].sort()).toEqual(
        [...categories(baseline)].sort(),
      );
    });
  }

  it("the two implementations differ only where a pinned doctrine is missing", () => {
    // The per-incident test above runs on nine of the twenty-eight scenarios,
    // and the undeclared divergence was in the other nineteen: the population
    // has a second gate rule, firing when more than one arrival is assigned to
    // the same gate, which the frozen function has no block for. The papers
    // described that as the baseline's gate block "not reaching at the same
    // thresholds", which was wrong; the thresholds are identical.
    //
    // Compared by category, severity and subject rather than by count, because
    // two implementations can agree on how many alerts they raise while
    // disagreeing about which aircraft and how urgently.
    const key = (a: Alert) =>
      `${a.category}|${a.severity}|${[...a.flightIds].sort().join("+")}`;
    // Population-only alerts expected per scenario, once the three doctrines
    // that postdate the freeze are set aside. Everything absent from this table
    // must match exactly.
    const PINNED: Record<string, number> = { crisis: 2, "gate-gridlock": 1 };
    let compared = 0;
    for (const scenario of SCENARIOS) {
      const state = scenario.build();
      const shared = (alerts: Alert[]) =>
        alerts.filter((a) => !FROZEN_OUT.has(a.category)).map(key).sort();
      const population = shared(runAllRules(state));
      const monolith = shared(runBaselineRules(state));
      compared++;
      const populationOnly = population.filter((k) => !monolith.includes(k));
      const monolithOnly = monolith.filter((k) => !population.includes(k));
      // The monolith raising something the population does not would mean the
      // two disagree about a shared rule, which is the case the paper's claim
      // rests on not happening.
      expect(monolithOnly).toEqual([]);
      expect(populationOnly.length).toBe(PINNED[scenario.id] ?? 0);
      // And the pinned ones are the double-booking rule, not something else
      // that happens to number the same.
      for (const k of populationOnly) expect(k).toContain("gate-conflict|advisory");
    }
    expect(compared).toBe(SCENARIOS.length);
  });

  // Section 6.9 states the Tenerife figures under a heading reading Corrected,
  // which makes them a claim the paper has already been wrong about once: the
  // monolith produces one alert and the population two, the difference being
  // the weather-shift doctrine the monolith does not implement. Pinned
  // 2026-09-01, because a corrected figure that drifts back is worse than one
  // that was never checked.
  it("Tenerife separates the two implementations by exactly one alert", () => {
    const state = byId("incident-tenerife-1977");
    const population = runAllRules(state);
    const monolith = runBaselineRules(state);
    expect(monolith).toHaveLength(1);
    expect(population).toHaveLength(2);
    expect(monolith.map((a) => a.category)).toEqual(["runway-conflict"]);
    // The extra one is the doctrine the monolith lacks, not a duplicate of the
    // one it has, which is the whole point of the comparison.
    expect(population.map((a) => a.category).sort()).toEqual([
      "runway-conflict",
      "weather-shift",
    ]);
  });

  it("the monolith implements no weather-shift doctrine", () => {
    for (const s of SCENARIOS) {
      expect(categories(runBaselineRules(s.build()))).not.toContain("weather-shift");
    }
  });

  it("the monolith never emits more than the detector population", () => {
    // The monolith has no weather-shift detector, so the orchestrated
    // population is a superset on any scenario with adverse weather.
    for (const id of INCIDENTS) {
      const state = byId(id);
      expect(runAllRules(state).length).toBeGreaterThanOrEqual(
        runBaselineRules(state).length,
      );
    }
  });

  it("Tenerife emits runway-conflict and weather-shift", () => {
    // The output the write-up claimed before weather-shift was implemented.
    expect(categories(runAllRules(byId("incident-tenerife-1977")))).toEqual(
      new Set(["runway-conflict", "weather-shift"]),
    );
  });
});

// Every category declared on the Alert type must have an emitter. A declared
// category that nothing produces promises the reader coverage that does not
// exist, which is why "missed-handoff" was removed from the type rather than
// left in place: SimState models one sector, so there is no handoff to miss.
describe("declared category coverage (Section 6.6)", () => {
  const emitted = new Set<string>();
  for (const s of SCENARIOS) {
    for (const a of runPredictiveRules(s.build())) emitted.add(a.category);
    for (const a of runBaselineRules(s.build())) emitted.add(a.category);
  }

  it("all eleven declared categories are reachable", () => {
    for (const c of [
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
    ]) {
      expect(emitted.has(c), `${c} has no emitter`).toBe(true);
    }
  });

  it("wake-spacing comes from its own detector, not from the runway detector", () => {
    // §3.1 assigns one doctrine per detector. wake-spacing used to be emitted
    // from inside detectRunwayConflicts, which broke that for the largest
    // detector. detectWakeSpacing tags its alerts with a wake- id prefix.
    const wake = runAllRules(byId("wake-violation")).filter(
      (a) => a.category === "wake-spacing",
    );
    expect(wake.length).toBeGreaterThan(0);
    for (const a of wake) expect(a.id.startsWith("wake-")).toBe(true);
  });
});

// Appendix A.4 item 3. Previously described but unimplemented.
describe("suppression (Appendix A.4 item 3)", () => {
  // Both papers state the layer's reach as one alert of fifty-one, offered as
  // evidence that suppression stopped mattering once the doctrine corrections
  // landed. The tests below check that suppression behaves correctly when it
  // fires; none checked how often it fires, so the figure the papers quote was
  // free to drift in either direction. Pinned 2026-09-01.
  it("suppression reaches exactly the share the papers report", () => {
    let alerts = 0;
    let subsumed = 0;
    for (const scenario of SCENARIOS) {
      for (const alert of runAllRules(scenario.build())) {
        alerts++;
        if (alert.suppressedBy !== undefined) subsumed++;
      }
    }
    expect(alerts).toBe(51);
    expect(subsumed).toBe(1);
  });

  it("a critical runway-conflict subsumes a lower-tier one on the same runway", () => {
    const alerts = runAllRules(byId("runway-conflict"));
    const suppressed = alerts.filter((a) => a.suppressedBy);
    expect(suppressed.length).toBeGreaterThan(0);
    for (const a of suppressed) {
      const trigger = alerts.find((t) => t.id === a.suppressedBy);
      expect(trigger?.severity).toBe("critical");
      expect(trigger?.runwayId).toBe(a.runwayId);
    }
  });

  it("never suppresses a critical alert", () => {
    for (const s of SCENARIOS) {
      for (const a of runAllRules(s.build())) {
        if (a.severity === "critical") expect(a.suppressedBy).toBeUndefined();
      }
    }
  });

  it("never suppresses across runways or on unscoped alerts", () => {
    for (const s of SCENARIOS) {
      const alerts = runAllRules(s.build());
      for (const a of alerts.filter((x) => x.suppressedBy)) {
        expect(a.runwayId).toBeDefined();
        expect(alerts.find((t) => t.id === a.suppressedBy)?.runwayId).toBe(a.runwayId);
      }
    }
  });

  it("marks rather than deletes, so the audit set stays complete", () => {
    // Suppressed alerts must still be present for post-incident review.
    const state = byId("runway-conflict");
    expect(applySuppression(runAllRules(state))).toHaveLength(runAllRules(state).length);
  });
});

// Severity bands no scenario reaches. Measured on 2026-08-31 by listing, for
// each category, the tiers the corpus produces against the tiers the code can
// emit: of eleven categories only proximity reaches all three, and two have a
// band the code emits and the corpus never enters. That is the same shape as
// the negative controls that asserted silence without running their doctrine,
// one level down: the doctrine runs, and one of its answers is never produced.
//
// Exercised here rather than by adding scenarios, because the corpus size is a
// published number in seven documents and a severity band is not a situation
// worth a scenario. The states are existing scenarios with one field moved.
describe("ETA smoothing, the fix that lives at ingest", () => {
  // `smoothing.ts` was reached by no test until 2026-08-31, and it is the module
  // the thesis credits with removing the wake-spacing criticals that a
  // crosstab attributed 79.1 per cent of the untuned volume to. The mechanism
  // was measurement noise rather than doctrine: ground speed jitters between
  // ADS-B reports, so a recomputed ETA gap oscillates across the critical
  // boundary. The fix is here rather than in the detector, so the detectors stay
  // pure and the Section 4.1 determinism claim survives.
  //
  // It is a pure function of two flight lists with a documented alpha, which is
  // as testable as code gets, and nothing tested it.
  const arrival = (id: string, etaMin: number): Flight =>
    ({ id, callsign: id, type: "arrival", etaMin } as unknown as Flight);

  it("blends against the previous tick at the documented alpha", () => {
    // 0.4 * 10 + 0.6 * 20 = 16.
    const out = smoothEtas([arrival("a", 20)], [arrival("a", 10)]);
    expect(out[0].etaMin).toBeCloseTo(16, 10);
    expect(ETA_SMOOTHING_ALPHA).toBe(0.4);
  });

  it("passes an aircraft new to the picture through unchanged", () => {
    const out = smoothEtas([arrival("a", 20)], [arrival("a", 10), arrival("b", 30)]);
    expect(out.find((f) => f.id === "b")!.etaMin).toBe(30);
  });

  it("passes departures through, because their ETA is synthetic", () => {
    const dep = { id: "d", callsign: "d", type: "departure", etaMin: 3 } as unknown as Flight;
    const out = smoothEtas([{ ...dep, etaMin: 99 }], [dep]);
    expect(out[0].etaMin).toBe(3);
  });

  it("does not mutate its inputs, which is what pure has to mean here", () => {
    const prev = [arrival("a", 20)];
    const cur = [arrival("a", 10)];
    smoothEtas(prev, cur);
    expect(prev[0].etaMin).toBe(20);
    expect(cur[0].etaMin).toBe(10);
  });

  it("damps an oscillating input rather than following it", () => {
    // The defect this exists for: an ETA alternating either side of a boundary.
    // Smoothed, the swing has to be smaller than the raw swing.
    let state = [arrival("a", 12)];
    const seen: number[] = [];
    for (const raw of [8, 12, 8, 12, 8, 12]) {
      state = smoothEtas(state, [arrival("a", raw)]);
      seen.push(state[0].etaMin);
    }
    const swing = Math.max(...seen) - Math.min(...seen);
    expect(swing).toBeLessThan(4);
  });
});

describe("every weather fallback is optimistic, and that is the point", () => {
  // `live-weather.ts` was reached by no test, transitively or otherwise, until
  // 2026-08-31, and it is the module both papers discuss most: absent weather
  // reads as the best weather, so the crosswind and weather-shift detectors stay
  // silent exactly when the data that would trigger them did not arrive. That
  // direction is the safer one for an advisory layer, because a fabricated alert
  // costs more than a missed one, and it was chosen and disclosed rather than
  // stumbled into.
  //
  // The disclosure is in both papers and in the module's own comment. It was not
  // in a test, so nothing would have noticed the behaviour changing under the
  // sentence describing it.
  const withMetar = async (metar: Record<string, unknown>) => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify([metar]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof globalThis.fetch;
    try {
      return await fetchAirportWeather("KJFK");
    } finally {
      globalThis.fetch = original;
    }
  };

  it("reads an empty METAR as the best weather at every field", async () => {
    const wx = await withMetar({});
    expect(wx.condition).toBe("VFR");        // no flight category
    expect(wx.windKts).toBe(0);              // no wind speed: calm
    expect(wx.visibilityNm).toBe(10);        // no visibility: ten statute miles
    expect(wx.ceilingFt).toBe(20000);        // no opaque layer: twenty thousand feet
  });

  it("cannot tell a defaulted visual condition from a measured one", async () => {
    // The reason the instrument-condition sample cannot be corrected after the
    // fact: both of these produce the same stored string, and the window schema
    // carries one condition per snapshot with no flag for which it was.
    const measured = await withMetar({ fltCat: "VFR" });
    const defaulted = await withMetar({});
    expect(defaulted.condition).toBe(measured.condition);
  });
});

describe("the phase vocabulary the corpus actually uses", () => {
  // The audit in docs/phase-vocabulary-audit.md said five detectors exclude
  // `landed`, `at-gate` and `taxi-in`, that those exclusions are inert live,
  // and that they are "correct for the scenario corpus, which does use those
  // phases". The corpus uses one of the three. This pins the measurement so
  // the sentence cannot drift back.
  it("uses at-gate, and never landed or taxi-in", () => {
    const counts = new Map<string, number>();
    for (const scenario of SCENARIOS)
      for (const flight of scenario.build().flights)
        counts.set(flight.phase, (counts.get(flight.phase) ?? 0) + 1);
    expect(counts.get("at-gate") ?? 0).toBeGreaterThan(0);
    expect(counts.get("landed") ?? 0).toBe(0);
    expect(counts.get("taxi-in") ?? 0).toBe(0);
  });

  it("leaves landed unreachable from phaseFromAlt as well", () => {
    // Airborne, on the ground slow, on the ground fast, and high: none of the
    // branches yields `landed`, so nothing in the project produces it.
    const produced = new Set([
      phaseFromAlt(0, 5, 0),
      phaseFromAlt(0, 90, 0),
      phaseFromAlt(1500, 140, 3),
      phaseFromAlt(5000, 220, 15),
      phaseFromAlt(30000, 450, 200),
    ]);
    expect(produced.has("landed")).toBe(false);
    // And the other direction, which the comment in live-adsb.ts claims and
    // this test did not check: everything the function does produce has to be
    // a phase the audit accounted for. Asserting only that `landed` is absent
    // would pass if the function began emitting something new, which is the
    // case the audit exists to catch. Added 2026-09-01.
    const AUDITED = new Set(["queued", "taxi-out", "final", "approach", "enroute"]);
    for (const phase of produced) {
      expect(AUDITED.has(phase)).toBe(true);
    }
    // Known-positive: an empty set satisfies both assertions above.
    expect(produced.size).toBeGreaterThan(3);
  });
});

describe("which tiers the corpus reaches, pinned as a set", () => {
  // Finding 98 measured this with a one-off probe and then added tests for the
  // two bands it found unreached. That leaves the measurement unguarded: a
  // detector gaining a tier, or losing the scenario that exercises one, changes
  // what the corpus covers and nothing would say so. The probe becomes a test
  // here, pinning the whole map rather than the two cases that prompted it,
  // which is the fifth time in two days a check has had to be widened from the
  // instances that created it to the set it belongs to.
  //
  // A diff here is not automatically a defect. It means the coverage changed,
  // and the question is whether that was intended.
  const EXPECTED: Record<string, string[]> = {
    "cascading-delay": ["advisory"],
    // crosswind reaches only critical unaided and gate-conflict only advisory
    // and critical: their warning bands are the two finding 98 added tests for,
    // and those tests move a field of an existing scenario rather than adding
    // one, so the bands stay out of this map by design. The first version of
    // this map listed them anyway, written from a memory of the probe instead
    // of from the probe.
    crosswind: ["critical"],
    "fuel-hold": ["critical", "warning"],
    "gate-conflict": ["advisory", "critical"],
    // Was ["advisory", "critical", "warning"] until 2026-09-02. The only
    // critical this category reached was the JFK reconstruction, and it
    // reached it on geometry that did not match the event: two departures
    // 150 ft apart, where the reported encounter was two arrivals on
    // parallel approaches 350 ft apart. Encoded correctly it is an
    // advisory, so no scenario in the corpus now produces a critical
    // proximity conflict. That is a loss of coverage and it is stated in
    // both papers rather than absorbed here.
    "proximity-conflict": ["advisory", "warning"],
    "runway-conflict": ["critical", "warning"],
    "runway-identity": ["critical"],
    "runway-surface": ["advisory"],
    "squawk-emergency": ["critical"],
    "wake-spacing": ["critical", "warning"],
    "weather-shift": ["advisory", "warning"],
  };

  // The incident table in both papers states an outcome per reconstruction, and
  // only the corpus-wide tier map above was guarded. Six of the nine reach a
  // critical; the LAX 1991 collision reconstructs to a warning, the Potomac
  // case to warnings, and the American 11 scenario to nothing at all, each of
  // which the papers state. Nothing held those rows in place: runway-conflict
  // already reaches both tiers somewhere in the corpus, so LAX escalating to
  // critical would leave the aggregate test green and the published table
  // wrong. Added 2026-09-01.
  // Which alert in each reconstruction is the detection of the accident, and
  // what the other alerts are. Both papers reported per-incident alert counts
  // for months with nothing distinguishing the two, so a reader looking at the
  // Potomac row saw 2 and could not tell that one of them is the midair and the
  // other is a fuel warning about an unrelated aircraft on final. The severity
  // map above pins the top tier each incident reaches, which does not answer
  // the question either: LAX and the Potomac both top out at warning, and in
  // both cases the warning that is the detection sits beside a warning that is
  // not.
  //
  // Three classes rather than two, because "not the detection" hides a real
  // difference. Tenerife's weather-shift alert is the fog the crews could not
  // see through and Avianca's fuel alerts are the accident itself, so those are
  // related to the event without being the detection of it. The two fuel-hold
  // warnings at LAX and the Potomac are neither: both scenarios place an
  // arrival on short final holding less than the reserve 14 CFR 91.167
  // requires, which is doctrinally correct and has nothing to do with either
  // collision.
  //
  // The union is asserted against what the detectors actually raise, so a new
  // alert appearing in any reconstruction fails here rather than quietly
  // changing a published count. Added 2026-09-02.
  // The parallel-approach downgrade decides on runway identifiers and never
  // reads a heading, so it cannot separate two arrivals tracking their own
  // localisers from one arrival leaving its course toward the other. The JFK
  // reconstruction is the second case and the negative control is the first,
  // and both come out as advisories. Pinned rather than fixed: requiring
  // convergence before the downgrade applies is a doctrine change that should
  // be measured against live traffic first, because parallel approaches are
  // common and the downgrade exists to keep them quiet. Finding 311.
  it("downgrades a parallel pair on runway identity alone, deviation or not", () => {
    const jfk = byId("incident-jfk-2026");
    const control = byId("negative-control-parallel-approach");
    const severities = (state: SimState) =>
      runAllRules(state)
        .filter((a) => a.category === "proximity-conflict")
        .map((a) => a.severity);
    expect(severities(jfk)).toEqual(["advisory"]);
    expect(severities(control)).toEqual(["advisory"]);

    // The control for this test: the two states must actually differ in the way
    // the finding describes, or it would pass on two identical pictures.
    const headings = (state: SimState) =>
      state.flights.map((f) => f.headingDeg);
    expect(new Set(headings(jfk)).size).toBe(2);
    expect(new Set(headings(control)).size).toBe(1);
  });

  const INCIDENT_ALERTS: Record<
    string,
    { detects: string | null; related: string[]; unrelated: string[] }
  > = {
    "incident-tenerife-1977": {
      detects: "runway-conflict",
      related: ["weather-shift"],
      unrelated: [],
    },
    "incident-avianca052-1990": {
      detects: "fuel-hold",
      related: ["fuel-hold", "fuel-hold", "fuel-hold", "weather-shift"],
      unrelated: [],
    },
    "incident-lax-1991": {
      detects: "runway-conflict",
      related: [],
      unrelated: ["fuel-hold"],
    },
    "incident-linate-2001": {
      detects: "runway-conflict",
      related: ["weather-shift"],
      unrelated: [],
    },
    "incident-dca-2025": {
      detects: "proximity-conflict",
      related: [],
      unrelated: ["fuel-hold"],
    },
    "incident-lga-2025": {
      detects: "runway-conflict",
      related: [],
      unrelated: [],
    },
    "incident-jfk-2026": {
      detects: "proximity-conflict",
      related: [],
      unrelated: [],
    },
    "incident-comair5191-2006": {
      detects: "runway-identity",
      related: [],
      unrelated: [],
    },
    // The declared blind spot. It raises nothing, which is the point of
    // carrying it, so there is no detection to name.
    "incident-aa11-2001": { detects: null, related: [], unrelated: [] },
  };

  it("names the alert that is each incident's detection, and what the rest are", () => {
    const incidents = SCENARIOS.filter((s) => s.id.startsWith("incident-"));
    expect(incidents.length).toBe(9);
    expect(Object.keys(INCIDENT_ALERTS).sort()).toEqual(
      incidents.map((s) => s.id).sort(),
    );
    let withDetection = 0;
    let unrelatedTotal = 0;
    for (const scenario of incidents) {
      const entry = INCIDENT_ALERTS[scenario.id];
      const raised = runAllRules(scenario.build())
        .map((a) => a.category)
        .sort();
      const declared = [
        ...(entry.detects === null ? [] : [entry.detects]),
        ...entry.related,
        ...entry.unrelated,
      ].sort();
      expect({ id: scenario.id, categories: raised }).toEqual({
        id: scenario.id,
        categories: declared,
      });
      if (entry.detects !== null) {
        withDetection++;
        expect(raised).toContain(entry.detects);
      }
      unrelatedTotal += entry.unrelated.length;
    }
    // Controls, so a map that stopped describing anything cannot pass. Eight of
    // the nine detect their accident; the ninth is the blind spot. Two carry an
    // alert unrelated to the event, and both papers say which two.
    expect(withDetection).toBe(8);
    expect(unrelatedTotal).toBe(2);
  });

  const INCIDENT_TOP_SEVERITY: Record<string, string> = {
    "incident-tenerife-1977": "critical",
    "incident-avianca052-1990": "critical",
    "incident-lax-1991": "warning",
    "incident-linate-2001": "critical",
    "incident-dca-2025": "warning",
    "incident-lga-2025": "critical",
    "incident-jfk-2026": "advisory",
    "incident-comair5191-2006": "critical",
    "incident-aa11-2001": "none",
  };

  // Both papers now state how thinly the projection branch is exercised, so the
  // number needs a guard. Three alerts the present state does not raise, in
  // three scenarios, all at the furthest horizon. Counted by the look-ahead
  // marker rather than by comparing identifiers between passes, because
  // identifiers could collide and a collision would read as coverage.
  // Both papers say the projection moves aircraft ten to twenty-two miles at the
  // three-minute horizon, offered as the reason its yield is thin: the corpus is
  // already alarming at load, not the projection inert. A projection that
  // stopped advancing would make that false and would look exactly like the
  // cos(0) defect this codebase carried once.
  //
  // Flights are matched by id, not by index. projectFlight returns null for an
  // arrival whose ETA has passed, so the projected list is shorter and an
  // index comparison pairs different aircraft: the first version of this test
  // did that and reported a queued aircraft at zero knots moving 55 NM, which
  // is a measurement artefact and reads exactly like a units defect.
  it("every projected flight moves along its own heading", () => {
    // The speed test beside this one compares Math.hypot, which is a magnitude
    // and survives any error that preserves it: swap sin for cos, or flip a
    // sign, and every displacement is still the right length. That is not a
    // hypothetical error, it is the one this project shipped. engine.ts computed
    // northward movement from sin and eastward from cos, so symbols slid east
    // while pointing west and no aircraft ever changed latitude, and nothing
    // failed. predict.ts uses the corrected convention and had no direction
    // guard at all.
    //
    // The frame is RadarMap's: north-up, +x east, +y south. So a compass
    // heading's displacement is (sin, -cos) and the bearing recovered from a
    // displacement is atan2(dx, -dy).
    let compared = 0;
    let worstErrorDeg = 0;
    for (const scenario of SCENARIOS) {
      const now = scenario.build();
      const later = projectState(now, 3);
      const projected = new Map(later.flights.map((f) => [f.id, f]));
      for (const flight of now.flights) {
        const moved = projected.get(flight.id);
        if (!moved || !flight.positionNm || !moved.positionNm) continue;
        const dx = moved.positionNm.x - flight.positionNm.x;
        const dy = moved.positionNm.y - flight.positionNm.y;
        // A stationary aircraft has no bearing to check.
        if (Math.hypot(dx, dy) < 0.01) continue;
        compared++;
        const bearing = (((Math.atan2(dx, -dy) * 180) / Math.PI) + 360) % 360;
        const expected = ((flight.headingDeg % 360) + 360) % 360;
        const error = Math.min(
          Math.abs(bearing - expected),
          360 - Math.abs(bearing - expected),
        );
        worstErrorDeg = Math.max(worstErrorDeg, error);
      }
    }
    // The control. Without it a projector that moved nothing would pass, which
    // is the failure mode the speed test above was rewritten to avoid.
    expect(compared).toBeGreaterThan(40);
    expect(worstErrorDeg).toBeLessThan(0.01);
  });

  it("every projected flight moves at its own speed and no faster", () => {
    let compared = 0;
    let worstMismatchKts = 0;
    let furthestNm = 0;
    for (const scenario of SCENARIOS) {
      const now = scenario.build();
      const later = projectState(now, 3);
      const projected = new Map(later.flights.map((f) => [f.id, f]));
      for (const flight of now.flights) {
        const moved = projected.get(flight.id);
        if (!moved || !flight.positionNm || !moved.positionNm) continue;
        compared++;
        const distance = Math.hypot(
          moved.positionNm.x - flight.positionNm.x,
          moved.positionNm.y - flight.positionNm.y,
        );
        furthestNm = Math.max(furthestNm, distance);
        // Three minutes is a twentieth of an hour, so distance times twenty is
        // the implied ground speed.
        worstMismatchKts = Math.max(
          worstMismatchKts,
          Math.abs(distance * 20 - flight.speedKts),
        );
      }
    }
    // Known-positive: an empty comparison satisfies every bound below.
    expect(compared).toBeGreaterThan(50);
    // The projection carries each aircraft exactly its own speed, which is a
    // stronger statement than any distance range and catches a heading or a
    // units error that a range would pass.
    expect(worstMismatchKts).toBeLessThan(0.01);
    // And the papers' figure: the furthest anything travels at this horizon.
    expect(furthestNm).toBeGreaterThan(10);
    expect(furthestNm).toBeLessThan(30);
  });

  it("the look-ahead pass adds exactly the coverage the papers state", () => {
    const scenariosWith: string[] = [];
    const horizons = new Set<number>();
    let total = 0;
    for (const scenario of SCENARIOS) {
      const projected = runPredictiveRules(scenario.build()).filter(
        (a) => a.lookaheadMin !== undefined,
      );
      if (projected.length === 0) continue;
      scenariosWith.push(scenario.id);
      total += projected.length;
      for (const a of projected) horizons.add(a.lookaheadMin!);
    }
    expect(total).toBe(3);
    expect(scenariosWith.sort()).toEqual([
      "cascading-rush",
      "gate-gridlock",
      "incident-linate-2001",
    ]);
    // Every one at the furthest horizon: the shorter projections raise nothing
    // the present tick has not. If that changes the papers have to change too.
    expect([...horizons]).toEqual([3]);
  });

  it("each reconstruction reaches the severity its table row states", () => {
    const rank = ["info", "advisory", "warning", "critical"];
    const actual: Record<string, string> = {};
    for (const scenario of SCENARIOS) {
      if (!scenario.id.startsWith("incident-")) continue;
      const alerts = runAllRules(scenario.build());
      actual[scenario.id] = alerts.length === 0
        ? "none"
        : alerts
            .map((a) => a.severity)
            .sort((a, b) => rank.indexOf(b) - rank.indexOf(a))[0];
    }
    expect(actual).toEqual(INCIDENT_TOP_SEVERITY);
    // Known-positive: nine rows, so a corpus that lost an incident fails here
    // rather than passing on a shorter map.
    expect(Object.keys(actual)).toHaveLength(9);
  });

  it("reaches exactly the tiers recorded for each category", () => {
    const seen = new Map<string, Set<string>>();
    for (const scenario of SCENARIOS)
      for (const alert of runAllRules(scenario.build())) {
        if (!seen.has(alert.category)) seen.set(alert.category, new Set());
        seen.get(alert.category)!.add(alert.severity);
      }
    // The two tests below this describe reach the crosswind and gate-conflict
    // warning bands by moving a field of an existing scenario, so those tiers
    // are exercised without appearing here: this map is what the corpus reaches
    // unaided.
    const actual = Object.fromEntries(
      [...seen.entries()].map(([c, t]) => [c, [...t].sort()]),
    );
    expect(actual).toEqual(
      Object.fromEntries(
        Object.entries(EXPECTED).map(([c, t]) => [c, [...t].sort()]),
      ),
    );
  });
});

describe("severity bands the corpus does not reach", () => {
  it("crosswind warns between the limit and five knots over it", () => {
    // 25 kts is the limit and above 30 is critical, so 25 to 30 is the warning
    // band. The corpus has a control three knots inside the limit and an
    // incident well above it, and nothing in between. The comment said two
    // until 2026-09-01; the control's wind is 104 degrees at 18 gusting 22, the
    // detector takes the gust, and 01L bears 014, so the component is 22.0 kt
    // exactly against a limit of 25. The margin is asserted below rather than
    // described, because a control that drifts to trivially quiet still passes
    // every silence assertion written about it.
    const state = byId("negative-control-crosswind-ops");
    const runway = state.runways[0];
    // Wind straight across the strip makes the crosswind component the speed.
    state.weather = { ...state.weather, windDirDeg: (runway.headingDeg + 90) % 360, windKts: 28 };
    const alerts = runAllRules(state).filter((a) => a.category === "crosswind");
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.every((a) => a.severity === "warning")).toBe(true);
  });

  it("the crosswind control sits three knots inside the limit, not further", () => {
    const state = byId("negative-control-crosswind-ops");
    const speed = Math.max(state.weather.windKts, state.weather.gustsKts);
    const components = state.runways.map((r) => {
      const course = r.trueCourseDeg ?? r.headingDeg;
      const delta = ((state.weather.windDirDeg - course) * Math.PI) / 180;
      return Math.abs(speed * Math.sin(delta));
    });
    const worst = Math.max(...components);
    // Close enough to the 25 kt limit to exercise the comparison, and under it.
    expect(worst).toBeGreaterThan(20);
    expect(worst).toBeLessThan(25);
    expect(worst).toBeCloseTo(22, 1);
    // Known-positive: a corpus whose runways all lay along the wind would give
    // a worst component near zero and satisfy "under the limit" by saying
    // nothing about the doctrine, which is what this control exists to avoid.
    expect(components.filter((c) => c > 20).length).toBeGreaterThan(0);
  });

  it("gate conflict warns when the earliest arrival is not yet inside five minutes", () => {
    // The detector splits on the earliest ETA to the contested gate: inside
    // five minutes is critical, outside it is a warning. The gridlock scenario
    // only produces the critical side.
    const state = byId("gate-gridlock");
    for (const f of state.flights) if (f.etaMin < 9) f.etaMin = 9;
    const alerts = runAllRules(state).filter((a) => a.category === "gate-conflict");
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.some((a) => a.severity === "warning")).toBe(true);
    expect(alerts.every((a) => a.severity !== "critical")).toBe(true);
  });
});

// Weather-shift, implemented after being declared-but-unreachable.
describe("weather-shift detector", () => {
  it("fires on Tenerife's 0.3 NM visibility at warning, not critical", () => {
    const wx = runAllRules(byId("incident-tenerife-1977")).filter(
      (a) => a.category === "weather-shift",
    );
    expect(wx).toHaveLength(1);
    expect(wx[0].severity).toBe("warning");
  });

  it("never emits critical, because weather is a standing condition", () => {
    for (const s of SCENARIOS) {
      for (const a of runAllRules(s.build())) {
        if (a.category === "weather-shift") expect(a.severity).not.toBe("critical");
      }
    }
  });

  it("stays silent in the nominal weather picture", () => {
    expect(
      runAllRules(byId("nominal")).filter((a) => a.category === "weather-shift"),
    ).toHaveLength(0);
  });
});

// Section 4.2: an alert is only actionable if it carries its reasoning and the
// flights it concerns.
describe("explainability (Section 4.2)", () => {
  it("every alert names its flights, reason and suggested action", () => {
    for (const s of SCENARIOS) {
      for (const a of runPredictiveRules(s.build())) {
        expect(a.flightIds.length).toBeGreaterThan(0);
        expect(a.reason.trim()).not.toBe("");
        expect(a.suggestedAction.trim()).not.toBe("");
      }
    }
  });

  it("severity is always one of the four declared tiers", () => {
    for (const s of SCENARIOS) {
      for (const a of runPredictiveRules(s.build())) {
        expect(["critical", "warning", "advisory", "info"]).toContain(a.severity);
      }
    }
  });
});

// Appendix A.4 item 4. Previously described but unimplemented: alerts were
// recomputed from scratch each tick with no cross-tick state, so a condition
// oscillating across a threshold flickered on live input.
describe("alert lifecycle (Appendix A.4 item 4)", () => {
  const alert = (id: string, severity: Alert["severity"] = "warning"): Alert => ({
    id,
    severity,
    category: "proximity-conflict",
    title: id,
    detail: "",
    flightIds: ["a", "b"],
    reason: "r",
    suggestedAction: "s",
    createdAtTick: 0,
  });

  it("assigns firstSeenTick on the tick an alert appears", () => {
    const t = reconcileAlerts([], [alert("x")], 7);
    expect(t).toHaveLength(1);
    expect(t[0].firstSeenTick).toBe(7);
    expect(t[0].lastSeenTick).toBe(7);
    expect(t[0].stale).toBe(false);
  });

  it("preserves firstSeenTick across ticks so alert age is measurable", () => {
    let t = reconcileAlerts([], [alert("x")], 1);
    for (const tick of [2, 3, 4]) t = reconcileAlerts(t, [alert("x")], tick);
    expect(t[0].firstSeenTick).toBe(1);
    expect(t[0].lastSeenTick).toBe(4);
  });

  it("holds an absent alert through the grace period, then drops it", () => {
    let t = reconcileAlerts([], [alert("x")], 10);
    // Absent from tick 11 onward.
    t = reconcileAlerts(t, [], 11);
    expect(t).toHaveLength(1);
    expect(t[0].stale).toBe(true);

    t = reconcileAlerts(t, [], 10 + ALERT_GRACE_TICKS);
    expect(t).toHaveLength(1);

    t = reconcileAlerts(t, [], 10 + ALERT_GRACE_TICKS + 1);
    expect(t).toHaveLength(0);
  });

  it("suppresses flicker: an alert alternating on and off stays tracked", () => {
    let t = reconcileAlerts([], [alert("x")], 1);
    for (const tick of [2, 3, 4, 5, 6, 7, 8]) {
      t = reconcileAlerts(t, tick % 2 === 0 ? [] : [alert("x")], tick);
      expect(t, `dropped at tick ${tick}`).toHaveLength(1);
    }
    // It was continuously tracked, so its age reflects the whole span.
    expect(t[0].firstSeenTick).toBe(1);
  });

  it("refreshes severity immediately on escalation", () => {
    let t = reconcileAlerts([], [alert("x", "advisory")], 1);
    t = reconcileAlerts(t, [alert("x", "critical")], 2);
    expect(t[0].severity).toBe("critical");
    expect(t[0].firstSeenTick).toBe(1);
  });

  it("is a pure function: same inputs, same output", () => {
    const prev: TrackedAlert[] = reconcileAlerts([], [alert("x")], 1);
    const a = reconcileAlerts(prev, [alert("y")], 2);
    const b = reconcileAlerts(prev, [alert("y")], 2);
    expect(a).toEqual(b);
  });

  // The tracked set accumulates across ticks the same way trails do, and trails
  // grew without bound once, in a slice that looked like forgetting and was a
  // fixed point. That leak is pinned by a test further down this file; the
  // equivalent property here was not. A single call cannot see it: the set is
  // correct on any one tick and would grow across hundreds.
  it("the tracked alert set stays bounded as alerts churn", () => {
    let tracked: ReturnType<typeof reconcileAlerts> = [];
    const sizes: number[] = [];
    for (let tick = 0; tick < 200; tick += 1) {
      // One alert that never clears, and one new id every tick that never
      // returns. Without the grace-period drop the second kind accumulates.
      tracked = reconcileAlerts(tracked, [alert("steady"), alert(`churn-${tick}`)], tick);
      sizes.push(tracked.length);
    }
    // Bounded by the steady one plus the churned ids still inside the grace
    // window, so it settles rather than climbing.
    expect(Math.max(...sizes)).toBeLessThanOrEqual(2 + ALERT_GRACE_TICKS);
    expect(sizes[sizes.length - 1]).toBe(sizes[100]);
    // Known-positive: the steady alert has to survive, or a set that dropped
    // everything would also be bounded.
    expect(tracked.some((a) => a.id === "steady" && !a.stale)).toBe(true);
  });

  it("activeAlerts hides stale and suppressed alerts from the operator view", () => {
    const tracked = reconcileAlerts([], [alert("x"), alert("y")], 1);
    const withSuppressed = tracked.map((a, i) =>
      i === 0 ? { ...a, suppressedBy: "other" } : a,
    );
    expect(activeAlerts(withSuppressed)).toHaveLength(1);

    const stale = reconcileAlerts(tracked, [], 2);
    expect(activeAlerts(stale)).toHaveLength(0);
    expect(stale).toHaveLength(2);
  });
});

// The Comair 5191 shape: wrong-runway takeoff roll. The one incident in the
// corpus the frozen monolith cannot see, because the doctrine postdates the
// baseline freeze.
describe("runway-identity detector (Comair 5191)", () => {
  it("flags the wrong-runway roll as critical and names both runways", () => {
    const alerts = runAllRules(byId("incident-comair5191-2006"));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].category).toBe("runway-identity");
    expect(alerts[0].severity).toBe("critical");
    expect(alerts[0].title).toContain("26");
    expect(alerts[0].title).toContain("22");
  });

  it("the frozen monolith misses it entirely", () => {
    expect(runBaselineRules(byId("incident-comair5191-2006"))).toHaveLength(0);
  });

  it("stays quiet below rolling speed", () => {
    const state = byId("incident-comair5191-2006");
    const taxiing = {
      ...state,
      flights: state.flights.map((f) => ({ ...f, speedKts: 15 })),
    };
    expect(runAllRules(taxiing).filter((a) => a.category === "runway-identity")).toHaveLength(0);
  });

  it("stays quiet when the roll is on the assigned runway", () => {
    const state = byId("incident-comair5191-2006");
    const correct = {
      ...state,
      flights: state.flights.map((f) => ({ ...f, headingDeg: 227 })),
    };
    expect(runAllRules(correct).filter((a) => a.category === "runway-identity")).toHaveLength(0);
  });
});

// The corpus's known-blind-spot case. American 11's detectable signatures on
// 11 September 2001 were transponder loss and route deviation; this population
// holds no squawk history and no flight plans, and live ADS-B cannot see a
// non-transponding aircraft at all. The assertion is SILENCE: if any detector
// starts firing on this scenario, either the blind spot was closed (update the
// write-up and the scenario's incident note) or something is firing on
// signatures it cannot honestly claim to see.
describe("known blind spot: American 11, 2001", () => {
  it("the population is silent on the 2001 hijack signatures", () => {
    expect(runPredictiveRules(byId("incident-aa11-2001"))).toHaveLength(0);
  });

  it("the transponder-off aircraft carries no emergency code", () => {
    const state = byId("incident-aa11-2001");
    const aa11 = state.flights.find((f) => f.callsign === "AAL11");
    expect(aa11?.squawk).toBe("----");
  });
});

// The squawk-emergency doctrine the 9/11 case motivated: codes a crew SETS.
describe("squawk-emergency detector", () => {
  it("raises 7500 as critical on the drill", () => {
    const alerts = runAllRules(byId("drill-squawk-7500"));
    const squawk = alerts.filter((a) => a.category === "squawk-emergency");
    expect(squawk).toHaveLength(1);
    expect(squawk[0].severity).toBe("critical");
    expect(squawk[0].title).toContain("7500");
  });

  it("raises 7600 and 7700 as warnings, not criticals", () => {
    const state = byId("drill-squawk-7500");
    for (const [code, expected] of [
      ["7600", "warning"],
      ["7700", "warning"],
    ] as const) {
      const variant = {
        ...state,
        flights: state.flights.map((f) =>
          f.squawk === "7500" ? { ...f, squawk: code } : f,
        ),
      };
      const squawk = runAllRules(variant).filter((a) => a.category === "squawk-emergency");
      expect(squawk).toHaveLength(1);
      expect(squawk[0].severity).toBe(expected);
    }
  });

  it("ignores routine codes and missing transponders", () => {
    // "----" is transponder-off or ADS-B-without-squawk; alerting on it live
    // would false-fire constantly, and it is exactly what the AA11 case shows
    // the system cannot honestly claim to detect.
    const state = byId("incident-aa11-2001");
    expect(runAllRules(state).filter((a) => a.category === "squawk-emergency")).toHaveLength(0);
  });

  it("stays quiet once the aircraft is on the ground", () => {
    const state = byId("drill-squawk-7500");
    const landed = {
      ...state,
      flights: state.flights.map((f) =>
        f.squawk === "7500" ? { ...f, phase: "landed" as const } : f,
      ),
    };
    expect(runAllRules(landed).filter((a) => a.category === "squawk-emergency")).toHaveLength(0);
  });
});

// ETA smoothing at ingest — the tuning change motivated by the KATL crosstab
// (79.1% of criticals from wake-spacing ETA jitter). Detectors stay pure; the
// smoothing is a pure function of (previous, current) owned by the caller.
describe("ETA smoothing (live-ingest tuning, Table 2 follow-up)", () => {
  const arrival = (id: string, etaMin: number): import("./types").Flight => ({
    id,
    callsign: id.toUpperCase(),
    type: "arrival",
    aircraft: "B738",
    wake: "medium",
    origin: "KLAX",
    destination: "KSFO",
    phase: "approach",
    altitudeFt: 4000,
    speedKts: 220,
    headingDeg: 281,
    positionNm: { x: -20, y: 0 },
    fuelMin: 90,
    etaMin,
    squawk: "2400",
  });

  it("blends against the previous tick with alpha 0.4", async () => {
    const { smoothEtas } = await import("./smoothing");
    const out = smoothEtas([arrival("a", 10)], [arrival("a", 12)]);
    expect(out[0].etaMin).toBeCloseTo(0.4 * 12 + 0.6 * 10, 10);
  });

  it("passes new aircraft through unchanged", async () => {
    const { smoothEtas } = await import("./smoothing");
    const out = smoothEtas([arrival("a", 10)], [arrival("a", 12), arrival("b", 7)]);
    expect(out.find((f) => f.id === "b")?.etaMin).toBe(7);
  });

  it("leaves departures untouched", async () => {
    const { smoothEtas } = await import("./smoothing");
    const dep = { ...arrival("d", 5), type: "departure" as const };
    const out = smoothEtas([{ ...dep, etaMin: 1 }], [dep]);
    expect(out[0].etaMin).toBe(5);
  });

  it("is pure: same inputs, same output", async () => {
    const { smoothEtas } = await import("./smoothing");
    const prev = [arrival("a", 10)];
    const cur = [arrival("a", 12)];
    expect(smoothEtas(prev, cur)).toEqual(smoothEtas(prev, cur));
    expect(prev[0].etaMin).toBe(10); // no mutation
  });

  // The mechanism the fix exists for: a lead/trail pair whose measured gap
  // oscillates across the wake critical boundary (gap < required − 1). Raw
  // input flips severity on alternating polls; the smoothed series does not.
  it("keeps a jittering wake gap from oscillating across the critical boundary", async () => {
    const { smoothEtas } = await import("./smoothing");
    // medium behind medium on one runway: required gap 2 min, critical < 1.
    const lead = (eta: number) => ({ ...arrival("lead", eta), assignedRunway: "28L" });
    const trail = (eta: number) => ({ ...arrival("trail", eta), assignedRunway: "28L" });

    // Trail's measured ETA oscillates ±0.4 min around a true 1.2 gap: the
    // aircraft are legally separated (gap > 1), but raw measurement dips the
    // gap to 0.8 on alternating polls and fires critical. Smoothing shrinks
    // the oscillation below the margin. (A true gap sitting within ~0.1 of
    // the boundary still flips even smoothed; no filter can conjure margin
    // that does not exist, and the validation window measures the residue.)
    const polls: Array<[number, number]> = [
      [4.0, 5.2], [4.0, 4.8], [4.0, 5.6], [4.0, 4.8], [4.0, 5.6], [4.0, 4.8],
    ];
    let prev: import("./types").Flight[] = [];
    const rawSev: string[] = [];
    const smoothSev: string[] = [];
    for (const [le, te] of polls) {
      const raw: import("./types").Flight[] = [lead(le), trail(te)];
      const smoothed = smoothEtas(prev, raw);
      prev = smoothed;
      const sevOf = (fl: typeof raw) => {
        const gap = fl[1].etaMin - fl[0].etaMin;
        return gap < 1 ? "critical" : gap < 2 ? "warning" : "none";
      };
      rawSev.push(sevOf(raw));
      smoothSev.push(sevOf(smoothed));
    }
    // Raw series flips between critical and warning; that is the noise.
    expect(new Set(rawSev.slice(1)).size).toBeGreaterThan(1);
    // Smoothed series settles and stays put after the first blend.
    expect(new Set(smoothSev.slice(2)).size).toBe(1);
  });
});

// Tuning change #2: lateral clustering in the multi-arrival runway-conflict
// branch. The KATL crosstab attributed 20.2% of criticals to legally separated
// parallel approaches sharing one heading-inferred runway label.
describe("parallel-approach lateral clustering (Table 2 follow-up)", () => {
  const finalArr = (id: string, x: number, y: number): import("./types").Flight => ({
    id,
    callsign: id.toUpperCase(),
    type: "arrival",
    aircraft: "B738",
    wake: "medium",
    origin: "----",
    destination: "KATL",
    phase: "final",
    altitudeFt: 1500,
    speedKts: 150,
    headingDeg: 92,
    positionNm: { x, y },
    assignedRunway: "08L/26R",
    fuelMin: 90,
    etaMin: 3,
    squawk: "2400",
  });

  const katlState = (flights: import("./types").Flight[]): import("./types").SimState => ({
    tick: 1,
    clockMin: 600,
    sectorId: "KATL TWR",
    flights,
    runways: [
      { id: "08L/26R", headingDeg: 92, lengthFt: 9000, mode: "mixed", surfaceFriction: "dry" },
    ],
    gates: [],
    weather: {
      windDirDeg: 270, windKts: 5, gustsKts: 5, visibilityNm: 10,
      ceilingFt: 20000, condition: "VFR", precipitation: "none",
    },
    alerts: [],
    speed: 1,
    trails: {},
  });

  const wakeAlerts = (alerts: import("./types").Alert[]) =>
    alerts.filter((a) => a.category === "wake-spacing");

  it("same-final pair inside the applicable minimum fires, naming both", () => {
    // Heading 092 makes cross-track ~= y, so this is one stream, 1.5 NM in
    // trail. Medium behind medium: TBL 5-5-2 states no wake minimum, so the
    // radar minimum governs and both aircraft are on final inside 10 NM, giving
    // 2.5 NM. 1.5 NM is therefore 1.0 NM inside, which lands exactly on the
    // critical boundary (gap < required - 1) and so reads as a warning.
    //
    // Before the wake and radar minima were separated this asserted critical,
    // because the model applied a 3 NM floor it read as a wake requirement. The
    // assertion changed because the doctrine did, not because behaviour drifted.
    const alerts = wakeAlerts(
      runAllRules(katlState([finalArr("a", -6, 0.01), finalArr("b", -7.5, 0.04)])),
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("warning");
    expect(alerts[0].flightIds.sort()).toEqual(["a", "b"]);
  });

  // The distinction the correction turns on: a real wake minimum still binds at
  // spacings the radar minimum would allow. A CWT category B leader (B772)
  // requires 5 NM ahead of a category F follower (B738), so 3.5 NM in trail is
  // a violation even though it clears both radar floors. The category comes
  // from the type designator, not the legacy wake field, which doctrine no
  // longer reads.
  it("a real wake minimum still binds above the radar floor", () => {
    // y is chosen to hold cross-track constant: at heading 092 the cross-track
    // axis is essentially y, so a 3.5 NM change in x needs y to move with it or
    // the pair lands in two streams and never forms. Same trap as the negative
    // controls in docs.
    const lead = { ...finalArr("h", -6, 0.01), aircraft: "B772", wake: "heavy" as const };
    const trail = finalArr("m", -9.5, -0.112);
    const alerts = wakeAlerts(runAllRules(katlState([lead, trail])));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].detail).toContain("5 NM required");
  });

  // And the converse: a pair with no wake minimum, spaced above the reduced
  // radar floor, is silent where the old 3 NM floor would have fired.
  it("no wake minimum and clear of the radar floor is silent", () => {
    const alerts = wakeAlerts(
      runAllRules(katlState([finalArr("a", -6, 0.01), finalArr("b", -8.8, -0.088)])),
    );
    expect(alerts).toHaveLength(0);
  });

  // The sharpest single case of the CWT migration. The legacy model classified
  // the B757 as heavy and demanded 5 NM ahead of a medium; CWT created
  // category E for the B757 because its wake does not behave like a heavy's,
  // and an E leader constrains only a category I follower. E over F is a blank
  // cell, so the 2.5 NM short-final radar minimum governs and 2.8 NM in trail
  // is legal, where the legacy doctrine fired at anything under 5.
  it("a B757 leader no longer over-constrains a large follower", () => {
    const lead = { ...finalArr("e", -6, 0.01), aircraft: "B752" };
    const trail = finalArr("f", -8.8, -0.088);
    expect(wakeAlerts(runAllRules(katlState([lead, trail])))).toHaveLength(0);
  });

  // But E over I is a stated 4 NM minimum, and it must still bind: the B757
  // keeps the one requirement CWT gives it.
  it("a B757 leader still binds a small follower at 4 NM", () => {
    // etaMin must break the tie explicitly: sequencing sorts by ETA, and with
    // equal ETAs the leader is whichever the stream clustering happened to
    // order first, which put the C208 in front and made the cell blank.
    const lead = { ...finalArr("e", -6, 0.01), aircraft: "B752", etaMin: 2 };
    const trail = { ...finalArr("i", -9, -0.096), aircraft: "C208" };
    const alerts = wakeAlerts(runAllRules(katlState([lead, trail])));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].detail).toContain("4 NM required");
  });

  // An unmapped type falls to the radar floor rather than to a guessed
  // category. The legacy lookup defaulted unknowns to light, which made them
  // light LEADERS attracting 3 to 4 NM requirements; the MAX and neo families
  // are absent from the 2021 FAA table, so this is the common case, not an
  // edge. B38M leading at 2.8 NM on short final: no wake minimum can be
  // stated, 2.5 NM radar governs, silent.
  it("an unmapped type falls to the radar floor, not a guessed category", () => {
    const lead = { ...finalArr("u", -6, 0.01), aircraft: "B38M" };
    const trail = finalArr("t", -8.8, -0.088);
    expect(wakeAlerts(runAllRules(katlState([lead, trail])))).toHaveLength(0);
  });

  // Visual-separation demotion. Under VMC the trailing pilot may hold visual
  // separation, which voids the radar minima (JO 7110.65 7-2-1) and is
  // unobservable from surveillance; measured on two 24-hour windows, every
  // admitted wake pair formed under VFR and 45 of 46 post-correction
  // violations were against the radar floor, not a wake minimum. So a floor
  // violation in VMC caps at warning; the same geometry under IFR, where
  // visual separation cannot be in play, keeps its computed severity; and a
  // stated wake-table minimum keeps severity in every condition.
  it("a radar-floor violation in visual conditions caps at warning", () => {
    // Two F-category aircraft 1.2 NM apart on short final: floor-governed,
    // more than a mile inside 2.5 NM, so critical by the distance test alone.
    const alerts = wakeAlerts(
      runAllRules(katlState([finalArr("a", -6, 0.01), finalArr("b", -7.2, -0.036)])),
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("warning");
    expect(alerts[0].reason).toContain("visual separation");
  });

  it("the same floor violation under IFR keeps its severity", () => {
    const st = katlState([finalArr("a", -6, 0.01), finalArr("b", -7.2, -0.036)]);
    const ifr = {
      ...st,
      weather: { ...st.weather, condition: "IFR" as const, visibilityNm: 2, ceilingFt: 800 },
    };
    const alerts = wakeAlerts(runAllRules(ifr));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("critical");
  });

  it("a stated wake minimum keeps severity in visual conditions", () => {
    // B772 (CWT B) leading B738 (F): stated 5 NM minimum, 3.5 NM in trail is
    // more than a mile inside it. Visual separation transfers wake
    // responsibility, but a pair inside the wake table's own minimum stays
    // critical whatever the weather.
    const lead = { ...finalArr("h", -6, 0.01), aircraft: "B772" };
    const trail = finalArr("m", -9.5, -0.112);
    const alerts = wakeAlerts(runAllRules(katlState([lead, trail])));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("critical");
  });

  it("co-presence on one final raises no runway-conflict critical", () => {
    // The removed doctrine. A continuous in-trail arrival stream is the
    // normal state of a busy field; it produced 156 of one 24-hour window's
    // 182 runway-conflict criticals at KDFW.
    const alerts = runAllRules(katlState([finalArr("a", -6, 0.01), finalArr("b", -7.5, 0.04)]));
    expect(alerts.filter((a) => a.category === "runway-conflict")).toHaveLength(0);
  });

  it("aircraft on distinct parallels are never paired", () => {
    // 0.5 NM lateral separation: different centrelines, both mislabelled 08L
    // by the heading-only runway inference. No stream, no pair, no alert.
    const alerts = wakeAlerts(
      runAllRules(katlState([finalArr("a", -6, 0), finalArr("b", -6.2, 0.5)])),
    );
    expect(alerts).toHaveLength(0);
  });

  it("the KATL four-parallel shape stays silent", () => {
    const alerts = runAllRules(
      katlState([
        finalArr("a", -5, 0),
        finalArr("b", -5.2, 0.3),
        finalArr("c", -5.4, 0.8),
        finalArr("d", -5.6, 1.1),
      ]),
    );
    expect(alerts.filter((a) => a.severity === "critical")).toHaveLength(0);
  });

  it("a tight pair inside one stream of a parallel bank is isolated to that pair", () => {
    const alerts = wakeAlerts(
      runAllRules(
        katlState([
          finalArr("a", -5, 0),
          finalArr("b", -6, 0.5),
          finalArr("c", -7.2, 0.53), // same stream as b, 1.2 NM behind
          finalArr("d", -7, 1.0),
        ]),
      ),
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].flightIds.sort()).toEqual(["b", "c"]);
  });
});

describe("tau-based proximity critical", () => {
  const flight = (
    id: string,
    x: number,
    y: number,
    headingDeg: number,
    speedKts: number,
    altitudeFt = 3000,
  ): import("./types").Flight => ({
    id,
    callsign: id.toUpperCase(),
    type: "arrival",
    aircraft: "B738",
    wake: "medium",
    origin: "----",
    destination: "KSFO",
    phase: "approach",
    altitudeFt,
    speedKts,
    headingDeg,
    positionNm: { x, y },
    fuelMin: 90,
    etaMin: 10,
    squawk: "2400",
  });

  const state = (flights: import("./types").Flight[]): import("./types").SimState => ({
    tick: 1,
    clockMin: 600,
    sectorId: "TEST",
    flights,
    runways: [],
    gates: [],
    weather: {
      windDirDeg: 270, windKts: 5, gustsKts: 5, visibilityNm: 10,
      ceilingFt: 20000, condition: "VFR", precipitation: "none",
    },
    alerts: [],
    speed: 1,
    trails: {},
  });

  const proximity = (fs: import("./types").Flight[]) =>
    runAllRules(state(fs)).filter((a) => a.category === "proximity-conflict");

  it("closing head-on pair inside the envelope is critical", () => {
    // 1.5 NM apart, 150 kts each, head-on: closure 300 kts, tau ~18 s.
    const a = flight("a", 0, 0, 90, 150, 3000);
    const b = flight("b", 1.5, 0, 270, 150, 3100);
    const alerts = proximity([a, b]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("critical");
  });

  it("a stable parallel pair at 0.4 NM stays at warning", () => {
    // Same heading, same speed, 0.4 NM lateral: no closure. The old distance
    // box called this a TCAS-grade emergency; it is a formation.
    const a = flight("a", 0, 0, 90, 200, 3000);
    const b = flight("b", 0, 0.4, 90, 200, 3100);
    const alerts = proximity([a, b]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("warning");
  });

  it("slow overtake with closest approach beyond 45 s stays at warning", () => {
    // Trail overtakes lead at 30 kts closure from 1.8 NM: tau ~3.6 min,
    // far beyond the 45 s critical window.
    const lead = flight("lead", 1.8, 0, 90, 170, 3050);
    const trail = flight("trail", 0, 0, 90, 200, 3000);
    const alerts = proximity([lead, trail]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("warning");
  });

  it("vertical separation over 200 ft blocks critical regardless of closure", () => {
    const a = flight("a", 0, 0, 90, 150, 3000);
    const b = flight("b", 1.5, 0, 270, 150, 3400);
    const alerts = proximity([a, b]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("warning");
  });
});

// wakeGapMargins: the boundary-design instrument. Same pairing walk as
// detectWakeSpacing, one source of truth.
describe("wakeGapMargins", () => {
  it("agrees with the wake detector on which pairs violate", () => {
    for (const s of SCENARIOS) {
      const state = s.build();
      const margins = wakeGapMargins(state);
      const violations = margins.filter((m) => m < 0).length;
      const wakeAlerts = runAllRules(state).filter((a) => a.category === "wake-spacing").length;
      expect(violations).toBe(wakeAlerts);
    }
  });

  it("criticals equal margins below -1", () => {
    for (const s of SCENARIOS) {
      const state = s.build();
      const critMargins = wakeGapMargins(state).filter((m) => m < -1).length;
      const critAlerts = runAllRules(state).filter(
        (a) => a.category === "wake-spacing" && a.severity === "critical",
      ).length;
      expect(critMargins).toBe(critAlerts);
    }
  });
});

// Established-on-final gate: wake separation binds aircraft on the approach
// path, and this model's "approach" phase admits downwind and base legs whose
// cross-track offset carries no in-trail meaning.
describe("wake pairing requires establishment on final", () => {
  const arr = (
    id: string,
    x: number,
    y: number,
    headingDeg = 92, // runway heading: established on final unless overridden
  ): import("./types").Flight => ({
    id,
    callsign: id.toUpperCase(),
    type: "arrival",
    aircraft: "B738",
    wake: "medium",
    origin: "----",
    destination: "KATL",
    phase: "approach",
    altitudeFt: 3000,
    speedKts: 180,
    headingDeg,
    positionNm: { x, y },
    assignedRunway: "08L/26R",
    fuelMin: 90,
    etaMin: 5,
    squawk: "2400",
  });

  const st = (flights: import("./types").Flight[]): import("./types").SimState => ({
    tick: 1,
    clockMin: 600,
    sectorId: "KATL TWR",
    flights,
    runways: [
      { id: "08L/26R", headingDeg: 92, lengthFt: 9000, mode: "mixed", surfaceFriction: "dry" },
    ],
    gates: [],
    weather: {
      windDirDeg: 270, windKts: 5, gustsKts: 5, visibilityNm: 10,
      ceilingFt: 20000, condition: "VFR", precipitation: "none",
    },
    alerts: [],
    speed: 1,
    trails: {},
  });

  const wake = (fs: import("./types").Flight[]) =>
    runAllRules(st(fs)).filter((a) => a.category === "wake-spacing");

  it("pairs two aircraft aligned with the runway 1.5 NM apart", () => {
    expect(wake([arr("a", -6, 0), arr("b", -7.5, 0.02)])).toHaveLength(1);
  });

  it("does not pair a downwind aircraft with one on final", () => {
    // Downwind runs opposite the landing direction: 272 against runway 092.
    expect(wake([arr("a", -6, 0), arr("b", -7.5, 0.02, 272)])).toHaveLength(0);
  });

  it("does not pair a base-leg aircraft with one on final", () => {
    // Base leg crosses the approach at right angles.
    expect(wake([arr("a", -6, 0), arr("b", -7.5, 0.02, 182)])).toHaveLength(0);
  });

  it("accepts an aircraft intercepting the localiser inside the tolerance", () => {
    expect(wake([arr("a", -6, 0), arr("b", -7.5, 0.02, 115)])).toHaveLength(1);
  });

  it("rejects a pair where neither is aligned", () => {
    expect(wake([arr("a", -6, 0, 272), arr("b", -7.5, 0.02, 272)])).toHaveLength(0);
  });
});

// The three projector defects (docs/projector-defects.md). Each test pins the
// physical invariant the fix restored, not the arithmetic that restored it.
describe("projector physical consistency", () => {
  const flightNamed = (state: SimState, id: string) =>
    state.flights.find((f) => f.id === id);

  it("a queued departure does not climb", () => {
    // Old behavior: queued aircraft at speed zero climbed 1,500 fpm on the
    // spot, so the +3 projection held a 747 at 4,500 ft over the hold-short
    // line, position unchanged.
    const state = byId("incident-tenerife-1977");
    const projected = projectState(state, 3);
    for (const f of projected.flights) {
      expect(f.phase).toBe("queued");
      expect(f.altitudeFt).toBe(0);
    }
  });

  it("an arrival that lands within the horizon leaves the projection", () => {
    const base = byId("nominal");
    const [a] = base.flights;
    const state: SimState = {
      ...base,
      flights: [
        { ...a, id: "short-final", type: "arrival", phase: "final", altitudeFt: 900, etaMin: 2 },
      ],
    };
    // Still present at +1 (ETA 1 min, 100 ft): landing has not happened yet.
    expect(flightNamed(projectState(state, 1), "short-final")).toBeDefined();
    // Gone at +3: projecting past touchdown used to clamp altitude to 0 ft,
    // and the proximity detector's altitude > 0 filter then silently dropped
    // exactly the aircraft closest to landing.
    expect(flightNamed(projectState(state, 3), "short-final")).toBeUndefined();
  });

  it("an arrival's phase advances with its projected ETA", () => {
    const base = byId("nominal");
    const [a] = base.flights;
    const state: SimState = {
      ...base,
      flights: [
        { ...a, id: "inbound", type: "arrival", phase: "enroute", altitudeFt: 8000, etaMin: 12 },
      ],
    };
    // Same thresholds the engine applies tick by tick: approach inside ten
    // minutes, final inside three.
    expect(flightNamed(projectState(state, 3), "inbound")?.phase).toBe("approach");
    expect(flightNamed(projectState(state, 10), "inbound")?.phase).toBe("final");
  });
});

// Extended-centreline attribution (docs/runway-attribution-limit.md closed).
// The registry's runway record carried no position, so parallels tied
// arbitrarily on heading: 51 of 62 strips share a heading with another strip.
// Attribution now uses real threshold coordinates and cross-track distance.
describe("runway attribution by extended centreline", () => {
  it("every end at every airport attributes to itself from its own centreline", () => {
    // The strongest form of the parallel-discrimination claim: place an
    // aircraft on each end's extended centreline at 2, 5 and 8 NM and require
    // its own label back. 124 ends, DFW's five same-heading strips included.
    for (const airport of Object.values(AIRPORTS)) {
      const geo = airportEndGeometries(airport);
      for (const end of geo) {
        for (const d of [2, 5, 8]) {
          const pos = {
            x: end.threshold.x - d * end.course.x,
            y: end.threshold.y - d * end.course.y,
          };
          const got = inferRunway(end.trueCourseDeg, 2000, airport.runways, geo, pos);
          expect(got, `${airport.icao} ${end.endLabel} at ${d} NM`).toBe(end.endLabel);
        }
      }
    }
  });

  it("every end attributes a departure climbing out from it", () => {
    // The arrival round-trip run backwards: place an aircraft PAST each end's
    // threshold on that end's centreline, flying the end's course, and require
    // its own label back. This is the geometry a climb-out follows for the
    // first miles, and it is what gives the departure population a runway to
    // be triaged by (docs/departure-fix-cost.md).
    for (const airport of Object.values(AIRPORTS)) {
      const geo = airportEndGeometries(airport);
      for (const end of geo) {
        for (const d of [1, 3, 6]) {
          const pos = {
            x: end.threshold.x + d * end.course.x,
            y: end.threshold.y + d * end.course.y,
          };
          const got = inferRunway(end.trueCourseDeg, 1500, airport.runways, geo, pos, true);
          expect(got, `${airport.icao} ${end.endLabel} departing at ${d} NM`).toBe(end.endLabel);
        }
      }
    }
  });

  it("runway identity compares true against true once the record carries it", () => {
    // The defect this replaces: attribution matched an aircraft's TRUE track
    // against a coordinate-derived course inside a 30-degree gate, while this
    // doctrine matched the same track against the registry's MAGNETIC heading
    // inside a 20-degree gate. Boston's 04L is 020 true and 044 magnetic, so an
    // aircraft correctly lined up on the runway it was cleared for was reported
    // as rolling on the wrong one, at critical.
    //
    // Runway.trueCourseDeg carries the coordinate-derived course, and
    // runwaysWithTrueCourse attaches it wherever surveyed thresholds exist. Both
    // halves of the comparison now come from one reference system.
    const bos = AIRPORTS.KBOS;
    const geo = airportEndGeometries(bos);
    const end = geo.find((e) => e.endLabel === "04L");
    if (!end) throw new Error("no 04L geometry");
    // The two sources still disagree; that is the registry's data and is not
    // what this fix changes.
    expect(Math.abs(end.trueCourseDeg - 44)).toBeGreaterThan(20);

    const onTheRoll = {
      x: end.threshold.x + 0.1 * end.course.x,
      y: end.threshold.y + 0.1 * end.course.y,
    };
    const assigned = inferRunway(end.trueCourseDeg, 0, bos.runways, geo, onTheRoll, true);
    expect(assigned).toBe("04L");

    const base = byId("nominal");
    const [a] = base.flights;
    const rolling = {
      ...a,
      id: "roll",
      callsign: "TST900",
      type: "departure" as const,
      phase: "queued" as const,
      altitudeFt: 0,
      speedKts: 60,
      headingDeg: end.trueCourseDeg,
      positionNm: onTheRoll,
      assignedRunway: assigned,
      etaMin: 0,
    };

    // With true courses attached, the aircraft is aligned and nothing fires.
    const fixed: SimState = {
      ...base,
      sectorId: "KBOS TWR",
      runways: runwaysWithTrueCourse(bos),
      flights: [rolling],
    };
    expect(
      runAllRules(fixed).filter((x) => x.category === "runway-identity"),
    ).toHaveLength(0);

    // Without them the old comparison returns, which is why the field exists
    // and why every consumer falls back rather than assuming one is present.
    const unfixed: SimState = { ...fixed, runways: bos.runways };
    const stale = runAllRules(unfixed).filter((x) => x.category === "runway-identity");
    expect(stale).toHaveLength(1);
    expect(stale[0].severity).toBe("critical");
  });

  it("a departure beyond the along-track cap gets no attribution", () => {
    const geo = airportEndGeometries(AIRPORTS.KATL);
    const end = geo.find((e) => e.endLabel === "27L");
    if (!end) throw new Error("no 27L geometry");
    const far = {
      x: end.threshold.x + 12 * end.course.x,
      y: end.threshold.y + 12 * end.course.y,
    };
    expect(inferRunway(end.trueCourseDeg, 3000, AIRPORTS.KATL.runways, geo, far, true)).toBeUndefined();
  });

  it("the arrival and departure sides of one end do not claim each other", () => {
    // An aircraft on the approach side is an arrival to this end; one past the
    // threshold has either landed or is departing. Asking the wrong question
    // of either position must return nothing, because that is what kept a
    // rolling-out arrival from holding the attribution of the runway it had
    // just used.
    const geo = airportEndGeometries(AIRPORTS.KATL);
    const end = geo.find((e) => e.endLabel === "27L");
    if (!end) throw new Error("no 27L geometry");
    const approaching = {
      x: end.threshold.x - 4 * end.course.x,
      y: end.threshold.y - 4 * end.course.y,
    };
    const departing = {
      x: end.threshold.x + 4 * end.course.x,
      y: end.threshold.y + 4 * end.course.y,
    };
    const rwys = AIRPORTS.KATL.runways;
    expect(inferRunway(end.trueCourseDeg, 2000, rwys, geo, approaching, false)).toBe(end.endLabel);
    expect(inferRunway(end.trueCourseDeg, 2000, rwys, geo, approaching, true)).toBeUndefined();
    expect(inferRunway(end.trueCourseDeg, 2000, rwys, geo, departing, true)).toBe(end.endLabel);
    expect(inferRunway(end.trueCourseDeg, 2000, rwys, geo, departing, false)).toBeUndefined();
  });

  it("an aircraft off every centreline gets no attribution", () => {
    const katl = AIRPORTS.KATL;
    const geo = airportEndGeometries(katl);
    const end = geo.find((e) => e.endLabel === "26R");
    if (!end) throw new Error("no 26R geometry");
    // 5 NM out but displaced 2 NM perpendicular to the course: outside the
    // 0.6 NM cap for every parallel, so attribution declines rather than
    // guessing. The legacy heuristic would have assigned it on heading alone.
    const pos = {
      x: end.threshold.x - 5 * end.course.x - 2 * end.course.y,
      y: end.threshold.y - 5 * end.course.y + 2 * end.course.x,
    };
    expect(inferRunway(end.trueCourseDeg, 2000, katl.runways, geo, pos)).toBeUndefined();
  });

  it("cross-track and along-track measure what they claim", () => {
    const geo = airportEndGeometries(AIRPORTS.KATL);
    const end = geo.find((e) => e.endLabel === "27L");
    if (!end) throw new Error("no 27L geometry");
    const onFinal = {
      x: end.threshold.x - 5 * end.course.x + 0.3 * -end.course.y,
      y: end.threshold.y - 5 * end.course.y + 0.3 * end.course.x,
    };
    expect(crossTrackToEndNm(onFinal, end)).toBeCloseTo(0.3, 5);
    expect(alongTrackToThresholdNm(onFinal, end)).toBeCloseTo(5, 5);
    const pastThreshold = {
      x: end.threshold.x + 1 * end.course.x,
      y: end.threshold.y + 1 * end.course.y,
    };
    expect(alongTrackToThresholdNm(pastThreshold, end)).toBeCloseTo(-1, 5);
  });

  it("without geometry the legacy heading-only path is unchanged", () => {
    const katl = AIRPORTS.KATL;
    // Same call the scenario path makes: no geometry, no position. Heading
    // 272 matches the 26/27/28 family and the arbitrary tie stands, which is
    // exactly what the papers document for the legacy heuristic.
    const got = inferRunway(272, 2000, katl.runways);
    expect(got).toBeDefined();
    expect(["26R", "26L", "27R", "27L", "28"]).toContain(got);
  });
});

// Negative controls encoding specific NASA ASRS reports (see the builders in
// scenarios.ts for the records and what each figure comes from). These pin
// the assertion the corpus previously could not make: that the doctrine ran
// against real narrative geometry, and stopped where the outcome says it
// should have.
describe("ASRS-encoded negative controls", () => {
  it("ACN 2071367: inside the CWT minimum in IMC draws a wake warning, never a critical", () => {
    const state = byId("negative-control-asrs-ewr");
    const pairs = wakeCandidatePairs(state).filter((p) => p.withinBand);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].required).toBe(5);
    const alerts = runPredictiveRules(state);
    const wake = alerts.filter((a) => a.category === "wake-spacing" && !a.lookaheadMin);
    expect(wake).toHaveLength(1);
    expect(wake[0].severity).toBe("warning");
    expect(alerts.filter((a) => a.severity === "critical")).toHaveLength(0);
  });

  it("CALLBACK 461: a 1,000 ft crossing under visual separation stays silent", () => {
    // The pair sits exactly on the proximity doctrine's vertical boundary;
    // the predicate requires a gap strictly inside 1,000 ft.
    expect(runPredictiveRules(byId("negative-control-asrs-iah"))).toHaveLength(0);
  });

  it("ACN 2069720: en-route wake behind a heavy forms no wake pair", () => {
    const state = byId("negative-control-asrs-zma");
    expect(wakeCandidatePairs(state)).toHaveLength(0);
    const alerts = runPredictiveRules(state);
    expect(alerts.filter((a) => a.severity === "critical")).toHaveLength(0);
  });
});

// The committed BlueSky exports must match what the scenarios currently
// build. A stale .scn is worse than none: it hands a reviewer geometry the
// corpus no longer encodes.
describe("BlueSky export drift", () => {
  // Drift-checking compares the files against the scenarios and cannot tell
  // whether either is loadable. Two of the 77 CRE lines carried the provenance
  // note as a trailing comment, which reads fine and is not what BlueSky
  // parses: only a whole line beginning with "#" is a comment, so the note
  // landed inside the speed argument and those two aircraft would not have been
  // created by anyone who ran the file. Found 2026-09-01 by parsing the exports
  // as BlueSky would rather than as prose.
  it("every exported line is a BlueSky command a parser would accept", () => {
    const dir = `${__dirname}/../../bluesky`;
    const files = readdirSync(dir).filter((f) => f.endsWith(".scn"));
    const problems: string[] = [];
    let creLines = 0;
    for (const file of files) {
      const lines = readFileSync(`${dir}/${file}`, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (line === "" || line.startsWith("#")) return;
        if (!/^\d{2}:\d{2}:\d{2}\.\d{2}>/.test(line)) {
          problems.push(`${file}:${index + 1} not a timestamped command`);
          return;
        }
        const command = line.slice(line.indexOf(">") + 1);
        if (!command.startsWith("CRE ")) return;
        creLines++;
        const fields = command.slice(4).split(",");
        if (fields.length !== 7) {
          problems.push(`${file}:${index + 1} CRE has ${fields.length} fields`);
          return;
        }
        const [callsign, type, ...numbers] = fields;
        if (!callsign.trim() || !type.trim()) {
          problems.push(`${file}:${index + 1} empty callsign or type`);
        }
        for (const value of numbers) {
          if (!/^-?\d+(\.\d+)?$/.test(value)) {
            problems.push(`${file}:${index + 1} non-numeric field "${value}"`);
          }
        }
      });
    }
    expect(problems).toEqual([]);
    // Known-positive: an empty directory, or a parse that reached no CRE line,
    // would report no problems.
    expect(files.length).toBeGreaterThan(20);
    expect(creLines).toBeGreaterThan(50);
  });

  it("bluesky/*.scn match their scenarios", () => {
    const { execSync } = require("node:child_process");
    execSync("./node_modules/.bin/tsx scripts/export-bluesky-scn.mjs --verify", {
      cwd: `${__dirname}/../..`,
      stdio: "pipe",
    });
  });
});

// The phase vocabulary live ingest can actually produce, pinned so the audit
// in docs/phase-vocabulary-audit.md cannot go quietly out of date. Three of
// the nine declared phases are unreachable live, and several detectors gate on
// them, so a change to the ingest heuristic changes which doctrines are
// reachable at all. That is the shape of the runway-identifier defect and of
// the departure blind spot: a mismatch between the vocabulary the scenarios
// use and the vocabulary the feed supplies, invisible to both the tests and
// the live measurement.
// The proxy has always set x-proxy-age and x-proxy-stale, and until 2026-08-28
// nothing read them. Its own comment claimed "the client surfaces the marker",
// and the operator surface timed "updated Ns ago" from the arrival of the HTTP
// response, so a picture the proxy had held for as long as STALE_LIMIT_SECONDS
// in functions/api/_cached-proxy.ts, ten minutes at present, was displayed as
// current during an upstream refusal. That is the wrong number on a
// decision-support surface, and it is exactly the defect class this suite
// exists to catch: documented behaviour that was never built.
describe("live traffic carries the proxy's age, not the round trip's", () => {
  const withFetch = async (headers: Record<string, string>) => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ac: [] }), {
        status: 200,
        headers: { "content-type": "application/json", ...headers },
      })) as typeof globalThis.fetch;
    try {
      return await fetchLiveTrafficDetailed(AIRPORTS.KJFK);
    } finally {
      globalThis.fetch = original;
    }
  };

  it("reports the proxy's age in seconds", async () => {
    const res = await withFetch({ "x-proxy-age": "137", "x-proxy-stale": "true" });
    expect(res.ageSeconds).toBe(137);
    expect(res.stale).toBe(true);
  });

  it("reads a fresh cached copy as not stale", async () => {
    const res = await withFetch({ "x-proxy-age": "4", "x-proxy-stale": "false" });
    expect(res.ageSeconds).toBe(4);
    expect(res.stale).toBe(false);
  });

  it("reports an unreadable age as unknown, not as zero", async () => {
    // This pinned zero until 2026-09-01, for a good reason badly served: a NaN
    // would propagate into liveUpdatedAt and render "updated NaNs ago". Zero
    // avoids that and asserts something false instead, namely that the picture
    // was fetched at this instant, which is the exact claim the age header was
    // introduced to stop the surface making. Undefined satisfies the original
    // requirement, never rendering NaN, without the fabrication; the reducer
    // then leaves liveUpdatedAt unset and the surface says the age is unknown.
    const missing = await withFetch({});
    expect(missing.ageSeconds).toBeUndefined();
    expect(missing.stale).toBe(false);

    // Unparseable is the same case as absent, and used not to be.
    const garbled = await withFetch({ "x-proxy-age": "not-a-number" });
    expect(garbled.ageSeconds).toBeUndefined();
  });
});

describe("live phase vocabulary (docs/phase-vocabulary-audit.md)", () => {
  it("arrival classification reaches exactly the audited phases", () => {
    const cases: Array<[number, number, number, string]> = [
      // altitude ft, ground speed kts, distance NM, expected
      [0, 5, 0.1, "queued"],
      [0, 60, 0.5, "taxi-out"], // a LANDED arrival rolling out, named for the opposite manoeuvre
      [1500, 140, 3, "final"],
      [4000, 200, 12, "approach"],
      [30000, 450, 60, "enroute"],
      [12000, 300, 30, "approach"], // the catch-all
    ];
    const seen = new Set<string>();
    for (const [alt, gs, dist, expected] of cases) {
      const got = phaseFromAlt(alt, gs, dist);
      expect(got, `alt=${alt} gs=${gs} dist=${dist}`).toBe(expected);
      seen.add(got);
    }
    expect([...seen].sort()).toEqual(["approach", "enroute", "final", "queued", "taxi-out"]);
  });

  it("never produces landed, at-gate or taxi-in", () => {
    // Swept across the plausible input space rather than argued from the
    // source, so a rewrite of the heuristic is caught rather than trusted.
    const unreachable = new Set(["landed", "at-gate", "taxi-in"]);
    for (let alt = 0; alt <= 40000; alt += 500) {
      for (const gs of [0, 20, 35, 120, 250, 480]) {
        for (const dist of [0.1, 3, 12, 25, 39]) {
          expect(unreachable.has(phaseFromAlt(alt, gs, dist))).toBe(false);
        }
      }
    }
  });
});

// The corpus table in the paper asserts, per incident, the highest-severity
// alert the system produces. That column had never been checked against
// detector output: two of its nine rows were wrong when audited on 2026-08-25.
// It is a measurement and belongs under the same rule as every other number
// here, so it is pinned rather than remembered.
describe("incident corpus severity (paper Section 6.3 table)", () => {
  const RANK: Record<string, number> = { critical: 0, warning: 1, advisory: 2, info: 3 };
  const highest = (id: string) => {
    const alerts = runPredictiveRules(byId(id)).filter((a) => !a.lookaheadMin);
    if (alerts.length === 0) return null;
    return [...alerts].sort((a, b) => RANK[a.severity] - RANK[b.severity])[0];
  };

  const EXPECTED: Array<[string, string | null, string | null]> = [
    ["incident-tenerife-1977", "critical", "runway-conflict"],
    ["incident-avianca052-1990", "critical", "fuel-hold"],
    // Warning, not critical. The paper claimed critical until the audit.
    ["incident-lax-1991", "warning", "runway-conflict"],
    ["incident-linate-2001", "critical", "runway-conflict"],
    // Warning, and by six thousandths of a nautical mile: see
    // docs/potomac-severity-margin.md. Pinned so that a change to the encoded
    // geometry or to DMOD cannot flip the flagship case quietly.
    ["incident-dca-2025", "warning", null],
    ["incident-lga-2025", "critical", "runway-conflict"],
    ["incident-jfk-2026", "advisory", "proximity-conflict"],
    ["incident-comair5191-2006", "critical", "runway-identity"],
    ["incident-aa11-2001", null, null],
  ];

  for (const [id, severity, category] of EXPECTED) {
    it(`${id} tops out at ${severity ?? "no alert"}`, () => {
      const top = highest(id);
      if (severity === null) {
        expect(top).toBeNull();
        return;
      }
      expect(top?.severity).toBe(severity);
      if (category) expect(top?.category).toBe(category);
    });
  }

  it("the Potomac pair misses the critical tier on miss distance alone", () => {
    // Convergence and the vertical envelope both pass; the miss distance at
    // closest approach is 0.506 NM against a DMOD of 0.500. Asserting the two
    // passing conditions separately is what makes the near-miss legible: a
    // future reader seeing "warning" should not conclude the pair was benign.
    const pairs = proximityPairs(byId("incident-dca-2025"));
    expect(pairs).toHaveLength(1);
    const [p] = pairs;
    expect(p.vertFt).toBeLessThan(200);
    expect(p.horizNm).toBeLessThan(1);
    expect(p.critical).toBe(false);
  });
});

// The papers' countable claims about the system, checked against the system.
// Every number in a paper that describes the code is regenerable, so it is
// regenerated rather than remembered. Run against the thesis, which lives in
// this repository; the shorter whitepaper lives in another one and is checked
// by running the script against its path.
//
// This check found three stale claims on its first run, one of them heading
// the doctrine table in Section 5.4: "Seven detectors are implemented" sitting
// immediately above a table listing eleven.
describe("paper claims match the code (scripts/verify-paper-claims.mjs)", () => {
  it("the thesis's countable claims are current", () => {
    const { execFileSync } = require("node:child_process");
    const root = `${__dirname}/../..`;
    // The test count is passed in rather than measured, because measuring it
    // from inside the suite it counts would recurse.
    execFileSync(
      "./node_modules/.bin/tsx",
      ["scripts/verify-paper-claims.mjs", "--tests", String(TOTAL_TESTS)],
      { cwd: root, stdio: "pipe" },
    );
  });
});

// Magnetic variation is a property of a place, not of a strip. Within one
// airport it changes by well under a degree, so `headingDeg - trueCourseDeg`
// must be the same for every runway there: headingDeg is documented magnetic,
// trueCourseDeg is derived from surveyed thresholds, and their difference is
// the variation. Where the spread across a field's strips is ten degrees, one
// of the two numbers is wrong for at least one strip, and until this describe
// block was written neither this suite nor any measurement was checking it.
// The past tense matters: the sentence sat in the present for a while after
// the check below existed, which reads as an open hole immediately above the
// thing that closed it.
//
// It matters at the scale the doctrines work at. Departure attribution gates on
// 30 degrees and runway identity on 20, so a ten-degree internal inconsistency
// spends a third to a half of that budget before any aircraft is off centreline.
// The three fields the false-positive windows sample, Atlanta, O'Hare and
// Dallas Fort Worth, are all in the inconsistent group.
//
// The current state is PINNED rather than asserted clean, because correcting
// the registry moves live runway attribution and cannot land while a
// measurement window is open. Fixing a field means deleting its entry here,
// which makes the correction deliberate and visible in a diff instead of a
// silently improving number.
describe("runway records agree with themselves on magnetic variation", () => {
  const KNOWN_INCONSISTENT_DEG: Record<string, number> = {
    KSFO: 14.8,
    KBOS: 11.9,
    KORD: 10.5,
    KDFW: 8.9,
    KATL: 7.0,
  };
  // Two international fields sit just above the tolerance at about three
  // degrees. That is small enough to be rounding in a published heading rather
  // than a wrong threshold, and it is recorded so the tolerance is a stated
  // choice rather than a number picked to make the test pass.
  const TOLERANCE_DEG = 3.5;

  const spreadOf = (icao: string): number | null => {
    const airport = AIRPORTS[icao];
    const geo = airportEndGeometries(airport);
    const diffs: number[] = [];
    for (const runway of airport.runways) {
      const end = geo.find((e) => e.endLabel === runway.id.split("/")[0]);
      if (!end) continue;
      let d = runway.headingDeg - end.trueCourseDeg;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      diffs.push(d);
    }
    if (diffs.length < 2) return null;
    return Math.max(...diffs) - Math.min(...diffs);
  };

  it("every field is either consistent or a known-bad entry here", () => {
    for (const icao of Object.keys(AIRPORTS)) {
      const spread = spreadOf(icao);
      if (spread === null) continue;
      const known = KNOWN_INCONSISTENT_DEG[icao];
      if (known === undefined) {
        expect(spread, `${icao} variation spread across its strips`).toBeLessThanOrEqual(
          TOLERANCE_DEG,
        );
      } else {
        // Within half a degree of the pinned value: the data has not drifted,
        // and it has not been fixed without updating this list either.
        expect(Math.abs(spread - known), `${icao} pinned spread moved`).toBeLessThan(0.5);
      }
    }
  });

  it("names a field whose entry is stale rather than passing quietly", () => {
    for (const icao of Object.keys(KNOWN_INCONSISTENT_DEG)) {
      const spread = spreadOf(icao);
      expect(spread, `${icao} is listed as inconsistent but has no geometry`).not.toBeNull();
      expect(
        spread as number,
        `${icao} is now consistent; delete it from KNOWN_INCONSISTENT_DEG`,
      ).toBeGreaterThan(TOLERANCE_DEG);
    }
  });
});

// Sharper than the variation-spread check above, and decisive where that one
// only says a field disagrees with itself. Two strips with the same surveyed
// true course are physically parallel, and parallel strips at one airport
// cannot have different magnetic headings: there is one magnetic north for the
// field. Any disagreement inside a family is a wrong headingDeg, provable from
// the record alone with no external survey.
//
// It also shows where the wrong values came from. Both offenders sit at fields
// where the runway designator shifts away from the magnetic bearing because
// there are more parallel strips than L/C/R can label. KATL's five parallels
// are all 90.0 true and four of them read 92, while 10/28 reads 99, which is
// its designator rather than its heading. KDEN's four parallels are all 180.5
// true and split 174 against 184, mirroring the 16/17 designator split. So
// headingDeg was taken from the strip's name instead of its survey at exactly
// the fields where the name stops tracking the bearing.
//
// Pinned rather than corrected, for the same reason as the check above: KATL is
// one of the three fields the open measurement window samples.
describe("parallel strips agree on magnetic heading", () => {
  // KDEN@180.5 was here until 2026-08-29, when its two 17 strips were
  // corrected from 184 to 174. The field is not in the sampling set, so that
  // fix could land while a window was open on KATL, KORD and KDFW. KATL@90.0
  // stays until the window closes.
  const KNOWN_SPLIT_FAMILIES = new Set(["KATL@90.0"]);

  const familiesOf = (icao: string) => {
    const airport = AIRPORTS[icao];
    const geo = airportEndGeometries(airport);
    const families = new Map<string, number[]>();
    for (const runway of airport.runways) {
      const end = geo.find((e) => e.endLabel === runway.id.split("/")[0]);
      if (!end) continue;
      const key = `${icao}@${end.trueCourseDeg.toFixed(1)}`;
      families.set(key, [...(families.get(key) ?? []), runway.headingDeg]);
    }
    return families;
  };

  it("no unlisted family carries two headings for one true course", () => {
    for (const icao of Object.keys(AIRPORTS)) {
      for (const [key, headings] of familiesOf(icao)) {
        if (KNOWN_SPLIT_FAMILIES.has(key)) continue;
        expect(
          new Set(headings).size,
          `${key} has headings ${[...new Set(headings)].join(", ")} on one true course`,
        ).toBe(1);
      }
    }
  });

  it("every pinned family is still split, so a fix cannot land unnoticed", () => {
    for (const key of KNOWN_SPLIT_FAMILIES) {
      const icao = key.split("@")[0];
      const headings = familiesOf(icao).get(key);
      expect(headings, `${key} no longer exists; the pin is stale`).toBeDefined();
      expect(
        new Set(headings as number[]).size,
        `${key} now agrees; delete it from KNOWN_SPLIT_FAMILIES`,
      ).toBeGreaterThan(1);
    }
  });
});

// A third internal check on the same records, and the same shape as the two
// above: the surveyed thresholds give a distance, `lengthFt` states one, and
// they have to describe the same strip.
//
// They are allowed to differ a little. Threshold-to-threshold is the distance
// between the landing thresholds, while a stated runway length is usually the
// full paved length, so a displaced threshold makes the derived figure the
// shorter of the two legitimately. A few per cent is that. Fifty per cent is
// not: KORD 09R/27L states 7,500 ft against 11,231 ft between its own
// thresholds, and runway-ends-data.ts records that this strip's east end moved
// 3,589 ft when the coordinates were rebuilt from NASR because of the 2021
// extension. The coordinates were corrected for the extension and the length
// beside them was not, which is the same failure as the KBOS heading note: a
// measurement made, written down, and left contradicting the number next to it.
//
// Not corrected here, deliberately. lengthFt feeds no detector, so changing it
// would be safe for the open measurement window; what is missing is a
// defensible value. The derived 11,231 ft is threshold-to-threshold rather than
// a published runway length, and this repository holds no source for the
// latter. Fixing it needs NASR open, like the headings.
//
// An earlier version of this comment said the field appears "only in the
// runway-identity alert's message". It appears in two places: RadarMap.tsx
// divides it by 6,076 for the drawn length of the strip, so KORD 09R/27L is
// drawn a third short as well as named wrongly. The angle was the same story
// until the true-course fix: the function read headingDeg, so KATL's 10/28
// rendered seven degrees off parallel from the four strips it is parallel to.
// RadarMap.tsx reads `rwy.trueCourseDeg ?? rwy.headingDeg` now, so a field with
// surveyed thresholds draws correctly and only one without them falls back to
// the stated heading. Corrected here 2026-09-01, having outlived the defect it
// described. The length half stands: nothing derives a drawn length from
// thresholds. Neither field reaches a detector; the length still reaches the
// screen.
describe("stated runway length agrees with the surveyed thresholds", () => {
  const KNOWN_LENGTH_DISAGREEMENTS = new Set([
    "KLAX 07L/25R",
    "KORD 09L/27R",
    "KORD 09R/27L",
    "OMDB 12L/30R",
    "OMDB 12R/30L",
  ]);
  const TOLERANCE_PCT = 5;

  it("no unlisted strip disagrees with its own thresholds", () => {
    for (const icao of Object.keys(AIRPORTS)) {
      const airport = AIRPORTS[icao];
      const geo = airportEndGeometries(airport);
      for (const runway of airport.runways) {
        const key = `${icao} ${runway.id}`;
        if (KNOWN_LENGTH_DISAGREEMENTS.has(key)) continue;
        const [first, second] = runway.id.split("/");
        const a = geo.find((e) => e.endLabel === first);
        const b = geo.find((e) => e.endLabel === second);
        if (!a || !b) continue;
        const dx = a.threshold.x - b.threshold.x;
        const dy = a.threshold.y - b.threshold.y;
        const ft = Math.hypot(dx, dy) * 6076.12;
        const pct = (100 * (ft - runway.lengthFt)) / runway.lengthFt;
        expect(
          Math.abs(pct),
          `${key} states ${runway.lengthFt} ft, thresholds give ${Math.round(ft)} ft`,
        ).toBeLessThanOrEqual(TOLERANCE_PCT);
      }
    }
  });
});

// Every assignedRunway and assignedGate in the corpus has to name something the
// scenario actually declares, or the assignment is inert and the scenario is
// exercising less than it says it does.
//
// It found one. negative-control-asrs assigned "10L/28R" and "10R/28L" while
// declaring its runways by single end (28L, 28R, 01L, 01R), so neither
// assignment resolved and the control ran with no assigned runway at all. The
// output was unchanged by the correction, because the parallel-approach
// demotion works from geometry rather than from the clearance, which is the
// safest way for a latent defect like this to sit: silently, in a scenario
// whose whole job is to assert that the system stays quiet for the right
// reason. Section 6.8 describes this control as placing two arrivals on 10L/28R
// and 10R/28L, and the strip names in that sentence were the only place those
// ids existed.
describe("the wake matrix is TBL 5-5-2 as the FAA publishes it", () => {
  // The separation minima are doctrine, transcribed by hand from FAA Order
  // JO 7110.126B Appendix B, TBL 5-5-2, Wake Turbulence Separation for On
  // Approach. Until 2026-08-31 nothing had compared the transcription against
  // the source; the papers cited the table and the code was trusted to hold it.
  //
  // Fetched from faa.gov and read cell by cell that day: all 81 agree. The
  // table below is that reading, kept here so a future edit to the matrix has
  // to argue with the published minima rather than with a comment.
  //
  // The shape looks wrong until the categories are read. Category D requires
  // MORE behind it than category C for the same follower, 6 NM against 5 for
  // an H, which reads as a monotonicity error. It is not: C is Pairwise Lower
  // Heavy and D is Non-Pairwise Heavy, and a pairwise category exists because
  // that specific pairing was studied and earned reduced separation. Weight
  // ordering is not what the categories encode.
  const TBL_5_5_2: Record<string, Record<string, number | null>> = {
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
  // One type per category, each confirmed against TBL A-1 in the same order by
  // its column position rather than by reading order, because D, F and G each
  // occupy two sub-columns and token order puts types in the wrong category.
  const REPRESENTATIVE: Record<string, string> = {
    A: "A388", B: "B77W", C: "A306", D: "A124", E: "B752",
    F: "A320", G: "CRJ9", H: "B190", I: "BE20",
  };

  it("every representative type resolves to the category it represents", () => {
    for (const [category, type] of Object.entries(REPRESENTATIVE))
      expect(cwtFromType(type), `${type} should be CWT ${category}`).toBe(category);
  });

  it("all 81 cells match the published minima", () => {
    const flight = (aircraft: string) => ({ aircraft }) as Parameters<typeof wakeMinimumNm>[0];
    const wrong: string[] = [];
    let compared = 0;
    for (const [lead, row] of Object.entries(TBL_5_5_2)) {
      for (const [trail, published] of Object.entries(row)) {
        compared += 1;
        const got = wakeMinimumNm(flight(REPRESENTATIVE[lead]), flight(REPRESENTATIVE[trail]));
        if (got !== published)
          wrong.push(`${lead} leading ${trail}: code ${got}, TBL 5-5-2 ${published}`);
      }
    }
    expect(wrong).toEqual([]);
    // The name of this test is a count, so it is asserted rather than
    // implied: nine categories squared, and a comparison that examined
    // fewer has not checked the table it claims to.
    expect(compared).toBe(81);
  });
});

describe("no wake pair in the corpus is skipped for an unmapped type", () => {
  // `wakeRequirement` returns null when either aircraft has no CWT category,
  // and a null requirement means the pair is passed over in silence. That is
  // correct behaviour against live traffic, where the papers report an unmapped
  // rate of about 14 per cent in one window led by the A321neo and 737 MAX 8,
  // because TBL A-1 dates from 2021 and guessing a category would be worse than
  // falling to the radar floor.
  //
  // In the corpus it would be a hole rather than a limitation. Six of the
  // thirty types the scenarios use have no CWT assignment, B707, B72S, C172,
  // H60, PA28 and UNKN, all of them legacy airframes, general aviation or a
  // helicopter. None currently sits in a wake pair, so nothing is skipped. A
  // scenario added later with one of them in a pair would exercise no wake
  // doctrine and still pass, which is the defect this corpus has already had
  // once: the negative controls were found asserting silence without ever
  // running the detector they were written for.
  it("every candidate wake pair resolves both categories", () => {
    const skipped: string[] = [];
    // Counted because the paragraph above describes exactly the failure this
    // test would otherwise have: no candidate pairs means nothing skipped.
    let pairs = 0;
    for (const scenario of SCENARIOS) {
      for (const pair of wakeCandidatePairs(scenario.build())) {
        pairs += 1;
        const lead = cwtFromType(pair.lead.aircraft);
        const trail = cwtFromType(pair.trail.aircraft);
        if (!lead || !trail)
          skipped.push(
            `${scenario.id}: ${pair.lead.aircraft}(${lead ?? "unmapped"}) leads ${pair.trail.aircraft}(${trail ?? "unmapped"})`,
          );
      }
    }
    expect(skipped).toEqual([]);
    expect(pairs).toBeGreaterThan(0);
  });
});

describe("runway identifiers agree with the heading each record stores", () => {
  // A runway's identifier is its magnetic heading rounded to the nearest ten
  // and divided by ten: 04 is 035 through 044 magnetic. So `id` and
  // `headingDeg` record one fact twice, and they can be compared.
  //
  // Not end by end, though, and the first version of this test made exactly
  // that mistake. It flagged 34 of 124 ends across seven fields and most of
  // those were correct records. An airport with more than three parallel
  // strips cannot label them all with one number, because the suffixes are
  // only L, C and R, so it uses the adjacent number for the rest: Dallas Fort
  // Worth carries 17C, 17L, 17R, 18L and 18R on five parallels that all store
  // heading 184, and Denver carries 16L, 16R, 17L and 17R on four at 174.
  // Comparing each end against the rounding calls the 17s at Dallas and the
  // 16s at Denver wrong when they are the convention working as intended.
  //
  // The sound comparison is per heading group. Every strip storing the same
  // heading is the same alignment, and the convention always leaves ONE of
  // them on the rounded number and shifts the others off it. So a group where
  // NO identifier matches the rounding cannot be the convention, and is the
  // record contradicting itself.
  //
  // Two groups fail: San Francisco's 10L/10R at 119 and Seattle's 16L/16C/16R
  // at 174. Both offsets are the local magnetic variation, which is the
  // signature of a stored TRUE course where a magnetic one is meant. Pinned
  // rather than corrected, because changing a stored heading moves live
  // attribution and the cross-track axis and the right values need FAA NASR
  // data this project does not hold.
  const KNOWN_INCONSISTENT: Record<string, number> = {
    "KSFO 119": 19,
    "KSEA 174": 14,
  };
  // Five degrees is inherent, not tuned: the identifier rounds the heading to
  // the nearest ten, so a truthful record sits up to five degrees off the
  // value its identifier implies.
  const ROUNDING_DEG = 5;

  const groupOffsets = () => {
    const out: { key: string; ends: string[]; best: number }[] = [];
    for (const [icao, ap] of Object.entries(AIRPORTS)) {
      const groups = new Map<number, string[]>();
      for (const runway of ap.runways) {
        const first = runway.id.split("/")[0];
        if (!groups.has(runway.headingDeg)) groups.set(runway.headingDeg, []);
        groups.get(runway.headingDeg)!.push(first);
      }
      for (const [heading, ends] of groups) {
        const best = Math.min(
          ...ends.map((end) => {
            let d = heading - Number.parseInt(end, 10) * 10;
            if (d > 180) d -= 360;
            if (d < -180) d += 360;
            return Math.abs(d);
          }),
        );
        out.push({ key: `${icao} ${heading}`, ends, best });
      }
    }
    return out;
  };

  it("leaves one identifier on the rounded heading in every parallel group", () => {
    const surprises = groupOffsets().filter(
      ({ key, best }) => best > Math.max(ROUNDING_DEG, KNOWN_INCONSISTENT[key] ?? 0),
    );
    expect(surprises.map((g) => `${g.key} ends ${g.ends.join(",")} off ${g.best}`)).toEqual([]);
  });

  it("notices a pinned group that has become consistent", () => {
    // The pins record defects. A group that stops disagreeing has been fixed,
    // and a pin left behind would hide the next real defect in that group.
    const all = groupOffsets();
    const stillWrong = Object.keys(KNOWN_INCONSISTENT).filter((key) =>
      all.some((g) => g.key === key && g.best > ROUNDING_DEG),
    );
    expect(stillWrong.sort()).toEqual(Object.keys(KNOWN_INCONSISTENT).sort());
  });
});

describe("scenario assignments name something the scenario declares", () => {
  it("every assigned runway and gate resolves", () => {
    const unresolved: string[] = [];
    let assignments = 0;
    for (const scenario of SCENARIOS) {
      const state = scenario.build();
      const gates = new Set(state.gates.map((g) => g.id));
      const runways = new Set(
        state.runways.flatMap((r) => [r.id, ...r.id.split("/")]),
      );
      for (const flight of state.flights) {
        if (flight.assignedGate && !gates.has(flight.assignedGate)) {
          unresolved.push(`${scenario.id}: ${flight.callsign} gate ${flight.assignedGate}`);
        }
        if (flight.assignedRunway && !runways.has(flight.assignedRunway)) {
          unresolved.push(`${scenario.id}: ${flight.callsign} runway ${flight.assignedRunway}`);
        }
        if (flight.assignedGate) assignments += 1;
        if (flight.assignedRunway) assignments += 1;
      }
    }
    expect(unresolved).toEqual([]);
    // Known-positive: a corpus where nothing is assigned resolves everything.
    expect(assignments).toBeGreaterThan(0);
  });
});

// Mode 3/A transponder codes are octal: four digits, none above 7. The corpus
// carried "1108" on the Tenerife scenario, a code no transponder can set, and
// nothing was looking. It reached no detector, because the squawk doctrine
// matches 7500, 7600 and 7700 exactly, so the only cost was an impossible
// number on an operator surface in a scenario reconstructing the deadliest
// accident in aviation history.
//
// "----" is the established convention for no code, set by live ingest when a
// record carries no squawk and used deliberately for American 11, whose
// transponder was switched off. It is the one permitted non-code.
describe("transponder codes are possible codes", () => {
  it("every squawk is four octal digits or the explicit no-code marker", () => {
    const impossible: string[] = [];
    let codes = 0;
    for (const scenario of SCENARIOS) {
      for (const flight of scenario.build().flights) {
        if (flight.squawk === undefined) continue;
        const code = String(flight.squawk);
        if (code === "----") continue;
        if (!/^[0-7]{4}$/.test(code)) {
          impossible.push(`${scenario.id}: ${flight.callsign} squawk "${code}"`);
        }
        codes += 1;
      }
    }
    expect(impossible).toEqual([]);
    // Known-positive: a corpus where every flight skips the checks above also
    // reports no impossible codes.
    expect(codes).toBeGreaterThan(0);
  });
});

// One aircraft type has one wake category. The corpus declared CRJ7 as light in
// two scenarios and medium in a third, which is a contradiction the corpus
// settles by itself without anyone consulting a weight table: whichever is
// right, they cannot both be.
//
// A CRJ-700 is ICAO Medium at about 34 tonnes, an order of magnitude above the
// 7-tonne light threshold, so the two light declarations were the wrong ones.
// The wake detector never saw any of it. wakeMinimumNm resolves the category
// from the aircraft TYPE through cwtFromType and ignores Flight.wake entirely,
// so the field is display-only and a wrong value costs an operator a wrong
// wake class on screen rather than a wrong separation minimum. That is the
// quiet version of this defect and the reason it survived: nothing failed.
describe("one aircraft type carries one wake category", () => {
  it("no type is declared two ways across the corpus", () => {
    const byType = new Map<string, Map<string, string[]>>();
    for (const scenario of SCENARIOS) {
      for (const flight of scenario.build().flights) {
        if (!flight.aircraft || !flight.wake) continue;
        const categories = byType.get(flight.aircraft) ?? new Map();
        categories.set(flight.wake, [
          ...(categories.get(flight.wake) ?? []),
          `${scenario.id}/${flight.callsign}`,
        ]);
        byType.set(flight.aircraft, categories);
      }
    }
    const contradictory = [...byType]
      .filter(([, categories]) => categories.size > 1)
      .map(
        ([type, categories]) =>
          `${type}: ${[...categories]
            .map(([cat, where]) => `${cat} (${where.join(", ")})`)
            .join(" vs ")}`,
      );
    expect(contradictory).toEqual([]);
    // Known-positive: an empty map has no contradictions either, and the
    // comment above records that this defect survived because nothing failed.
    expect(byType.size).toBeGreaterThan(3);
  });
});

// The sampler's category columns are a hardcoded list in fp-analysis.mjs, and
// the false-positive tables in the papers are built from those columns. Add a
// twelfth alert category to types.ts and the sampler keeps counting it in
// n_alerts_total and in the severity columns while giving it no column of its
// own, so every per-category figure would quietly omit it and every total would
// still be right. That is the shape this project keeps finding: an aggregate
// that stays correct while the breakdown under it stops being complete.
//
// Checked against the union rather than against a second copy of the list,
// because a second copy is what is being guarded against.
describe("the sampler counts every alert category", () => {
  it("fp-analysis.mjs CATEGORIES matches the Alert union", () => {
    const { readFileSync } = require("node:fs");
    const types = readFileSync(`${__dirname}/types.ts`, "utf8");
    const union = types.match(/category:[^;]*;/s)?.[0] ?? "";
    const declared = [...union.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(0);

    const script = readFileSync(`${__dirname}/../../scripts/fp-analysis.mjs`, "utf8");
    const block = script.match(/const CATEGORIES = \[([^\]]*)\]/s)?.[1] ?? "";
    const sampled = [...block.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);

    expect([...sampled].sort()).toEqual([...declared].sort());
  });
});

// Table 1 of the outreach paper is the only published table regenerated from
// code rather than sampled from a measurement window, which makes it the one
// table a reader can check and the one this suite can guarantee. Section 6.10
// is careful to say the sampled figures cannot be re-derived; this one can, and
// until now nothing was re-deriving it.
//
// Rows are matched to scenarios by the label's first word and its year against
// the scenario's name and id, because the paper writes "LAX 1991" for a
// scenario named "USAir 1493 / SkyWest 5569" and "Potomac midair 2025" for one
// named "Potomac Mid-Air · Jan 2025". Matching on a hand-kept table of label
// aliases would be a second copy of the thing under test.
//
// Skipped rather than failed when the sibling repository is absent, the same
// rule verify-paper-claims.mjs uses for the same file, and the skip says so.
describe("the outreach paper's regenerable table still regenerates", () => {
  // ctx.skip() rather than an early return, so a run without the sibling
  // checkout reports "1 skipped" instead of counting a pass. CI has no
  // documents checkout, and a green tick for a check that read nothing is the
  // exact shape this whole family of tests exists to remove.
  it("Table 1 matches the corpus", (ctx) => {
    const { existsSync, readFileSync, readdirSync } = require("node:fs");
    // The long-form documents sit in a separate checkout beside this one, and
    // its directory name is not written here: this repository is public and
    // that one is not. Found by looking for the paper in each sibling of the
    // directory holding both, five levels up from src/sim. An earlier version
    // hardcoded a path four levels up, which does not exist, so this test took
    // its skip branch on every run and passed by checking nothing. It was
    // caught by planting a wrong number in the table and watching the suite
    // stay green.
    const parent = `${__dirname}/../../../../..`;
    let paper = "";
    for (const entry of existsSync(parent) ? readdirSync(parent) : []) {
      const candidate = `${parent}/${entry}/atc_whitepaper.md`;
      if (existsSync(candidate)) {
        paper = candidate;
        break;
      }
    }
    if (!paper) {
      ctx.skip("no documents checkout beside this one, so Table 1 was not read");
      return;
    }
    const text: string = readFileSync(paper, "utf8");
    // Bounded to Table 1's own block rather than running to the end of the
    // file. It sliced to the end until 2026-09-02, which was harmless only
    // because Table 1 was the paper's last four-column table. Adding a
    // per-detector ablation table further down swept its rows in, and the
    // failure read "Table 1 row \"Detector\" matches no scenario", which points
    // at the paper rather than at the parser. Stop at the first line after the
    // rows that is neither blank nor part of the table.
    const afterCaption = text.slice(text.indexOf("**Table 1."));
    const lines = afterCaption.split("\n");
    let end = lines.length;
    let seenRow = false;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (l.startsWith("|")) {
        seenRow = true;
        continue;
      }
      if (seenRow && l.length > 0) {
        end = i;
        break;
      }
    }
    const table = lines.slice(0, end).join("\n");
    const rows = table
      .split("\n")
      .filter((l) => l.startsWith("|"))
      .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()))
      .filter((c) => c.length === 4 && !/^-+$/.test(c[1]) && c[0] !== "Scenario");
    expect(rows.length).toBeGreaterThan(8);

    const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
    const counts = (state: SimState) => [
      runBaselineRules(state).length,
      runAllRules(state).length,
      runPredictiveRules(state).length,
    ];

    for (const [label, ...published] of rows) {
      if (/negative controls/i.test(label)) {
        // The aggregate row: totals across the eleven controls, and the claim
        // that none of them produces a critical, which is the corpus's whole
        // reason for holding them.
        const controls = SCENARIOS.filter((s) => s.id.startsWith("negative-control"));
        expect(controls.length).toBe(11);
        const totals = [0, 0, 0];
        for (const control of controls) {
          const built = control.build();
          const [b, o, p] = counts(built);
          totals[0] += b;
          totals[1] += o;
          totals[2] += p;
          for (const alerts of [runBaselineRules(built), runAllRules(built), runPredictiveRules(built)]) {
            expect(
              alerts.filter((a) => a.severity === "critical"),
              `${control.id} must produce no critical alert`,
            ).toEqual([]);
          }
        }
        published.forEach((cell, i) => {
          const claimed = Number.parseInt(cell, 10);
          expect(totals[i], `Table 1 negative-control total, column ${i + 1}`).toBe(claimed);
        });
        continue;
      }

      const first = norm(label.split(/[\s(]+/)[0]);
      const year = (label.match(/\b(19|20)\d{2}\b/) ?? [])[0];
      const scenario = SCENARIOS.find((s) => {
        const hay = norm(`${s.name} ${s.id}`);
        return hay.includes(first) && (!year || hay.includes(year));
      });
      expect(scenario, `Table 1 row "${label}" matches no scenario`).toBeDefined();

      const got = counts((scenario as (typeof SCENARIOS)[number]).build());
      published.forEach((cell, i) => {
        const claimed = Number.parseInt(cell, 10);
        expect(
          got[i],
          `Table 1 "${label}" column ${i + 1}: paper says ${claimed}, code gives ${got[i]}`,
        ).toBe(claimed);
      });
    }
  });
});

// Section 6.9 states how far the orchestrated population has diverged from the
// monolithic baseline, and that number is what the architectural comparison
// rests on. It said two doctrines postdate the baseline freeze, weather-shift
// and runway-identity, while three do: emergency-squawk was added to the
// population and the sentence describing the divergence was not swept.
//
// That is the fourth passage the same detector addition left stale, after the
// abstract's concern list, the Section 5.4 doctrine table and the alert-category
// count. One detector, four documents. Pinned here so the next addition has to
// state which side it lands on.
describe("the two implementations diverge by a stated amount", () => {
  const POPULATION_ONLY = ["runway-identity", "squawk-emergency", "weather-shift"];

  it("only the pinned doctrines exist in the population and not the baseline", () => {
    const population = new Set<string>();
    const monolith = new Set<string>();
    for (const scenario of SCENARIOS) {
      const state = scenario.build();
      for (const alert of runAllRules(state)) population.add(alert.category);
      for (const alert of runBaselineRules(state)) monolith.add(alert.category);
    }
    const only = [...population].filter((c) => !monolith.has(c)).sort();
    expect(only).toEqual(POPULATION_ONLY);
    // And nothing the other way: a doctrine in the baseline alone would mean the
    // population had lost one, which no section of either paper describes.
    expect([...monolith].filter((c) => !population.has(c))).toEqual([]);
  });
});

// The scenario picker is the surface a reviewer is told to open first, and it
// sorts the corpus under two headings, "Historical incidents" and "Synthetic
// scenarios". It grouped by whether a scenario carried an `incident`
// description block rather than by whether it reconstructs one.
//
// Ten scenarios carry that block and nine reconstruct an incident.
// negative-control-asrs carries one whose own location field reads
// "illustrative; not a real incident" and whose report field reads "ASRS-style
// synthetic scenario constructed from common controller narrative", and it was
// therefore listed under Historical incidents: a synthetic negative control
// presented to a reviewer as a documented reconstruction. Every count in both
// papers was right throughout, because they count the id prefix; the screen
// disagreed with them.
describe("the corpus classifies itself the same way twice", () => {
  it("carrying an incident block and being an incident are the same set, or listed here", () => {
    const CARRIES_BLOCK_WITHOUT_BEING_ONE = ["negative-control-asrs"];
    const divergent = SCENARIOS.filter(
      (s) => Boolean(s.incident) !== s.id.startsWith("incident-"),
    ).map((s) => s.id);
    expect(divergent).toEqual(CARRIES_BLOCK_WITHOUT_BEING_ONE);
  });

  it("the picker's two groups partition the corpus by reconstruction, not by block", () => {
    const historical = SCENARIOS.filter((s) => s.id.startsWith("incident-"));
    const synthetic = SCENARIOS.filter((s) => !s.id.startsWith("incident-"));
    expect(historical.length + synthetic.length).toBe(SCENARIOS.length);
    expect(historical.length).toBe(9);
    // Every scenario under the historical heading must name a real report, which
    // is the property that made the old grouping wrong.
    for (const scenario of historical) {
      expect(
        scenario.incident?.report,
        `${scenario.id} is listed as historical and must cite a report`,
      ).toBeTruthy();
      expect(
        scenario.incident?.report,
        `${scenario.id} cites a synthetic construction, not a report`,
      ).not.toMatch(/synthetic|illustrative/i);
    }
  });
});

// Both surfaces that present the corpus to a reviewer classified it by whether a
// scenario carried an `incident` description block. The picker filed
// negative-control-asrs under "Historical incidents" and the banner headed it
// "Historical Reconstruction", over body text from the same block reading
// "illustrative; not a real incident". The label contradicted the sentence
// underneath it.
//
// Checked as source rather than by rendering, because what went wrong was the
// predicate and not the markup, and a grep for the predicate is a smaller thing
// to maintain than a component harness.
describe("the presentation layer classifies by what a scenario is", () => {
  const COMPONENTS = ["ScenarioPicker.tsx", "IncidentBanner.tsx"];

  it("neither component groups or labels by the presence of an incident block", () => {
    const { readFileSync } = require("node:fs");
    for (const file of COMPONENTS) {
      const source: string = readFileSync(`${__dirname}/../components/${file}`, "utf8");
      // `!s.incident` / `s.incident` as a boolean test. Reading fields off the
      // block is fine and expected; branching on whether it exists is the bug.
      const branches = source.match(/[!(\s](?:s|meta)\.incident(?![.?])/g) ?? [];
      // IncidentBanner legitimately returns early when there is nothing to show.
      const allowed = file === "IncidentBanner.tsx" ? 1 : 0;
      expect(
        branches.length,
        `${file} branches on the presence of an incident block ${branches.length} time(s)`,
      ).toBe(allowed);
      expect(
        source,
        `${file} must classify by the scenario id`,
      ).toContain('startsWith("incident-")');
    }
  });
});

// Live ingest resolved an aircraft's heading as `rec.mag_heading ?? rec.track ??
// 0` until 2026-08-30, and every comparison downstream expects a TRUE ground
// track: attribution matches it against a coordinate-derived true course, and
// the runway-identity doctrine against trueCourseDeg where the record carries
// one.
//
// That preference was backwards on three counts. mag_heading is magnetic where
// the comparison is true, so it was out by the local variation, up to about
// fourteen degrees against gates of twenty and thirty. It is the aircraft's
// HEADING, where the nose points, while track is where it is going, so the two
// differ by drift as well. And `?? 0` handed a record with neither field a
// heading of due north rather than treating it as having none.
//
// FIXED, and this test is the inverse of the one that pinned it. It was held
// back while a measurement window was open on the three fields feeding the
// paper's sampling figures; tuned16 closed 2026-08-29 16:23Z and nothing is
// sampling, so the fix landed. The assertion now runs the other way: the
// resolution must prefer the true track, and no site may fabricate a heading.
describe("live heading resolution prefers the true track and fabricates nothing", () => {
  // Behavioural, not a source grep. The first version of these two tests read
  // live-adsb.ts as text and asserted the expression it contains, which checks
  // the wording of the fix rather than the fix. A record placed ten miles due
  // north of Kennedy at 4,000 ft tracking south is an arrival by geometry, so
  // varying only its heading fields shows what the resolution actually does.
  const arp = AIRPORTS.KJFK.arp;
  const northbound = {
    hex: "a1", flight: "TEST1", t: "B738",
    lat: arp.lat + 10 / 60, lon: arp.lon, alt_baro: 4000, gs: 200, dst: 10,
  };
  const classify = async (extra: Record<string, unknown>) => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ac: [{ ...northbound, ...extra }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof globalThis.fetch;
    try {
      return await fetchLiveTrafficDetailed(AIRPORTS.KJFK);
    } finally {
      globalThis.fetch = original;
    }
  };

  it("takes the true track over the magnetic heading, and keeps a track of due north", async () => {
    // Both fields present: the track must win. This is the units defect, since
    // every comparison downstream expects a true track and mag_heading is out
    // by the local variation plus drift.
    expect((await classify({ track: 180, mag_heading: 90 })).flights[0].headingDeg).toBe(180);
    // Magnetic alone is still better than nothing.
    expect((await classify({ mag_heading: 180 })).flights[0].headingDeg).toBe(180);
    // A track of exactly 0 is due north and a real reading. `||` in place of
    // `??` would discard it and fall through to the magnetic heading, which is
    // the one value most likely to appear as an exact zero.
    expect((await classify({ track: 0, mag_heading: 180 })).flights[0].headingDeg).toBe(0);
  });

  it("declines a contact carrying no distance rather than placing it at the field", async () => {
    // The sibling of the heading defect, and worse placed: `rec.dst ?? 0` put a
    // record with no distance AT the airport, which clears every distance gate
    // this file applies and reads as established on final below 2,000 ft.
    const res = await classify({ track: 180, dst: undefined });
    expect(res.contacts).toBe(1);
    expect(res.flights).toHaveLength(0);
    // A distance of exactly zero is a real reading, an aircraft over the field,
    // and the guard must not sweep it up the way `||` would have.
    const overhead = await classify({ track: 180, dst: 0 });
    expect(overhead.flights).toHaveLength(1);
  });

  it("declines a contact carrying neither field rather than pointing it north", async () => {
    const res = await classify({});
    // Counted as a contact, because it is one, and not classified, because
    // geometry cannot orient it. The old `?? 0` gave it a heading of due north
    // and then compared that fabricated value against runway courses.
    expect(res.contacts).toBe(1);
    expect(res.flights).toHaveLength(0);
  });
});

// Four detectors cannot fire on live data, and the outreach paper's summary box
// said two until 2026-08-29, in the first thing a cold reader sees. Two of the
// four are mechanical enough to assert here; the other two, runway identity and
// gate conflict, rest on which phases live ingest assigns runways to and on the
// absence of a gate assignment, and are covered by the phase-vocabulary tests
// above.
// One of the three entries here was wrong about its own subject. The fuel case
// checks an ingest-time margin and was read as proof the doctrine is unreachable
// live, which it is not; it is kept because the arithmetic it pins is real and
// load-bearing, with its scope stated.
describe("what live data can and cannot reach, and one case that was misread", () => {
  it("no registry runway has a surface state the surface doctrine reacts to", () => {
    // detectRunwaySurface fires on wet, snow and ice. Every runway in the live
    // registry is dry and nothing maps METAR onto surface state, so the doctrine
    // is unreachable in live mode by construction rather than by chance.
    const states = new Set(
      Object.values(AIRPORTS).flatMap((a) => a.runways.map((r) => r.surfaceFriction)),
    );
    expect([...states]).toEqual(["dry"]);
  });

  it("synthesised live fuel clears the fuel trigger at ingest, before smoothing", () => {
    // live-adsb sets fuelMin to max(30, etaMin + 60) for arrivals, and the
    // doctrine triggers below etaMin + 45, so the margin is 15 minutes at every
    // ETA.
    //
    // That is a statement about ingest and nothing more. This test's comment
    // used to end "and the detector cannot fire on live traffic", which does not
    // follow: smoothEtas overwrites etaMin against the previous tick before the
    // detectors run and leaves fuelMin alone, so the margin this test measures
    // is gone by the time the doctrine is evaluated. A fuel warning is reachable
    // live, pinned by "live ETA smoothing makes a fuel warning reachable".
    const source: string = require("node:fs").readFileSync(
      `${__dirname}/live-adsb.ts`,
      "utf8",
    );
    expect(source).toContain("Math.max(30, etaMin + 60)");
    for (const etaMin of [0, 5, 20, 60, 240]) {
      expect(Math.max(30, etaMin + 60)).toBeGreaterThan(etaMin + 45);
    }
  });
});

// A scenario's sectorId names a real facility and its runway list is the layout
// the aircraft fly. Nothing had ever checked that the two agree, and one of them
// did not: negative-control-parallel-approach read "KORD TWR" while flying
// San Francisco's 28L and 28R, and the label was load-bearing, because the
// committed BlueSky export derives position from it and placed both aircraft at
// O'Hare. That one was a contradiction with the paper and is corrected.
//
// Six remain and are PINNED rather than fixed. Making each control fly the
// airport it names is a design change to the corpus, not a correction to a
// claim, and it would move geometry the controls were tuned against. Pinning
// them means a seventh cannot appear unnoticed, and that silently changing one
// of these six fails here instead of passing.
//
// Registry runways are strips ("10R/28L") and scenarios name either a strip or
// a single end ("28L"), so both spellings are accepted. The first version of
// this check compared against ends alone and reported two KJFK incidents as
// mismatched for writing "04R/22L", which is the registry's own vocabulary.
describe("each scenario flies runways its named airport actually has", () => {
  const KNOWN_MISMATCHED: Record<string, string[]> = {
    "negative-control-goaround": ["28L", "28R", "01L", "01R"],
    "negative-control-converging-deps": ["01L", "01R"],
    "negative-control-staggered": ["28L", "28R", "01L", "01R"],
    "negative-control-wake-at-minimum": ["28L", "28R", "01L", "01R"],
    "negative-control-vfr-corridor": ["28L", "28R", "01L", "01R"],
    "negative-control-crosswind-ops": ["28L", "28R", "01L", "01R"],
  };

  // Nine scenarios name a facility outside the seventeen-airport registry
  // (KLEX, ZNY, KEWR, KIAH, ZMA). There is nothing to compare them against, so
  // they are skipped rather than counted as clean.
  const strayRunways = (id: string): string[] | null => {
    const state = SCENARIOS.find((s) => s.id === id)!.build();
    const icao = (state.sectorId ?? "").match(/\b([A-Z]{4})\b/)?.[1];
    if (!icao || !AIRPORTS[icao]) return null;
    const valid = new Set(
      AIRPORTS[icao].runways.flatMap((r) => [r.id, ...r.id.split("/")]),
    );
    return (state.runways ?? []).map((r) => r.id).filter((rid) => !valid.has(rid));
  };

  it("every scenario is either consistent or a known-mismatched entry here", () => {
    for (const scenario of SCENARIOS) {
      const stray = strayRunways(scenario.id);
      if (stray === null) continue;
      const known = KNOWN_MISMATCHED[scenario.id];
      if (known === undefined) {
        expect(stray, `${scenario.id} flies runways its airport does not have`).toEqual([]);
      } else {
        expect(stray, `${scenario.id} pinned mismatch changed`).toEqual(known);
      }
    }
  });

  it("no pinned entry has quietly become clean", () => {
    for (const id of Object.keys(KNOWN_MISMATCHED)) {
      const stray = strayRunways(id);
      expect(stray, `${id} is pinned as mismatched but no longer is; remove it`).not.toEqual([]);
    }
  });
});

describe("squawk code table", () => {
  // Nothing read this table until 2026-09-01, and it is published as a
  // reference page. It carried two assignments that were wrong in the
  // direction of sounding plausible: 0037 as a United States presidential
  // code, which does not exist, and 4400 as a drone code when 4400 is
  // reserved for U-2 and pressure-suit flights above FL600. The signal that
  // found them was neither format nor spelling. It was that 0033, 0034 and
  // 0036 carried no jurisdiction while 0037, sitting in the same block,
  // claimed the United States.
  it("assigns one jurisdiction per numeric block", () => {
    // 0000 is a global convention (SSR data unreliable / not assigned)
    // rather than a national allocation, so it shares a leading pair with
    // the UK 003x series without belonging to it.
    const exempt = new Set(["0000"]);
    const byBlock = new Map<string, Set<string>>();
    for (const entry of SQUAWK_CODES) {
      if (exempt.has(entry.code)) continue;
      const block = entry.code.slice(0, 2);
      const seen = byBlock.get(block) ?? new Set<string>();
      seen.add(entry.region ?? "unstated");
      byBlock.set(block, seen);
    }
    const mixed = [...byBlock].filter(([, regions]) => regions.size > 1);
    expect(mixed.map(([b, r]) => `${b}xx: ${[...r].join("/")}`)).toEqual([]);
    // Known-positive: an empty table has no mixed blocks either.
    expect(byBlock.size).toBeGreaterThan(3);
  });

  it("carries only four-digit octal codes, each once", () => {
    const codes = SQUAWK_CODES.map((e) => e.code);
    // Known-positive first: both assertions below hold trivially on an empty
    // list, so the count is what makes them mean anything.
    expect(codes.length).toBeGreaterThan(20);
    expect(codes.filter((c) => !/^[0-7]{4}$/.test(c))).toEqual([]);
    expect(codes.length).toBe(new Set(codes).size);
  });

  it("states the three emergency codes and the lost-link code", () => {
    const find = (code: string) => SQUAWK_CODES.find((e) => e.code === code);
    expect(find("7500")?.category).toBe("emergency");
    expect(find("7600")?.category).toBe("emergency");
    expect(find("7700")?.category).toBe("emergency");
    // Absent entirely until 2026-09-01, while 4400 wrongly held its meaning.
    expect(find("7400")?.label).toContain("Lost Link");
    expect(find("4400")).toBeUndefined();
  });
});

describe("airport reference points", () => {
  // An aerodrome reference point is a point on the aerodrome, so it lies
  // inside the span of that field's own runway thresholds. This needs no
  // external table: RUNWAY_ENDS is sourced from FAA NASR for the US fields
  // and OurAirports elsewhere, so the check is one dataset against another
  // rather than against numbers typed from memory.
  //
  // It found LPPR. Its point sat 0.32 NM off the 17/35 centreline, about
  // 600 m east of the pavement, where AIP Portugal gives 411408N 0084041W
  // at the runway's intersection with taxiway H, 0.003 NM off centreline.
  // A comparison against recalled coordinates had flagged the same airport
  // for the wrong reason, with a recalled value that was itself 0.75 NM out.
  it("places every reference point within its own runway span", () => {
    const outside: string[] = [];
    let checked = 0;
    for (const airport of Object.values(AIRPORTS)) {
      const strips = RUNWAY_ENDS[airport.icao];
      if (!strips) continue;
      const lats: number[] = [];
      const lons: number[] = [];
      for (const strip of Object.values(strips)) {
        lats.push(strip.leLat, strip.heLat);
        lons.push(strip.leLon, strip.heLon);
      }
      const { lat, lon } = airport.arp;
      const inside =
        lat >= Math.min(...lats) && lat <= Math.max(...lats) &&
        lon >= Math.min(...lons) && lon <= Math.max(...lons);
      if (!inside) outside.push(airport.icao);
      checked += 1;
    }
    expect(outside).toEqual([]);
    // Known-positive: without this the test passes if no airport has geometry,
    // which is the shape a deleted test in this suite already had.
    expect(checked).toBe(17);
  });
});

describe("runway palettes", () => {
  // The table held six entries and wrapped. KORD carries eight strips, so two
  // pairs of runways drew in one colour at the field with the most parallels,
  // which is where telling them apart matters most.
  it("gives every strip at the widest field its own colour", () => {
    const widest = Math.max(
      ...Object.values(RUNWAY_ENDS).map((strips) => Object.keys(strips).length),
    );
    const distinct = new Set<string>();
    for (let i = 0; i < widest; i += 1) distinct.add(JSON.stringify(paletteByIndex(i)));
    expect(distinct.size).toBe(widest);
  });

  it("returns a palette rather than undefined for an index off the table", () => {
    // The declared return type was RunwayPalette and a negative index yielded
    // undefined, because JavaScript's % keeps the sign of the dividend.
    expect(paletteByIndex(-1)).toBeDefined();
    expect(paletteByIndex(1.5)).toBeDefined();
    expect(paletteByIndex(999)).toBeDefined();
  });
});

describe("runway headings against surveyed thresholds", () => {
  // Every runway at one airport shares one magnetic variation. If the stored
  // headings are magnetic and the threshold coordinates give true bearings,
  // the difference must be constant across that field's strips. It is not, at
  // five US airports, and the coordinates that show it are FAA NASR data
  // already in this repository. The KSFO case had been recorded as blocked on
  // fetching NASR, which had already been fetched.
  //
  // These are pinned, not fixed: correcting a heading changes what a detector
  // attributes, and that belongs with the NASR cycle the values came from.
  // Fixing one makes this fail, which is the point.
  const KNOWN = {
    KSFO: 14.8, // 01 pair implies 13.7E, 10/28 implies -1.1; at most one right
    KBOS: 11.9, // 09/27 and 15/33 near -13; 04 at -24.3 and 14/32 at -18.2
    KORD: 10.5, // 10L/10C/10R at -9.1 against -2.0 for the 09 group
    KDFW: 8.9, // 13R at 5.2 against 13L at 1.4
    KATL: 7.0, // 10/28 at -9.0 against -2.0 for every other strip
  };

  // 5 degrees, not 3: the non-US thresholds come from OurAirports rather than
  // NASR and scatter more, with LPPT at 3.3 and EPWA at 3.1. Every US field
  // outside KNOWN sits under 2.2. A tighter bound would fail on data precision
  // rather than on a defect.
  it("pins the fields that contradict themselves, and holds the rest under 5 degrees", () => {
    const rows = headingSpread();
    const pinned: Record<string, number> = {};
    const others: string[] = [];
    for (const row of rows) {
      if (row.icao in KNOWN) pinned[row.icao] = Number(row.spread.toFixed(1));
      else others.push(`${row.icao}=${row.spread.toFixed(1)}`);
    }
    expect(pinned).toEqual(KNOWN);
    expect(others.filter((o) => Number(o.split("=")[1]) >= 5.0)).toEqual([]);
  });
});

describe("trail retention", () => {
  const airborne = (id: string, x: number) =>
    ({
      id,
      phase: "cruise",
      positionNm: { x, y: 0 },
      altitudeFt: 30000,
    }) as unknown as Flight;

  // Both tests apply updateTrails in a loop on purpose. The defect they cover
  // was invisible to a single call: the code truncated a vanished flight's
  // trail to ten points with slice(-10) under a comment promising it would
  // then be forgotten, and slice(-10) is a fixed point past the tenth element,
  // so it truncated once and held forever.
  it("drops a vanished flight's trail instead of holding it", () => {
    let trails = updateTrails({}, [airborne("A", 0), airborne("B", 0)]);
    for (let i = 1; i < 20; i += 1) {
      trails = updateTrails(trails, [airborne("A", i), airborne("B", i)]);
    }
    expect(trails.B?.length).toBeGreaterThan(0);

    const lengths: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      trails = updateTrails(trails, [airborne("A", 20 + i)]);
      lengths.push(trails.B?.length ?? 0);
    }
    // Strictly shrinking to nothing, not a constant ten.
    expect(lengths).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0]);
    expect("B" in trails).toBe(false);
  });

  it("does not grow without bound as flights pass through", () => {
    let trails: Record<string, ReturnType<typeof updateTrails>[string]> = {};
    for (let n = 0; n < 200; n += 1) {
      trails = updateTrails(trails, [airborne(`F${n}`, 1)]);
    }
    for (let i = 0; i < 15; i += 1) {
      trails = updateTrails(trails, [airborne("A", i)]);
    }
    // One live flight, and nothing kept from the two hundred that left.
    expect(Object.keys(trails)).toEqual(["A"]);
  });
});

describe("live airport switching", () => {
  const stateFor = (icao: string): SimState =>
    ({
      tick: 0,
      clockMin: 0,
      sectorId: `${icao} TWR`,
      flights: [],
      runways: runwaysWithTrueCourse(AIRPORTS[icao]),
      gates: AIRPORTS[icao].gates,
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
      trackedAlerts: [],
      speed: 1,
      trails: {},
      live: true,
    }) as unknown as SimState;

  const poll = (state: SimState, icao: string) =>
    liveReducer(state, {
      type: "flights",
      icao,
      flights: [],
      clockMin: 0,
      ageSeconds: 0,
      stale: false,
    } as never);

  // The route renders the dashboard without a key, so navigating between live
  // airports re-renders one instance and useReducer's initialiser does not run
  // again. Runways, gates and the sector label came from that initialiser, so
  // the picture showed one airport's traffic against another's runways.
  it("rebuilds runways, gates and sector when the airport changes", () => {
    const before = stateFor("KJFK");
    expect(before.gates.length).not.toBe(AIRPORTS.EPPO.gates.length);

    const after = poll(before, "EPPO");
    expect(after.sectorId).toBe("EPPO TWR");
    expect(after.runways.map((r) => r.id)).toEqual(
      runwaysWithTrueCourse(AIRPORTS.EPPO).map((r) => r.id),
    );
    expect(after.gates.length).toBe(AIRPORTS.EPPO.gates.length);
  });

  // The alert lifecycle measures its grace period in ticks, and this reducer
  // never advanced one, so `tick - lastSeenTick` was always zero and no alert
  // ever aged out. The operator view was unaffected because it filters stale
  // alerts, but the "clearing" list beside it grew for the life of the page.
  // The proxy stamps the picture's age and the client read it as
  // `Number(header ?? 0) || 0`, so a missing or unparseable header became
  // zero, which is the claim "fetched just now". That is the same defect the
  // header was added to fix, arriving through the parse instead of through the
  // timing.
  it("does not date the picture when the feed age is unknown", () => {
    const state = liveReducer(stateFor("KSEA"), {
      type: "flights",
      icao: "KSEA",
      flights: [],
      clockMin: 0,
      ageSeconds: undefined,
      stale: false,
    } as never);
    expect(state.liveUpdatedAt).toBeUndefined();
  });

  it("dates the picture from the feed age when it is known", () => {
    const before = Date.now();
    const state = liveReducer(stateFor("KSEA"), {
      type: "flights",
      icao: "KSEA",
      flights: [],
      clockMin: 0,
      ageSeconds: 120,
      stale: true,
    } as never);
    // Stamped 120 seconds in the past, not at the moment the response arrived.
    expect(state.liveUpdatedAt).toBeDefined();
    expect(before - (state.liveUpdatedAt as number)).toBeGreaterThanOrEqual(119_000);
    expect(state.liveStale).toBe(true);
  });

  it("marks which airport the weather was observed for, and carries it across a switch", () => {
    // A live session seeds a default weather block so the shape is valid
    // before the first METAR, and that default was indistinguishable from a
    // reading. Switching airports has the same gap, and carrying the previous
    // observation across trades a fabricated reading for a real one belonging
    // somewhere else. Either way the surface needs to know.
    const start = stateFor("KSEA");
    expect(start.weatherObservedFor).toBeUndefined();

    const observed = liveReducer(start, {
      type: "weather",
      icao: "KSEA",
      weather: { ...start.weather, windKts: 12 },
    } as never);
    expect(observed.weatherObservedFor).toBe("KSEA");

    // A switch drops the observation entirely rather than carrying it. An
    // earlier version carried it, marked with the airport it came from, and
    // that was wrong because the weather doctrines read the same block: a
    // field reporting three miles and an 800 ft ceiling raised a
    // low-visibility warning about the airport just opened. Marking a display
    // does not help when a detector consumes the value.
    const switched = poll(observed, "EPPO");
    expect(switched.sectorId).toBe("EPPO TWR");
    expect(switched.weatherObservedFor).toBeUndefined();
    // And the seed raises nothing, so no claim is made about the new field.
    expect(switched.alerts).toEqual([]);
  });

  it("advances the tick on every poll, which the alert grace period counts", () => {
    let state = stateFor("KSEA");
    for (let i = 0; i < 5; i += 1) state = poll(state, "KSEA");
    expect(state.tick).toBe(5);
  });

  it("clears a tracked alert once it has been absent past the grace period", () => {
    const seeded = {
      ...stateFor("KSEA"),
      trackedAlerts: [
        {
          id: "stuck",
          severity: "warning",
          category: "proximity",
          title: "t",
          detail: "d",
          reason: "r",
          flightIds: [],
          createdAtTick: 0,
          firstSeenTick: 0,
          lastSeenTick: 0,
          stale: false,
        },
      ],
    } as unknown as SimState;

    // No flights, so no detector emits it; each poll is one tick.
    let state = seeded;
    for (let i = 0; i < ALERT_GRACE_TICKS + 2; i += 1) state = poll(state, "KSEA");
    expect(state.trackedAlerts ?? []).toEqual([]);
  });

  it("leaves the picture alone when the airport has not changed", () => {
    const first = poll(stateFor("KSEA"), "KSEA");
    const second = poll(first, "KSEA");
    expect(second.runways).toBe(first.runways);
    expect(second.sectorId).toBe("KSEA TWR");
  });
});

describe("flight route lookup caching", () => {
  // The cache held both "this flight has no filed route" and "the lookup
  // failed", because each produces null at the call site. One transient error
  // then left that callsign routeless for the rest of the session.
  const withFetch = async (
    responses: Array<() => Promise<unknown>>,
    run: () => Promise<unknown>,
  ) => {
    const original = globalThis.fetch;
    let call = 0;
    globalThis.fetch = (() => {
      const next = responses[Math.min(call, responses.length - 1)];
      call += 1;
      return next();
    }) as typeof fetch;
    try {
      await run();
      return call;
    } finally {
      globalThis.fetch = original;
    }
  };

  it("retries after a failed lookup instead of caching the failure", async () => {
    const calls = await withFetch(
      [() => Promise.reject(new Error("offline"))],
      async () => {
        await fetchRoute("TEST001");
        await fetchRoute("TEST001");
      },
    );
    expect(calls).toBe(2);
  });

  it("caches a 404, which is the API answering that there is no route", async () => {
    const calls = await withFetch(
      [() => Promise.resolve({ ok: false, status: 404 } as Response)],
      async () => {
        await fetchRoute("TEST002");
        await fetchRoute("TEST002");
      },
    );
    expect(calls).toBe(1);
  });
});

describe("ETA smoothing cost", () => {
  // smoothing.ts states the price of the filter: a genuine, steadily closing
  // gap reaches the critical tier about two polls later than it would
  // unsmoothed. That is a safety-relevant number stated in prose beside a
  // tunable constant, so it is measured here rather than trusted. Change
  // ETA_SMOOTHING_ALPHA and this fails, which is the point: the disclosure in
  // section 7.4 of the thesis has to move with the constant.
  it("delays a closing gap past a boundary by two polls at the shipped alpha", () => {
    const arrival = (etaMin: number) =>
      ({ id: "t", type: "arrival", etaMin }) as unknown as Flight;

    const BOUNDARY_MIN = 2.0;
    let previous: Flight[] = [];
    let rawCross = -1;
    let smoothedCross = -1;
    for (let poll = 0; poll < 60; poll += 1) {
      const raw = 4.0 - 0.1 * poll;
      const smoothed = smoothEtas(previous, [arrival(raw)]);
      if (rawCross < 0 && raw <= BOUNDARY_MIN) rawCross = poll;
      if (smoothedCross < 0 && smoothed[0].etaMin <= BOUNDARY_MIN) smoothedCross = poll;
      previous = smoothed;
    }
    expect(rawCross).toBeGreaterThan(0);
    expect(smoothedCross - rawCross).toBe(2);
    // And the analytic mean lag the comment quotes, (1 - alpha) / alpha.
    expect((1 - ETA_SMOOTHING_ALPHA) / ETA_SMOOTHING_ALPHA).toBeCloseTo(1.5, 6);
  });
});

describe("METAR present weather", () => {
  // The caller passed the full raw observation ahead of the structured
  // present-weather field, and the match was a bare substring across the whole
  // string. TSNO is a routine remark on US automated stations meaning
  // thunderstorm information is not available; it contains "TS", so a clear
  // day at a field whose storm sensor is out reported a thunderstorm, and the
  // detector reading it suggests a ground stop for departures.
  it("does not read a thunderstorm out of the TSNO remark", () => {
    expect(
      parsePrecipitation(
        "KATL 011853Z 26008KT 10SM FEW045 SCT250 28/17 A3001 RMK AO2 SLP158 TSNO",
      ),
    ).toBe("none");
  });

  it("reports what is happening now, not what the remarks say happened", () => {
    // RAB12E30: rain began at :12 and ended at :30. Not raining now.
    expect(
      parsePrecipitation(
        "KBOS 011854Z 09006KT 10SM BKN035 22/16 A3005 RMK AO2 RAB12E30 SLP176",
      ),
    ).toBe("none");
    // And the genuine cases still read, including the vicinity and intensity
    // prefixes, which is what makes this a parser rather than a blocklist.
    const cases: Array<[string, string]> = [
      ["KJFK 011851Z 21012KT 10SM -RA BKN018 21/18 A2998", "rain"],
      ["KORD 011851Z 24015G28KT 3SM +TSRA BKN008 20/19 A2985", "thunderstorm"],
      ["KDEN 020153Z 36012KT 1/2SM -SN OVC004 M02/M04 A2990", "snow"],
      ["KSEA 011853Z 19008KT 9SM VCTS SCT040 18/12 A3002", "thunderstorm"],
    ];
    expect(cases.map(([metar]) => parsePrecipitation(metar))).toEqual(
      cases.map(([, expected]) => expected),
    );
  });
});

describe("runway designator against surveyed course", () => {
  // Attribution gates a track against a course taken from the runway
  // designator, which is rounded to ten degrees before magnetic variation is
  // applied, so the two errors add wherever variation is easterly. The gate is
  // 30 degrees and the worst strip in the registry sits at 23.0, so there are
  // seven degrees of headroom rather than the seventeen the constant's
  // rationale implied. Pinned so an added airport that eats it fails here
  // rather than silently losing attribution on that runway.
  it("keeps every strip inside the course gate, with the margin measured", () => {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const bearing = (s: { leLat: number; leLon: number; heLat: number; heLon: number }) => {
      const dLon = toRad(s.heLon - s.leLon);
      const y = Math.sin(dLon) * Math.cos(toRad(s.heLat));
      const x =
        Math.cos(toRad(s.leLat)) * Math.sin(toRad(s.heLat)) -
        Math.sin(toRad(s.leLat)) * Math.cos(toRad(s.heLat)) * Math.cos(dLon);
      return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    };
    const delta = (a: number, b: number) => {
      const d = Math.abs(a - b) % 360;
      return d > 180 ? 360 - d : d;
    };

    let worst = 0;
    let worstAt = "";
    let strips = 0;
    for (const airport of Object.values(AIRPORTS)) {
      const ends = RUNWAY_ENDS[airport.icao];
      if (!ends) continue;
      for (const runway of airport.runways) {
        const strip = ends[runway.id];
        if (!strip) continue;
        strips += 1;
        const designator =
          Number.parseInt(runway.id.split("/")[0].replace(/[^0-9]/g, ""), 10) * 10;
        const d = delta(designator, bearing(strip));
        if (d > worst) {
          worst = d;
          worstAt = `${airport.icao} ${runway.id}`;
        }
      }
    }
    expect(strips).toBe(62);
    expect(worstAt).toBe("KLAX 06L/24R");
    expect(worst).toBeLessThan(30);
    expect(worst).toBeCloseTo(23.0, 1);
  });
});

describe("altitude gate on runway attribution", () => {
  // Pinned, not fixed. The gate is absolute MSL, so it means "within 5,000 ft
  // of sea level" rather than "within 5,000 ft of the field". Denver sits
  // above that, so an aircraft on its runway is already over the cutoff and
  // attribution never fires there, leaving the runway-conflict detector and
  // the parallel-runway demotion inert at that airport. The fix needs a field
  // elevation the registry does not carry; see the note in runway-infer.ts.
  //
  // This test states the defect so that adding elevation, and making the gate
  // height-above-field, fails here and forces the note to be revisited.
  it("rejects an aircraft at Denver field elevation, which is the defect", () => {
    const denver = AIRPORTS.KDEN;
    const runways = runwaysWithTrueCourse(denver);
    const geometry = airportEndGeometries(denver);
    const end = geometry[0];
    const course = (end.trueCourseDeg * Math.PI) / 180;
    // Two miles out on the extended centreline, tracking the end's course.
    const position = {
      x: end.threshold.x - 2 * Math.sin(course),
      y: end.threshold.y + 2 * Math.cos(course),
    };

    // Low enough, and it attributes.
    expect(
      inferRunway(end.trueCourseDeg, 4900, runways, geometry, position, false),
    ).toBe(end.endLabel);

    // At and above Denver's field elevation, it does not, which is every
    // aircraft that has ever been at that airport.
    expect(
      inferRunway(end.trueCourseDeg, 5431, runways, geometry, position, false),
    ).toBeUndefined();
    expect(
      inferRunway(end.trueCourseDeg, 6431, runways, geometry, position, false),
    ).toBeUndefined();
  });
});

describe("attribution on non-finite input", () => {
  // Found by writing the Denver test above with the wrong field names. The
  // position became NaN, the test still passed, and it passed because every
  // gate in inferRunway is phrased as "skip when out of range": each
  // comparison against NaN is false, so nothing skipped and the aircraft was
  // attributed to whichever end the geometry lists first. A missing altitude,
  // heading or position produced a confident wrong runway, while an aircraft
  // 400 NM away was correctly refused.
  it("refuses a record with a non-finite altitude, heading or position", () => {
    const airport = AIRPORTS.KSEA;
    const runways = runwaysWithTrueCourse(airport);
    const geometry = airportEndGeometries(airport);
    const end = geometry[0];
    const course = (end.trueCourseDeg * Math.PI) / 180;
    const onApproach = {
      x: end.threshold.x - 2 * Math.sin(course),
      y: end.threshold.y + 2 * Math.cos(course),
    };

    // The control: this one must still attribute, or the guard is too broad.
    expect(
      inferRunway(end.trueCourseDeg, 1500, runways, geometry, onApproach, false),
    ).toBe(end.endLabel);

    expect(
      inferRunway(end.trueCourseDeg, 1500, runways, geometry, { x: NaN, y: NaN }, false),
    ).toBeUndefined();
    expect(
      inferRunway(NaN, 1500, runways, geometry, onApproach, false),
    ).toBeUndefined();
    expect(
      inferRunway(end.trueCourseDeg, NaN, runways, geometry, onApproach, false),
    ).toBeUndefined();
  });
});

describe("legacy wake table against the CWT table", () => {
  // Two tables in this repository classify the same aircraft, and they
  // disagreed. The CWT table drives separation doctrine and put A225 in
  // category A, Super; the legacy four-class table, which feeds the stand
  // rating and the display, called it heavy. Neither is checked against the
  // other by anything else, and the legacy one is the easier to forget
  // because no detector reads it.
  //
  // Only category A is constrained. The other categories diverge on purpose:
  // CWT E is the B757, which the four-class scheme has no room for and this
  // table deliberately calls heavy.
  it("agrees with the CWT table on which types are Super", () => {
    const cwtSuper = ["A388", "A38F", "A225"].filter(
      (type) => cwtFromType(type) === "A",
    );
    expect(cwtSuper.length).toBeGreaterThan(0);
    expect(cwtSuper.map((type) => wakeFromType(type))).toEqual(
      cwtSuper.map(() => "super"),
    );
  });

  it("shows no Super, Heavy or B757 type as light or medium", () => {
    // wakeFromType fell through to "light" for anything its own sets did not
    // name, and "light" is the lightest class rather than an unknown one, so
    // 27 of the 60 Super/Heavy/757 types the CWT table knows were displayed as
    // LIGHT: both 747 variants, the A300 and A310 family, the Beluga, the
    // DC-8s. A 747 on the flight strip read LIG. The label is derived from the
    // CWT category now, with the sets kept as the fallback for what CWT does
    // not carry.
    const heavyish = ["A388", "B741", "B74D", "A306", "A310", "A3ST", "DC85", "B752"];
    const wrong = heavyish.filter((t) => ["light", "medium"].includes(wakeFromType(t)));
    expect(wrong).toEqual([]);
    // And the light ones are still light, or the guard proves nothing.
    expect(wakeFromType("C172")).toBe("light");
    expect(wakeFromType("B738")).toBe("medium");
  });

  it("does not call anything Super that the CWT table places lower", () => {
    // A124 is the An-124: heavy, and category D rather than A.
    expect(cwtFromType("A124")).toBe("D");
    expect(wakeFromType("A124")).toBe("heavy");
  });
});

describe("simulated motion follows heading", () => {
  // The engine advanced every arrival by `x + dx * Math.cos(0)` with y left
  // alone. Math.cos(0) is 1, so heading was ignored: aircraft moved due east
  // whatever they pointed at, and none ever changed latitude. The display
  // rotates headings by minus ninety, which is north-up with x east and y
  // south, so symbols slid east while pointing west.
  it("moves an aircraft along its own heading, not due east", () => {
    const flight = (headingDeg: number) =>
      ({
        id: "t",
        callsign: "TEST",
        type: "arrival",
        phase: "enroute",
        headingDeg,
        speedKts: 360,
        positionNm: { x: 0, y: 0 },
        altitudeFt: 10000,
        etaMin: 30,
        fuelMin: 60,
      }) as unknown as Flight;

    const after = (headingDeg: number) => {
      const state = { speed: 1, tick: 0, clockMin: 0, flights: [flight(headingDeg)] } as unknown as SimState;
      return tick(state, 1).flights[0].positionNm;
    };

    // Six nautical miles in one minute at 360 kt. North is negative y here.
    const north = after(0);
    expect(north.x).toBeCloseTo(0, 6);
    expect(north.y).toBeCloseTo(-6, 6);

    const east = after(90);
    expect(east.x).toBeCloseTo(6, 6);
    expect(east.y).toBeCloseTo(0, 6);

    const west = after(270);
    expect(west.x).toBeCloseTo(-6, 6);

    // The case the old code could not express at all: a heading with both a
    // northward and a westward component.
    const northwest = after(320);
    expect(northwest.x).toBeLessThan(0);
    expect(northwest.y).toBeLessThan(0);
  });
});

describe("edge handler: an empty sky is an answer", () => {
  // The first tests to reach functions/, which serves every live request and
  // until 2026-09-01 was excluded from the typecheck and read by nothing.
  //
  // adsb.lol soft-throttles with 200 and an empty ac[] rather than an error,
  // so the handler treats an empty sky as suspect and consults the fallback.
  // The fallback now refuses this client by policy, and the handler then
  // returned an error, which made the ordinary state of a quiet field
  // ("nothing within 40 NM at 3am at Poznan") arrive at the client as
  // `feed error: ADS-B upstream 403`, because the client throws on any non-ok
  // status. A fabricated failure, in the state a reviewer opening a quiet
  // airport is most likely to meet.
  const withUpstreams = async (
    primary: () => Response,
    fallback: () => Response,
    // Third source, defaulting to the fallback's behaviour so the tests written
    // before it existed still describe what they meant: they stubbed "the
    // primary" and "everything else".
    third: () => Response = fallback,
  ) => {
    const saved = { fetch: globalThis.fetch, caches: (globalThis as never as { caches: unknown }).caches };
    const store = new Map<string, Response>();
    (globalThis as never as { caches: unknown }).caches = {
      default: {
        match: async (k: Request) => store.get(k.url),
        put: async (k: Request, v: Response) => void store.set(k.url, v),
      },
    };
    globalThis.fetch = (async (url: string) => {
      const u = String(url);
      if (u.includes("adsb.lol")) return primary();
      if (u.includes("adsb.fi")) return third();
      return fallback();
    }) as typeof fetch;
    try {
      // Loaded through a computed specifier on purpose. The edge handler
      // targets the Cloudflare Pages runtime and is deliberately outside this
      // package's tsconfig, which has no Workers globals; a literal import
      // pulls it into that program regardless of the exclude list and breaks
      // the app typecheck. It has its own config and its own typecheck
      // command, so the boundary is kept here rather than dissolved.
      const handlerPath = "../../functions/api/adsb/[[path]].ts";
      const mod = await import(/* @vite-ignore */ handlerPath);
      return (await (mod as { onRequest: (c: unknown) => Promise<Response> }).onRequest({
        params: { path: ["v2", "lat", "52.42", "lon", "16.83", "dist", "40"] },
        request: new Request("https://x/api/adsb/v2/lat/52.42/lon/16.83/dist/40"),
        waitUntil: () => {},
      })) as Response;
    } finally {
      globalThis.fetch = saved.fetch;
      (globalThis as never as { caches: unknown }).caches = saved.caches;
    }
  };

  const emptySky = () =>
    new Response(JSON.stringify({ ac: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  it("returns the empty sky rather than an error when the fallback is blocked", async () => {
    const res = await withUpstreams(emptySky, () => new Response("blocked", { status: 403 }));
    // The client throws on any non-ok status, so this must be ok.
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    // And the soft-throttle reading survives, as a header rather than a fault.
    expect(res.headers.get("x-fallback-tried")).toBe("airplanes.live 403");
    expect(res.headers.get("x-primary-outcome")).toBe("adsb.lol 200 empty");
  });

  it("falls through to the third source when both others refuse", async () => {
    // Added 2026-09-01, when the deployment was answering 403 with both
    // upstreams refusing: adsb.lol rate-limiting the shared egress the
    // serverless runtime leaves through, and airplanes.live blocking by
    // policy. A third source cannot make that worse and might clear it, and
    // adsb.fi takes the same path shape as the primary so nothing needs
    // translating.
    const res = await withUpstreams(
      () => new Response("rate limited", { status: 429 }),
      () => new Response("blocked", { status: 403 }),
      () =>
        new Response(JSON.stringify({ ac: [{ hex: "abc123", flight: "TEST123" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ac: unknown[] };
    expect(body.ac).toHaveLength(1);
  });

  it("names all three upstreams when none of them returns traffic", async () => {
    // The error body is what a reviewer sees, and it has to say which sources
    // were tried: when live mode broke it said "upstream 403" and could not
    // say which feed or why.
    const res = await withUpstreams(
      () => new Response("rate limited", { status: 429 }),
      () => new Response("blocked", { status: 403 }),
      () => new Response("also refused", { status: 503 }),
    );
    expect(res.ok).toBe(false);
    const body = (await res.json()) as { tried: string[] };
    expect(body.tried).toEqual([
      "adsb.lol 429",
      "airplanes.live 403",
      "adsb.fi 503",
    ]);
  });

  it("still reports an error when the primary itself refuses", async () => {
    const res = await withUpstreams(
      () => new Response("rate limited", { status: 429 }),
      () => new Response("blocked", { status: 403 }),
    );
    expect(res.ok).toBe(false);
  });
});

describe("METAR visibility", () => {
  // parseFloat stops at the first non-numeric character, so a fraction read as
  // its numerator: 1/2 became 1, 3/4 became 3, and M1/4, which means less than
  // a quarter mile and is the worst category reported, matched nothing and
  // took the ten-mile default. The thresholds it feeds make the numerators
  // land exactly on the boundaries they should trip.
  it("reads fractions, bounds and units rather than their first digit", () => {
    const cases: Array<[string, number]> = [
      ["1/2", 0.5],
      ["3/4", 0.75],
      ["1 1/2", 1.5],
      ["M1/4", 0.25],
      ["1/4SM", 0.25],
      ["P6SM", 6],
      ["10+", 10],
      ["3", 3],
    ];
    expect(cases.map(([raw]) => parseVis(raw))).toEqual(cases.map(([, v]) => v));
  });

  it("trips the thresholds those values exist to trip", () => {
    // Mirrors rules.ts: belowCatI < 0.5, lifr < 1, ifr < 3.
    expect(parseVis("M1/4")).toBeLessThan(0.5);
    expect(parseVis("1/2")).toBeLessThan(1);
    expect(parseVis("3/4")).toBeLessThan(3);
    // And a clear day still does not.
    expect(parseVis("10+")).toBeGreaterThanOrEqual(3);
  });
});

describe("METAR ceiling", () => {
  // Broken and overcast form a ceiling and only those two were accepted. An
  // obscured sky does too, and is the worse case: VV is vertical visibility
  // into an indefinite ceiling, which is what fog gives, and the FAA treats it
  // as the ceiling for minima. So an obscured sky at 100 ft fell through to
  // the 20,000 ft clear default: the worst sky reported as the best.
  it("treats an obscured sky as the ceiling it is", () => {
    expect(lowestCloudFt([{ cover: "VV", base: 100 }])).toBe(100);
    expect(lowestCloudFt([{ cover: "OVX", base: 100 }])).toBe(100);
    // Mirrors rules.ts: belowCatI is a ceiling under 200 ft.
    expect(lowestCloudFt([{ cover: "VV", base: 100 }])).toBeLessThan(200);
  });

  it("skips a layer with no base instead of returning NaN", () => {
    // NaN failed every `ceilingFt < n` test, so an unreadable ceiling raised
    // nothing rather than raising doubt.
    const missing = lowestCloudFt([{ cover: "OVC", base: undefined as unknown as number }]);
    expect(Number.isNaN(missing)).toBe(false);
    expect(missing).toBe(20000);
    // And a readable layer beside an unreadable one still counts.
    expect(
      lowestCloudFt([
        { cover: "OVC", base: undefined as unknown as number },
        { cover: "BKN", base: 900 },
      ]),
    ).toBe(900);
  });
});

describe("wake category coverage", () => {
  // KNOWN GAP, pinned rather than filled. The CWT table drives separation and
  // the legacy four-class table drives display, and 21 of the 77 types the
  // legacy table names are absent from the CWT one. A pair involving any of
  // them yields no wake minimum and falls back to the radar floor, so the
  // detector still fires; the requirement and the tier collapse. At one mile
  // of spacing an A388 leader is a critical against 7 NM and an A38F leader
  // a warning against 2.5. An earlier version of this comment said it could
  // not fire, which running it disproved.
  //
  // The list is not marginal. It holds the MAX and neo families, which are
  // among the most numerous narrowbodies at these fields; the E-Jet
  // regionals; and, worst, the freighters: an A380 freighter is the same
  // airframe as the passenger A380, which requires 7 NM, and gets none.
  //
  // Filling it means assigning CWT categories, which belongs to FAA
  // JO 7110.126 TBL A-1 and not to inference from a sibling airframe, however
  // reasonable that inference looks. Recorded here so the count cannot drift
  // unnoticed and so filling it fails this test rather than passing silently.
  const UNCATEGORISED = 21;

  it("pins how many legacy types the CWT table cannot categorise", () => {
    const legacy = [
      "A38F", "A338", "A35K", "B74F", "B74S", "B75F", "B76F", "B77F",
      "A20N", "A21N", "B37M", "B38M", "B39M", "MD80", "MD90",
      "E175", "E195", "E290", "E295", "AT45", "AT75",
    ];
    expect(legacy.filter((t) => cwtFromType(t) === undefined)).toEqual(legacy);
    expect(legacy.length).toBe(UNCATEGORISED);
  });

  it("shows what the gap costs behind a Super", () => {
    const follower = { aircraft: "B738" } as unknown as Flight;
    // The passenger A380 is categorised and carries the full requirement.
    expect(wakeMinimumNm({ aircraft: "A388" } as unknown as Flight, follower)).toBe(7);
    // The freighter is the same airframe and carries none, which is the
    // defect in one line.
    expect(wakeMinimumNm({ aircraft: "A38F" } as unknown as Flight, follower)).toBeNull();
  });
});

describe("squawk reference against the emergency detector", () => {
  // Two lists of emergency codes: the reference page's table and the
  // detector's own. They agree today, and this is here because the equivalent
  // pair for wake categories disagreed three separate ways, and because the
  // reference table gained a code earlier in this same session. Drift between
  // a published reference and the code acting on it is live, not theoretical.
  it("acts on exactly the codes the reference calls emergencies", () => {
    const source = readFileSync(
      new URL("./rules.ts", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("const MEANING");
    const block = source.slice(start, source.indexOf("for (const f of", start));
    const actedOn = [...new Set([...block.matchAll(/"(\d{4})":/g)].map((m) => m[1]))].sort();
    const declared = SQUAWK_CODES.filter((e) => e.category === "emergency")
      .map((e) => e.code)
      .sort();
    // Both directions, because either list can grow without the other.
    expect(actedOn).toEqual(declared);
    // And the guard is worthless if it matches two empty lists.
    expect(actedOn).toEqual(["7500", "7600", "7700"]);
  });
});

describe("runway-identity names the runway in reciprocal configurations", () => {
  // A strip stores one course, its low end's, so a field operating the other
  // way round sits 180 degrees from that value. The assigned side resolved the
  // end before reading the course; the search for which runway the aircraft is
  // actually on did not, so at KSFO, where the 28s are the arrival runways, an
  // aircraft rolling on 28R matched nothing. The alert fired and named no
  // runway. Half of every field's configurations are reciprocal, so this was
  // the ordinary case.
  it("identifies the strip when the aircraft is on its high end", () => {
    const sfo = AIRPORTS.KSFO;
    const runways = runwaysWithTrueCourse(sfo);
    const rolling = {
      id: "r1",
      callsign: "TEST01",
      // The detector fires on a departure rolling, which is the case it exists
      // for: cleared for one runway, lined up on another.
      type: "departure",
      phase: "taxi-out",
      aircraft: "B738",
      wake: "medium",
      headingDeg: 298, // lined up on 28R
      speedKts: 90, // above the 40 kt roll threshold
      positionNm: { x: 0, y: 0 },
      altitudeFt: 0,
      etaMin: 0,
      fuelMin: 60,
      squawk: "----",
      assignedRunway: "01L/19R", // cleared for a different strip
    } as unknown as Flight;

    const state = {
      tick: 0,
      clockMin: 0,
      sectorId: "KSFO TWR",
      runways,
      gates: sfo.gates,
      weather: {
        windDirDeg: 280,
        windKts: 8,
        gustsKts: 8,
        visibilityNm: 10,
        ceilingFt: 20000,
        condition: "VFR",
        precipitation: "none",
      },
      alerts: [],
      trackedAlerts: [],
      speed: 1,
      trails: {},
      flights: [rolling],
    } as unknown as SimState;

    const identity = runPredictiveRules(state).filter(
      (a) => a.category === "runway-identity",
    );
    expect(identity).toHaveLength(1);
    // The point of the fix: it says which runway, rather than only that the
    // heading does not match the assigned one.
    expect(identity[0].title).toContain("10L/28R");
  });
});

describe("the animation agrees with the projector", () => {
  // Two motion models exist: the simulator advances the picture a viewer
  // watches, and the projector advances a copy for the look-ahead detectors.
  // The projector was always right, taking sin for east and cos for south;
  // the simulator multiplied by Math.cos(0) and moved everything due east.
  // That divergence is exactly why no reported measurement moved and the
  // display was still wrong, and this test is what would have caught it.
  it("moves an aircraft the same way for every heading", () => {
    const flight = (headingDeg: number) =>
      ({
        id: "t",
        callsign: "T",
        type: "arrival",
        phase: "enroute",
        headingDeg,
        speedKts: 300,
        positionNm: { x: 0, y: 0 },
        altitudeFt: 10000,
        etaMin: 30,
        fuelMin: 60,
      }) as unknown as Flight;

    for (const heading of [0, 45, 90, 135, 180, 225, 270, 315, 320]) {
      const state = {
        speed: 1,
        tick: 0,
        clockMin: 0,
        flights: [flight(heading)],
      } as unknown as SimState;
      const animated = tick(state, 2).flights[0].positionNm;
      const projected = projectState(state, 2).flights[0].positionNm;
      expect(animated.x).toBeCloseTo(projected.x, 9);
      expect(animated.y).toBeCloseTo(projected.y, 9);
    }
  });
});

describe("suppression never hides something worse", () => {
  // An alert marked as subsumed is kept for audit but withheld from the
  // operator view, so a suppression that ran the wrong way would hide the more
  // serious of two alerts behind the less serious one.
  //
  // The count assertion is not decoration. Inverting the comparison in
  // rules.ts produces zero suppressions rather than backwards ones, and a
  // check that only looked for inversions would pass on an empty set, which is
  // the vacuous-guard shape this suite has already deleted one test for.
  it("subsumes only alerts less severe than their trigger, and does subsume some", () => {
    const RANK: Record<string, number> = { critical: 0, warning: 1, advisory: 2, info: 3 };
    let suppressed = 0;
    const inverted: string[] = [];
    const dangling: string[] = [];

    for (const scenario of SCENARIOS) {
      const alerts = runPredictiveRules(scenario.build());
      const byId = new Map(alerts.map((a) => [a.id, a]));
      for (const alert of alerts) {
        if (!alert.suppressedBy) continue;
        suppressed += 1;
        const trigger = byId.get(alert.suppressedBy);
        if (!trigger) {
          dangling.push(`${scenario.id}:${alert.id}`);
          continue;
        }
        if (RANK[trigger.severity] >= RANK[alert.severity]) {
          inverted.push(`${scenario.id}: ${alert.severity} subsumed by ${trigger.severity}`);
        }
      }
    }

    expect(inverted).toEqual([]);
    expect(dangling).toEqual([]);
    // The known-positive: the corpus exercises this at all.
    expect(suppressed).toBeGreaterThan(0);
  });
});

describe("wake sequencing follows distance, not time", () => {
  // The requirement is an in-trail distance and the gap is measured between
  // positions, so the leader is the aircraft ahead in space. Sequencing by
  // estimated time mixes two orderings and they disagree whenever the aircraft
  // differ in speed: 8 NM out at 180 kt reaches the field before 6 NM out at
  // 110 kt, which made the farther aircraft the leader and applied its wake
  // category to a pair it was following.
  //
  // Building this fixture took four attempts and the first three were guesses.
  // Two aircraft must sit within LATERAL_CLUSTER_NM of each other in
  // cross-track, which is 0.1 NM, so they have to lie on the extended
  // centreline itself: the 28R landing course is 299, so its final approach
  // traffic is to the east-south-east along bearing 119. Placing them on the
  // x-axis instead put them 29 degrees off the path and into separate streams,
  // and the pairing walk then had nothing to pair.
  it("makes the nearer aircraft the leader even when it arrives later", () => {
    const sfo = AIRPORTS.KSFO;
    const inbound = (119 * Math.PI) / 180;
    const onCentreline = (distanceNm: number) => ({
      x: distanceNm * Math.sin(inbound),
      y: -distanceNm * Math.cos(inbound),
    });

    const arrival = (id: string, distanceNm: number, speedKts: number, aircraft: string) =>
      ({
        id,
        callsign: id,
        type: "arrival",
        phase: "final",
        aircraft,
        wake: "heavy",
        headingDeg: 299,
        speedKts,
        positionNm: onCentreline(distanceNm),
        altitudeFt: 2000,
        etaMin: (distanceNm / speedKts) * 60,
        fuelMin: 90,
        squawk: "----",
        assignedRunway: "28R",
      }) as unknown as Flight;

    const far = arrival("FAR", 8, 180, "A388");
    const near = arrival("NEAR", 6, 110, "B738");
    // The premise: the farther aircraft arrives sooner.
    expect(far.etaMin).toBeLessThan(near.etaMin);

    const state = {
      tick: 0,
      clockMin: 0,
      sectorId: "KSFO TWR",
      runways: sfo.runways,
      gates: sfo.gates,
      weather: {
        windDirDeg: 280,
        windKts: 8,
        gustsKts: 8,
        visibilityNm: 10,
        ceilingFt: 20000,
        condition: "VFR",
        precipitation: "none",
      },
      alerts: [],
      trackedAlerts: [],
      speed: 1,
      trails: {},
      flights: [far, near],
    } as unknown as SimState;

    const pairs = wakeCandidatePairs(state);
    // Known-positive: without this the assertions below hold on an empty list.
    expect(pairs).toHaveLength(1);
    expect(pairs[0].lead.callsign).toBe("NEAR");
    expect(pairs[0].trail.callsign).toBe("FAR");
  });
});

describe("lateral streams do not chain", () => {
  // Clustering compared each aircraft to the LAST one admitted, which is
  // single-linkage and drifts: ten aircraft each 0.09 NM further off the
  // centreline than the one before joined one stream spanning 0.81 NM, eight
  // times the 0.1 NM tolerance, and were paired in trail. The closest US
  // parallel centrelines are 0.12 NM apart, so such a chain crosses several
  // and invents the in-trail relationship the alignment filter prevents.
  const sfo = AIRPORTS.KSFO;
  const inbound = (119 * Math.PI) / 180;
  const place = (alongNm: number, crossNm: number) => ({
    x: alongNm * Math.sin(inbound) + crossNm * Math.cos(inbound),
    y: -alongNm * Math.cos(inbound) + crossNm * Math.sin(inbound),
  });
  const arrival = (id: string, alongNm: number, crossNm: number) =>
    ({
      id,
      callsign: id,
      type: "arrival",
      phase: "final",
      aircraft: "B738",
      wake: "medium",
      headingDeg: 299,
      speedKts: 140,
      positionNm: place(alongNm, crossNm),
      altitudeFt: 2000,
      etaMin: (alongNm / 140) * 60,
      fuelMin: 90,
      squawk: "----",
      assignedRunway: "28R",
    }) as unknown as Flight;
  const stateWith = (flights: Flight[]) =>
    ({
      tick: 0,
      clockMin: 0,
      sectorId: "KSFO TWR",
      runways: sfo.runways,
      gates: sfo.gates,
      weather: {
        windDirDeg: 280,
        windKts: 8,
        gustsKts: 8,
        visibilityNm: 10,
        ceilingFt: 20000,
        condition: "VFR",
        precipitation: "none",
      },
      alerts: [],
      trackedAlerts: [],
      speed: 1,
      trails: {},
      flights,
    }) as unknown as SimState;

  it("live ETA smoothing makes a fuel warning reachable, and a critical not", () => {
    // Three places said the fuel doctrine cannot fire on live data because the
    // fuel figure is synthesised: the comment on detectFuelHold, the row in
    // docs/phase-vocabulary-audit.md, and by implication the live-mode reading
    // in the papers. It can fire, and live-adsb.ts records 19 criticals
    // measured in one KLAX window before the ETA cap was added.
    //
    // The mechanism. Ingest synthesises fuel from the raw ETA of the same tick
    // as max(30, eta + 60), which satisfies the detector's eta + 45 threshold
    // for every value. Then smoothEtas overwrites etaMin against the previous
    // tick, before the detectors see the picture (live-store.ts), and leaves
    // fuelMin alone. The two stop describing the same aircraft.
    const liveArrival = (etaRaw: number): Flight => ({
      id: "smoothed",
      callsign: "SWA100",
      type: "arrival",
      aircraft: "B738",
      wake: "medium",
      origin: "KLAX",
      destination: "KSFO",
      phase: "approach",
      altitudeFt: 4000,
      speedKts: 220,
      headingDeg: 281,
      positionNm: { x: -20, y: 0 },
      // Exactly what live-adsb.ts writes.
      fuelMin: Math.max(30, etaRaw + 60),
      etaMin: etaRaw,
      squawk: "2400",
    });

    // A contact whose raw ETA was at the 60-minute cap and drops to zero, which
    // is the degenerate near-stationary case the cap was added for.
    const smoothed = smoothEtas([liveArrival(60)], [liveArrival(0)]);
    expect(smoothed[0].etaMin).toBeCloseTo(0.6 * 60, 10);
    expect(smoothed[0].fuelMin).toBe(60);

    const fuel = runAllRules(stateWith(smoothed)).filter(
      (a) => a.category === "fuel-hold",
    );
    expect(fuel).toHaveLength(1);
    expect(fuel[0].severity).toBe("warning");

    // And the ceiling, which is why criticals are unreachable now and were not
    // before. Both ETAs are capped at 60, so a blended value cannot exceed the
    // raw one by more than (1 - alpha) * 60 = 36 minutes: past the detector's
    // 15-minute warning threshold, short of its 45-minute critical one. Raise
    // the cap to 120 and criticals come back.
    const worstRise = (1 - ETA_SMOOTHING_ALPHA) * 60;
    expect(worstRise).toBeCloseTo(36, 10);
    expect(worstRise).toBeGreaterThan(15);
    expect(worstRise).toBeLessThan(45);
  });

  it("keeps a genuine in-trail line on one centreline together", () => {
    // The known-positive. A rule that split everything would satisfy the
    // chaining test below while destroying the detector.
    const inTrail = [0, 1, 2, 3].map((i) => arrival(`B${i}`, 5 + i * 0.5, 0));
    expect(wakeCandidatePairs(stateWith(inTrail))).toHaveLength(3);
  });

  it("does not chain across a drift wider than the cluster tolerance", () => {
    const drifting = Array.from({ length: 10 }, (_, i) =>
      arrival(`A${i}`, 5 + i * 0.5, i * 0.09),
    );
    // Single linkage gave 9: one stream of ten. Anchored to each stream's
    // first member it cannot exceed the tolerance, so the ten split.
    expect(wakeCandidatePairs(stateWith(drifting)).length).toBeLessThan(9);
  });
});

describe("a runway is named one way within a scenario", () => {
  // Flights are grouped for the runway-scoped doctrines by the assigned runway
  // STRING, so "28R" and "10L/28R" are different groups even though they are
  // one runway. Two aircraft in trail named differently would be split into
  // separate streams and never paired, and nothing would report it.
  //
  // Both forms are in use across the corpus, 18 scenarios naming a single end
  // and 5 the full strip, which is what makes mixing them within one scenario
  // an easy thing to do by accident.
  it("never names one runway two ways in the same scenario", () => {
    const offenders: string[] = [];
    let assignments = 0;
    for (const scenario of SCENARIOS) {
      const used = new Set(
        scenario
          .build()
          .flights.map((f) => f.assignedRunway)
          .filter((r): r is string => Boolean(r)),
      );
      assignments += used.size;
      for (const a of used) {
        for (const b of used) {
          if (a === b) continue;
          if (a.includes("/") && a.split("/").includes(b)) {
            offenders.push(`${scenario.id}: ${a} and ${b}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
    // Known-positive: a corpus assigning no runways names nothing twice.
    expect(assignments).toBeGreaterThan(10);
  });
});

// Three properties the scenario corpus must have to be a corpus of its kind,
// none of which any detector test would notice being violated. A flight
// assigned to a runway its own airport does not have still produces alerts,
// because the runway detector groups by the string it is given and never asks
// the registry whether that string names anything; the grouping would simply
// be wrong, silently, in whichever scenario carried the typo. Duplicate
// callsigns are worse, since two flight strips would carry one identity and a
// reader could not tell which aircraft an alert names. A squawk outside the
// four-octal-digit form is not a squawk at all.
//
// All three pass today. They are written because passing is the point: these
// are the invariants that make the corpus usable as evidence, and nothing else
// in this suite checks them. Each carries a known-positive so a guard that
// silently examines nothing cannot report success.
describe("the scenario corpus is well formed", () => {
  // The state carries its own runway list, which is what the detectors group
  // by, so the invariant is against that rather than against the registry: a
  // scenario is free to build a field the registry does not hold, and what
  // must never happen is a flight pointing at a runway its own state lacks.
  const endsOf = (runways: SimState["runways"]): Set<string> => {
    const ends = new Set<string>();
    for (const runway of runways) {
      ends.add(runway.id);
      for (const end of runway.id.split("/")) ends.add(end);
    }
    return ends;
  };

  it("every assigned runway exists at the scenario's own airport", () => {
    const offenders: string[] = [];
    let assignments = 0;
    for (const scenario of SCENARIOS) {
      const state = scenario.build();
      const ends = endsOf(state.runways);
      if (ends.size === 0) continue;
      for (const flight of state.flights) {
        if (!flight.assignedRunway) continue;
        assignments++;
        if (!ends.has(flight.assignedRunway)) {
          offenders.push(
            `${scenario.id}: ${flight.callsign} -> ${flight.assignedRunway}`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
    // Known-positive: a corpus that assigns no runways would pass vacuously.
    expect(assignments).toBeGreaterThan(20);
  });

  // The same argument as the runway invariant, for the other string the
  // detectors group by. gate-conflict buckets flights by assignedGate and never
  // asks the state whether that gate exists, so an assignment to a gate the
  // field does not have would form a bucket of one that can never conflict, and
  // the detector would be silent about an aircraft it appears to be watching.
  // check-live-feed.sh probes the deployed feed and must probe the path the
  // client builds. The first hand probe of that feed used a plausible path the
  // application never requests, whose cache had never been warmed, and reported
  // one refusing upstream where two were refusing. The script exists so that is
  // not repeated by hand, and this test exists so the script cannot drift from
  // the caller: both must agree on the three segments that make the path, and a
  // change to either without the other fails here.
  // The sampler wrote four weather values per snapshot and no indication of
  // whether any of them had been observed, for as long as it had existed. The
  // application has tracked that since the carry-across repair; the sampler was
  // simply not told, which is how a fix to one program fails to reach the data
  // another one writes. Every window closed before 2026-09-01 is unresolvable
  // as a result, because ten miles and twenty thousand feet is both the seed
  // and a cloudless sky. Pinned so the column cannot be dropped again.
  // The registry holds seven fields outside the US, and international METARs
  // report visibility in metres: 9999 for ten kilometres or more, 6000 for six
  // thousand metres. Read as statute miles those become 9,999 and 6,000, which
  // is the optimistic direction and would silence every visibility threshold.
  // Checked against the live API on 2026-09-01 rather than reasoned about:
  // aviationweather.gov normalises, and EGLL's 9999 arrives as "6+" while
  // Dubai's 6000 arrives as 3.73. So the defect does not exist, and the forms
  // that do arrive are pinned here because only the US "10+" was covered and
  // "6+" is what every international field sends.
  // A proximity alert explained itself with thresholds that were not the ones
  // that fired it: the text said below 5 NM and 1000 ft was a warning while the
  // detector warns below 2 NM. A controller reading that would misjudge how
  // close a pair at 1.8 NM sits relative to the rule, and no test compared an
  // alert's explanation to the constant it describes. The string is built from
  // the constants now, and this asserts the numbers it prints are the numbers
  // that triggered it, by finding a real alert rather than reading the source.
  // There is no component harness in this app, so the surface is asserted the
  // way the scripts are: by reading the source. Weaker than rendering, and
  // still enough to catch the case that happened, which is a value recorded in
  // the state, written to the sampled data, and never shown to the operator.
  // Both places that print the condition have to consult the flag.
  // Rows are written as COLUMNS.map((c) => row[c]), so a column declared with
  // no key on the row object writes the literal string "undefined" into every
  // row of every window, for as long as nobody opens the file. Two columns were
  // added on 2026-09-01 and the check that they were wired was done by hand;
  // this does it on every run instead.
  it("every declared sampler column has a value behind it", () => {
    const script = readFileSync(
      `${__dirname}/../../scripts/fp-analysis.mjs`,
      "utf8",
    );
    const block = script.slice(script.indexOf("const COLUMNS = ["));
    const declared = [
      ...block.slice(0, block.indexOf("\n];")).matchAll(/^\s*"([a-z0-9_]+)",/gm),
    ].map((m) => m[1]);
    // Known-positive: a parse that finds no columns would report no orphans.
    expect(declared.length).toBeGreaterThan(20);
    const orphans = declared.filter(
      (name) => !new RegExp(`^\\s+${name}:`, "m").test(script),
    );
    expect(orphans).toEqual([]);
  });

  it("both condition displays mark a category that was assumed", () => {
    for (const file of ["RadarMap.tsx", "RunwayGatePanel.tsx"]) {
      const source = readFileSync(`${__dirname}/../components/${file}`, "utf8");
      expect(source).toContain("conditionObserved === false");
      expect(source).toContain("(assumed)");
    }
    // Known-positive: the flag has to exist on the type both files read it
    // from, or the check above passes against a field nothing ever sets.
    const types = readFileSync(`${__dirname}/types.ts`, "utf8");
    expect(types).toMatch(/conditionObserved\??: boolean/);
  });

  it("a proximity alert quotes the thresholds that actually fired it", () => {
    const reasons: string[] = [];
    for (const scenario of SCENARIOS) {
      for (const alert of runAllRules(scenario.build())) {
        if (alert.category !== "proximity-conflict") continue;
        if (!alert.reason.includes("= warning")) continue;
        reasons.push(alert.reason);
      }
    }
    // Known-positive: no proximity alerts means nothing was compared.
    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of reasons) {
      expect(reason).toContain("Below 2 NM / 1000 ft = warning");
      expect(reason).not.toContain("Below 5 NM");
    }
  });

  it("reads the visibility forms international fields actually send", () => {
    // 9999 or CAVOK, normalised: at least six statute miles.
    expect(parseVis("6+")).toBe(6);
    // Metric visibility, already converted by the source.
    expect(parseVis(3.73)).toBeCloseTo(3.73, 2);
    // The US forms, kept beside them so a change has to satisfy both.
    expect(parseVis("10+")).toBe(10);
    expect(parseVis("P6SM")).toBe(6);
    // Known-positive: a parser returning its default for everything would pass
    // the bounds above by accident, so one value below the default is asserted.
    expect(parseVis("M1/4")).toBe(0.25);
    // The trailing-plus strip looks redundant, because parseFloat("6+") is
    // already 6, and the forms above cannot tell whether it is there. It is not
    // redundant: it runs before the fraction match, and without it "3/4+"
    // reaches parseFloat and becomes 3 rather than 0.75, a fourfold
    // overstatement in the direction that silences thresholds. No observed
    // METAR has sent that form, so this asserts the defensive behaviour and
    // says so; deleting the strip fails here and nowhere else.
    expect(parseVis("3/4+")).toBe(0.75);
    expect(parseVis("1 1/2+")).toBe(1.5);
  });

  it("the sampler records whether its weather was observed", () => {
    const script = readFileSync(
      `${__dirname}/../../scripts/fp-analysis.mjs`,
      "utf8",
    );
    expect(script).toContain('"wx_observed_for"');
    // Declared as a column and populated from the state, not just declared: a
    // column in the header with nothing behind it writes an empty field for
    // every row and reads exactly like a window that never observed weather.
    expect(script).toMatch(
      /wx_observed_for:\s*ctx\.state\.weatherObservedFor/,
    );
    // And the field it reads has to exist on the type it reads it from.
    const types = readFileSync(`${__dirname}/types.ts`, "utf8");
    expect(types).toMatch(/weatherObservedFor\??:/);
    // And something in the sampler has to SET it, not merely read it. The
    // first version of this test checked that the column was populated from
    // the state and passed while the state field was never assigned, because
    // the application sets it in its store and the sampler builds its own
    // state. The result was a column writing an empty field on every row of
    // the first window collected after it existed, which reads as an honest
    // absence and is a silent one. Found by opening the window, not by a check.
    expect(script).toMatch(/weatherObservedFor:\s*ctx\.airport\.icao/);
    // The second field, which is a different question from the first and was
    // conflated with it once already. wx_observed_for says an observation
    // arrived; this says the observation carried a flight category, because a
    // METAR without one sets the first and still defaults the condition to
    // visual. Both are needed to bound the defaulted share.
    expect(script).toContain('"wx_condition_observed"');
    expect(script).toMatch(/ctx\.state\.weather\.conditionObserved/);
    expect(types).toMatch(/conditionObserved\??:/);
    const ingest = readFileSync(`${__dirname}/live-weather.ts`, "utf8");
    expect(ingest).toMatch(/conditionObserved:\s*m\.fltCat != null/);
  });

  it("the live-feed probe script requests the path live-adsb.ts builds", () => {
    const client = readFileSync(`${__dirname}/live-adsb.ts`, "utf8");
    const script = readFileSync(
      `${__dirname}/../../scripts/check-live-feed.sh`,
      "utf8",
    );
    // The client interpolates values; compare the literal segments around them.
    for (const segment of ["/api/adsb/v2/lat/", "/lon/", "/dist/"]) {
      expect(client).toContain(segment);
      expect(script).toContain(segment);
    }
    // Known-positive: a script that contained none of these would fail above,
    // but one that contained them inside a comment and requested something else
    // would not, so the request line itself is checked.
    expect(script).toMatch(
      /url="\$\{HOST\}\/api\/adsb\/v2\/lat\/\$\{lat\}\/lon\/\$\{lon\}\/dist\/\$\{RANGE_NM\}"/,
    );
    // And the radius the client queries is the radius the script probes.
    const range = client.match(/const RANGE_NM = (\d+);/);
    expect(range).not.toBeNull();
    expect(script).toContain(`RANGE_NM=${range![1]}`);
  });

  it("every assigned gate exists in the scenario's own state", () => {
    const offenders: string[] = [];
    let assignments = 0;
    for (const scenario of SCENARIOS) {
      const state = scenario.build();
      const gates = new Set(state.gates.map((g) => g.id));
      if (gates.size === 0) continue;
      for (const flight of state.flights) {
        if (!flight.assignedGate) continue;
        assignments++;
        if (!gates.has(flight.assignedGate)) {
          offenders.push(`${scenario.id}: ${flight.callsign} -> ${flight.assignedGate}`);
        }
      }
    }
    expect(offenders).toEqual([]);
    // Known-positive: gate assignments are rarer than runway ones, so this
    // bound is lower and still above zero on purpose.
    expect(assignments).toBeGreaterThan(10);
  });

  it("callsigns are unique within each scenario", () => {
    const offenders: string[] = [];
    let flights = 0;
    for (const scenario of SCENARIOS) {
      const seen = new Set<string>();
      for (const flight of scenario.build().flights) {
        flights++;
        if (seen.has(flight.callsign)) {
          offenders.push(`${scenario.id}: ${flight.callsign}`);
        }
        seen.add(flight.callsign);
      }
    }
    expect(offenders).toEqual([]);
    expect(flights).toBeGreaterThan(50);
  });

  // An alert is a claim about specific aircraft on a specific runway, and
  // nothing checks that the things it names exist. A detector that emitted an
  // alert referencing a flight the state does not hold would render a strip
  // with no aircraft behind it, and one naming a runway the field lacks would
  // scope suppression against nothing, so a genuine alert on that runway could
  // survive alongside it. Both pass across the corpus; they are pinned because
  // the failure mode is a confident alert about something that is not there.
  // A runway identifier encodes two ends of one strip of concrete, so the two
  // numbers must be eighteen apart on the compass rose. This is separate from
  // the heading check elsewhere in this file, which compares a registry heading
  // against surveyed thresholds; this one asks only whether the identifier is
  // self-consistent. It matters because `endsOf` above, the runway detector and
  // the attribution code all split on the slash and trust both halves, so an
  // identifier like 09/26 would silently produce an end that names a direction
  // the strip does not point in. Ids must also be unique within a field, since
  // suppression is scoped by that string.
  it("runway identifiers name two opposite ends and are unique per field", () => {
    const notOpposite: string[] = [];
    const duplicates: string[] = [];
    let checked = 0;
    for (const [icao, airport] of Object.entries(AIRPORTS)) {
      const seen = new Set<string>();
      for (const runway of airport.runways) {
        if (seen.has(runway.id)) duplicates.push(`${icao}: ${runway.id}`);
        seen.add(runway.id);
        const parts = runway.id.split("/");
        expect(parts).toHaveLength(2);
        const numbers = parts.map((part) =>
          Number.parseInt(part.replace(/[LRC]/g, ""), 10),
        );
        expect(numbers.every((n) => n >= 1 && n <= 36)).toBe(true);
        checked++;
        let apart = Math.abs(numbers[0] - numbers[1]);
        if (apart > 18) apart = 36 - apart;
        if (apart !== 18) {
          notOpposite.push(`${icao}: ${runway.id} ends ${apart * 10} degrees apart`);
        }
      }
    }
    expect(notOpposite).toEqual([]);
    expect(duplicates).toEqual([]);
    // Known-positive: an empty registry would satisfy both lists.
    expect(checked).toBeGreaterThan(40);
  });

  it("every alert names flights and runways that exist in its own state", () => {
    const ghosts: string[] = [];
    const unknownRunways: string[] = [];
    let alerts = 0;
    let references = 0;
    for (const scenario of SCENARIOS) {
      const state = scenario.build();
      const ids = new Set(state.flights.map((f) => f.id));
      const ends = endsOf(state.runways);
      for (const alert of runAllRules(state)) {
        alerts++;
        for (const id of alert.flightIds) {
          references++;
          if (!ids.has(id)) ghosts.push(`${scenario.id}: ${alert.category} -> ${id}`);
        }
        if (alert.runwayId && !ends.has(alert.runwayId)) {
          unknownRunways.push(
            `${scenario.id}: ${alert.category} -> ${alert.runwayId}`,
          );
        }
      }
    }
    expect(ghosts).toEqual([]);
    expect(unknownRunways).toEqual([]);
    // Known-positive: a corpus that raised no alerts would pass vacuously, and
    // so would one whose alerts named nobody. Both counts are asserted.
    expect(alerts).toBeGreaterThan(20);
    expect(references).toBeGreaterThan(40);
  });

  it("every squawk is four octal digits or the unknown marker", () => {
    const offenders: string[] = [];
    let squawks = 0;
    for (const scenario of SCENARIOS) {
      for (const flight of scenario.build().flights) {
        if (!flight.squawk || flight.squawk === "----") continue;
        squawks++;
        if (!/^[0-7]{4}$/.test(flight.squawk)) {
          offenders.push(`${scenario.id}: ${flight.callsign} ${flight.squawk}`);
        }
      }
    }
    expect(offenders).toEqual([]);
    expect(squawks).toBeGreaterThan(20);
  });
});
