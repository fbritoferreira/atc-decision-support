import { useEffect, useReducer } from "react";
import { AIRPORTS, type Airport } from "./airports";
import { fetchLiveTrafficDetailed } from "./live-adsb";
import { runwaysWithTrueCourse } from "./runway-geometry";
import { activeAlerts, reconcileAlerts, type TrackedAlert } from "./lifecycle";
import { fetchAirportWeather } from "./live-weather";
import { smoothEtas } from "./smoothing";
import { runPredictiveRules } from "./predict";
import { updateTrails } from "./trails";
import type { Flight, SimState, Weather } from "./types";

type Action =
  | {
      type: "flights";
      icao: string;
      flights: Flight[];
      clockMin: number;
      ageSeconds: number | undefined;
      stale: boolean;
    }
  | { type: "weather"; icao: string; weather: Weather }
  | { type: "error"; error: string };

const initialState = (airport: Airport): SimState => {
  const now = new Date();
  const clockMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  return {
    tick: 0,
    clockMin,
    sectorId: `${airport.icao} TWR`,
    flights: [],
    runways: runwaysWithTrueCourse(airport),
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
    trackedAlerts: [],
    speed: 1,
    trails: {},
    live: true,
  };
};

/**
 * Runs the detector population, then reconciles the result against the alerts
 * already being tracked so that an alert whose condition oscillates across a
 * threshold does not flicker in and out of the display on consecutive polls.
 *
 * `alerts` carries the operator view: neither stale nor suppressed.
 * `trackedAlerts` carries everything, including alerts clearing through the
 * grace period and those subsumed by a higher-severity alert, so the full
 * detector output remains available for review.
 */
const withReconciledAlerts = (next: SimState): SimState => {
  const tracked = reconcileAlerts(
    (next.trackedAlerts ?? []) as TrackedAlert[],
    runPredictiveRules(next),
    next.tick,
  );
  return { ...next, trackedAlerts: tracked, alerts: activeAlerts(tracked) };
};

// Exported for the suite: the airport-switch path is a reducer property and
// testing it through the hook would need a React renderer this package does
// not carry.
export const liveReducer = (state: SimState, action: Action): SimState => {
  switch (action.type) {
    case "flights": {
      // The airport can change under this hook without the component
      // remounting: the route renders the dashboard with no key, so
      // navigating from one live airport to another re-renders the same
      // instance with a new prop, and useReducer runs its initialiser only on
      // mount. Runways, gates and the sector label came from that initialiser,
      // so the picture showed the new airport's traffic against the previous
      // airport's runways, which the attribution, runway-conflict and
      // crosswind detectors all read. Rebuilding here rather than relying on
      // the caller to pass a key, because the next caller will not.
      const switched =
        action.icao !== state.sectorId.split(" ")[0] && AIRPORTS[action.icao];
      // Weather survives the switch only because its own poll is on a five
      // minute cycle and would otherwise show the default VFR block for up to
      // that long after a change; everything else is rebuilt.
      // The previous airport's observation is NOT carried across. An earlier
      // version of this carried it so the panel would not fall back to the
      // seeded default, marked with the airport it belonged to, and that was
      // wrong for a reason the label did not cover: the weather doctrines read
      // this block too. Switching from a field reporting three miles and an
      // eight-hundred-foot ceiling raised a low-visibility warning about the
      // airport just opened, on the strength of conditions somewhere else.
      // Marking the display is not enough when a detector consumes the same
      // value.
      //
      // The seed raises nothing, because it is calm and clear, so nothing is
      // asserted about the new field until its own observation arrives, and
      // the panel and the wind arrow both say so rather than showing it.
      const base: SimState = switched ? initialState(switched) : state;
      // ETA smoothing against the previous tick, before the detectors see the
      // picture; see smoothing.ts for why this lives at ingest.
      const flights = smoothEtas(base.flights, action.flights);
      const trails = updateTrails(base.trails, flights);
      const next: SimState = {
        ...base,
        // Advanced on every poll because the alert lifecycle measures the
        // grace period in ticks. This stayed at zero for the whole of a live
        // session, so `tick - lastSeenTick` was always zero, no alert ever
        // aged past ALERT_GRACE_TICKS, and nothing was ever dropped: an alert
        // absent for fifty polls was still held and still marked clearing.
        // The operator view was right, because it filters stale alerts out,
        // but the clearing list beside it grew for as long as the page was
        // open and alertAgeTicks answered zero to "how long has this been
        // true" every time it was asked.
        tick: base.tick + 1,
        flights,
        clockMin: action.clockMin,
        trails,
        // Dated from when the PROXY fetched the picture, not from when this
        // response arrived. During an upstream refusal the proxy serves a copy
        // as old as STALE_LIMIT_SECONDS in functions/api/_cached-proxy.ts, and
        // timing from arrival reported that as "updated 0s ago" on a
        // decision-support surface. The bound is named rather than written out
        // because it was five minutes when this comment was first written and
        // is ten now, and the comment did not move with it.
        // Left undefined when the proxy age could not be read, so the
        // surface says the age is unknown rather than dating the picture from
        // a fabricated zero.
        liveUpdatedAt:
          action.ageSeconds === undefined
            ? undefined
            : Date.now() - action.ageSeconds * 1000,
        liveStale: action.stale,
        liveError: undefined,
      };
      return withReconciledAlerts(next);
    }
    case "weather": {
      const next: SimState = {
        ...state,
        weather: action.weather,
        weatherObservedFor: action.icao,
      };
      return withReconciledAlerts(next);
    }
    case "error":
      return { ...state, liveError: action.error };
  }
};

const LIVE_POLL_MS = 20_000;
const WX_POLL_MS = 5 * 60_000;

export const useLiveSim = (airport: Airport) => {
  const [state, dispatch] = useReducer(liveReducer, airport, initialState);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await fetchLiveTrafficDetailed(airport);
        if (cancelled) return;
        const now = new Date();
        const clockMin = now.getUTCHours() * 60 + now.getUTCMinutes();
        dispatch({
          type: "flights",
          icao: airport.icao,
          flights: result.flights,
          clockMin,
          ageSeconds: result.ageSeconds,
          stale: result.stale,
        });
      } catch (e) {
        if (cancelled) return;
        dispatch({ type: "error", error: e instanceof Error ? e.message : String(e) });
      }
    };
    poll();
    const id = setInterval(poll, LIVE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [airport]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const weather = await fetchAirportWeather(airport.icao);
        if (cancelled) return;
        dispatch({ type: "weather", icao: airport.icao, weather });
      } catch {
        /* ignore weather errors */
      }
    };
    poll();
    const id = setInterval(poll, WX_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [airport]);

  return { state };
};
