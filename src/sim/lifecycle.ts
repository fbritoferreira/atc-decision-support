// Alert lifecycle: first-seen / last-seen tracking with a grace period before
// removal.
//
// The detector population is stateless by design; each tick's alerts are
// computed from scratch. On a clean scenario that is exactly right. On live
// ADS-B it produces flicker: a pair of aircraft hovering either side of a
// separation threshold makes an alert appear and vanish on consecutive polls,
// which is the single fastest way to lose an operator's trust in a display.
//
// This module adds the missing piece without giving the detectors memory. It is
// a pure function of (previous tracked alerts, this tick's alerts, tick), so
// determinism survives: replaying the same sequence of ticks yields the same
// output every time. The state lives with the caller, in the store, and not
// inside a detector.

import type { Alert, TrackedAlert } from "./types";

export type { TrackedAlert };

/**
 * How many consecutive ticks an alert may be absent from detector output before
 * it is dropped. Three at the 20-second live poll interval is a one-minute
 * grace period, long enough to ride out threshold jitter and short enough that
 * a genuinely resolved conflict clears promptly.
 */
export const ALERT_GRACE_TICKS = 3;

// TrackedAlert is declared in types.ts alongside SimState, which holds it, and
// re-exported above so callers can import it from either module.
//
//   firstSeenTick  tick at which the alert was first emitted
//   lastSeenTick   most recent tick at which a detector emitted it
//   stale          held through the grace period: detectors no longer emit it,
//                  but it has not been absent long enough to drop. An operator
//                  surface should render these as clearing rather than active.

/**
 * Reconciles the alerts a detector pass produced against those already being
 * tracked.
 *
 * An alert present this tick keeps its original `firstSeenTick`, so "how long
 * has this been true" survives across ticks and `createdAtTick` finally means
 * something. An alert absent this tick is retained and marked `stale` until it
 * has been missing for more than ALERT_GRACE_TICKS, then dropped.
 *
 * Severity is refreshed from the current pass, so an escalating conflict shows
 * its new tier immediately rather than waiting out the grace period.
 */
export const reconcileAlerts = (
  previous: readonly TrackedAlert[],
  current: readonly Alert[],
  tick: number,
): TrackedAlert[] => {
  const currentById = new Map(current.map((a) => [a.id, a]));
  const seen = new Set<string>();
  const out: TrackedAlert[] = [];

  for (const prev of previous) {
    const now = currentById.get(prev.id);
    if (now) {
      seen.add(prev.id);
      out.push({
        ...now,
        firstSeenTick: prev.firstSeenTick,
        lastSeenTick: tick,
        stale: false,
      });
    } else if (tick - prev.lastSeenTick <= ALERT_GRACE_TICKS) {
      out.push({ ...prev, stale: true });
    }
    // Otherwise the alert has been absent beyond the grace period; drop it.
  }

  for (const a of current) {
    if (seen.has(a.id)) continue;
    out.push({ ...a, firstSeenTick: tick, lastSeenTick: tick, stale: false });
  }

  return out;
};

/**
 * The operator view: alerts a controller should act on now. Excludes those
 * clearing through the grace period and those subsumed by a higher-severity
 * alert on the same runway. Both are retained in the tracked set for audit.
 */
export const activeAlerts = (tracked: readonly TrackedAlert[]): TrackedAlert[] =>
  tracked.filter((a) => !a.stale && a.suppressedBy === undefined);

/** How long an alert has been continuously true, in ticks. */
export const alertAgeTicks = (a: TrackedAlert, tick: number): number =>
  tick - a.firstSeenTick;
