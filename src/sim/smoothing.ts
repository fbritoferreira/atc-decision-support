// ETA smoothing at the live-ingest boundary.
//
// The KATL crosstab (thesis Table 2) attributed 79.1% of critical alerts to
// wake-spacing. The mechanism is measurement noise, not doctrine: live ingest
// recomputes each arrival's ETA from distance and ground speed on every poll,
// ground speed jitters between ADS-B reports, and the ETA gap between a lead
// and trail aircraft oscillates across the detector's critical boundary
// (gap < required − 1 minute). The doctrine is right; its input shakes.
//
// The fix therefore lives here, at ingest, and not in the detector. Detectors
// stay pure and stateless (the Section 4.1 determinism claim depends on it);
// this module is a pure function of (previous flights, current flights), the
// same contract as updateTrails, with state owned by the caller.
//
// Cost, stated because tuning always trades something: an exponential moving
// average with ALPHA = 0.4 lags a genuine ETA change by roughly two polls
// (~40 s at the 20-second live cadence). A real, steadily closing wake gap
// reaches the critical tier about two polls later than it would unsmoothed.
// The wake doctrine's critical boundary sits a full minute inside the
// required separation, so the delayed escalation still precedes the violation
// itself; the validation window after this change measures the false-positive
// side of that trade.

import type { Flight } from "./types";

/** Weight of the newest observation. 1 = no smoothing. */
export const ETA_SMOOTHING_ALPHA = 0.4;

/**
 * Returns `current` with each arrival's `etaMin` blended against the previous
 * tick's smoothed value for the same aircraft id. Aircraft new to the picture
 * pass through unchanged; aircraft absent from `current` are gone (the caller
 * decides nothing about them here). Departures pass through: their etaMin is
 * synthetic and no detector compares it.
 *
 * Pure: same inputs, same output. No clock, no shared state.
 */
export const smoothEtas = (
  previous: readonly Flight[],
  current: readonly Flight[],
  alpha: number = ETA_SMOOTHING_ALPHA,
): Flight[] => {
  if (previous.length === 0) return [...current];
  const prevById = new Map(previous.map((f) => [f.id, f]));
  return current.map((f) => {
    if (f.type !== "arrival") return f;
    const prev = prevById.get(f.id);
    if (!prev) return f;
    const blended = alpha * f.etaMin + (1 - alpha) * prev.etaMin;
    return { ...f, etaMin: blended };
  });
};
