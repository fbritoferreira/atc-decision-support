import { runAllRules } from "./rules";
import type { Alert, Flight, SimState } from "./types";

const RAD = Math.PI / 180;

/**
 * Advance an arrival's phase to match its projected ETA, using the same
 * thresholds the engine applies tick by tick (enroute to approach inside ten
 * minutes, approach to final inside three). Without this the projector mutates
 * the continuous variables while copying the discrete state that gives them
 * meaning, and every phase-gated detector is then asked about a world that
 * cannot occur: an arrival marked final at 0 ft ten miles out, or still marked
 * enroute two minutes from the threshold.
 */
const projectArrivalPhase = (phase: Flight["phase"], etaMin: number): Flight["phase"] => {
  let next = phase;
  if (next === "enroute" && etaMin < 10) next = "approach";
  if (next === "approach" && etaMin < 3) next = "final";
  return next;
};

/**
 * Returns null when the flight leaves the projection: an arrival whose
 * projected ETA reaches zero has landed within the horizon. The alternative,
 * clamping altitude at some floor, keeps the aircraft in the population at an
 * altitude the model invented; the proximity detector filters to altitudes
 * above zero, so under the old clamp the longer horizons silently lost exactly
 * the aircraft closest to landing, with no alert emitted to be missed.
 */
const projectFlight = (f: Flight, dtMin: number): Flight | null => {
  const etaMin = Math.max(0, f.etaMin - dtMin);
  if (f.type === "arrival" && etaMin <= 0) return null;
  const phase = f.type === "arrival" ? projectArrivalPhase(f.phase, etaMin) : f.phase;
  const hdg = (f.headingDeg ?? 0) * RAD;
  const dxNm = (Math.sin(hdg) * f.speedKts * dtMin) / 60;
  const dyNm = (-Math.cos(hdg) * f.speedKts * dtMin) / 60;
  const descentFpm =
    f.type === "arrival" && (phase === "approach" || phase === "final") ? 800 : 0;
  // Departures climb only once rolling. A queued aircraft is holding for
  // clearance at speed zero, so the old gate projected it climbing on the
  // spot: 4,500 ft above the hold-short line at three minutes, position
  // unchanged. It has no trajectory to project until it is moving.
  const climbFpm = f.type === "departure" && phase === "departed" ? 1500 : 0;
  const dAlt = (climbFpm - descentFpm) * dtMin;
  return {
    ...f,
    phase,
    positionNm: { x: f.positionNm.x + dxNm, y: f.positionNm.y + dyNm },
    altitudeFt: Math.max(0, f.altitudeFt + dAlt),
    etaMin,
    fuelMin: Math.max(0, f.fuelMin - dtMin),
  };
};

export const projectState = (state: SimState, dtMin: number): SimState => ({
  ...state,
  flights: state.flights
    .map((f) => projectFlight(f, dtMin))
    .filter((f): f is Flight => f !== null),
});

const PREDICTIONS_MIN = [1, 2, 3];

const DEMOTE: Record<Alert["severity"], Alert["severity"]> = {
  critical: "warning",
  warning: "advisory",
  advisory: "info",
  info: "info",
};

/**
 * Demotion deepens with the projection horizon: one step at one and two
 * minutes out, two steps at three. A three-minute forecast from a
 * constant-heading projector deserves less of the operator's attention than a
 * one-minute one, and the tier should say so.
 *
 * Deliberate deviation from the original design note, which let a one-minute
 * projection keep its base severity: a projected alert is never critical here,
 * whatever the horizon. The critical tier is reserved for conditions that hold
 * in the present state — both the negative-control guarantee of Section 6.8
 * and the alert-fatigue argument of Section 2.6 depend on that reservation.
 */
// Exported for the direct test of this property. The corpus cannot exercise it:
// every projected alert the 28 scenarios produce is already info, the lowest
// tier, so the corpus assertions that a projection is never critical hold
// whatever this function does, including nothing.
export const demoteForHorizon = (
  severity: Alert["severity"],
  lookaheadMin: number,
): Alert["severity"] => {
  const once = DEMOTE[severity];
  return lookaheadMin >= 3 ? DEMOTE[once] : once;
};

export const runPredictiveRules = (state: SimState): Alert[] => {
  const present = runAllRules(state);
  const presentIds = new Set(present.map((a) => a.id));
  // Base (unprefixed) ids already reported at a nearer horizon. A condition
  // projected at one minute is not re-reported at two and three; the nearest
  // horizon carries the report. An earlier version compared the prefixed id
  // against the unprefixed one, a predicate that could never match, so the
  // same conflict reached the operator at up to three horizons at once. The
  // bug survived because the duplicate ids differed by prefix and severity
  // was horizon-independent, so no existing assertion could see it.
  const reported = new Set<string>();
  const predicted: Alert[] = [];
  for (const lookahead of PREDICTIONS_MIN) {
    const projected = projectState(state, lookahead);
    const projectedAlerts = runAllRules(projected);
    for (const a of projectedAlerts) {
      if (presentIds.has(a.id)) continue;
      if (reported.has(a.id)) continue;
      reported.add(a.id);
      predicted.push({
        ...a,
        id: `predicted-${lookahead}-${a.id}`,
        severity: demoteForHorizon(a.severity, lookahead),
        title: `IN ${lookahead} MIN: ${a.title}`,
        detail: `Forecast: ${a.detail}`,
        lookaheadMin: lookahead,
      });
    }
  }
  return [...present, ...predicted];
};
