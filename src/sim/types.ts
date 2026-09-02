export type FlightPhase =
  | "enroute"
  | "approach"
  | "final"
  | "landed"
  | "taxi-in"
  | "at-gate"
  | "taxi-out"
  | "queued"
  | "departed";

export type WakeCategory = "light" | "medium" | "heavy" | "super";

export type Flight = {
  id: string;
  callsign: string;
  type: "arrival" | "departure";
  aircraft: string;
  wake: WakeCategory;
  origin: string;
  destination: string;
  phase: FlightPhase;
  altitudeFt: number;
  speedKts: number;
  headingDeg: number;
  positionNm: { x: number; y: number };
  assignedRunway?: string;
  assignedGate?: string;
  fuelMin: number;
  etaMin: number;
  squawk: string;
};

export type Runway = {
  id: string;
  /**
   * Magnetic, as runway names are. Compare it only against other magnetic
   * bearings; ADS-B tracks are TRUE, and the gap reaches 13 degrees at the New
   * York fields.
   */
  headingDeg: number;
  /**
   * Coordinate-derived TRUE course of the first-named end, where surveyed
   * threshold coordinates exist for the strip. Undefined for airports the
   * geometry does not cover, and for scenario runways built by hand.
   *
   * It exists because two doctrines were comparing degrees drawn from
   * different reference systems: attribution matched an aircraft's true track
   * against a coordinate-derived course, while the runway-identity doctrine
   * matched the same track against this record's magnetic heading. At Boston
   * those disagree by 24 degrees and the doctrine reported an aircraft
   * correctly lined up as rolling on the wrong runway. See
   * docs/departure-attribution-identity.md.
   */
  trueCourseDeg?: number;
  lengthFt: number;
  inUseBy?: string;
  mode: "arrivals" | "departures" | "mixed" | "closed";
  surfaceFriction: "dry" | "wet" | "snow" | "ice";
};

export type Gate = {
  id: string;
  terminal: string;
  occupiedBy?: string;
  scheduledFor?: { flightId: string; etaMin: number };
  maxWake: WakeCategory;
};

export type Weather = {
  windDirDeg: number;
  windKts: number;
  gustsKts: number;
  visibilityNm: number;
  ceilingFt: number;
  condition: "VFR" | "MVFR" | "IFR" | "LIFR";
  /**
   * Whether `condition` came from the observation or from the default.
   *
   * A METAR arriving without a flight category is recorded as VFR, and that
   * default lands on the variable the largest open question turns on: the
   * comparison of wake violations under visual against instrument conditions.
   * Every snapshot mis-filed inflates the visual arm and starves the
   * instrument one, and until 2026-09-01 nothing distinguished a defaulted VFR
   * from a measured one, so the rate could not be bounded even in principle.
   *
   * Optional because scenarios build weather directly and are stating a
   * condition rather than reporting one; absent means the question does not
   * apply. False means the observation carried no category.
   */
  conditionObserved?: boolean;
  precipitation: "none" | "rain" | "snow" | "thunderstorm";
};

export type AlertSeverity = "info" | "advisory" | "warning" | "critical";

export type Alert = {
  id: string;
  severity: AlertSeverity;
  // Every category below has an emitter in rules.ts. A previous revision also
  // declared "missed-handoff", which was removed: SimState models a single
  // sector (`sectorId`), so there is no inter-sector handoff to miss and no
  // honest way to emit it. Reinstate it alongside a multi-sector model, not
  // before.
  category:
    | "runway-conflict"
    | "wake-spacing"
    | "gate-conflict"
    | "fuel-hold"
    | "crosswind"
    | "weather-shift"
    | "cascading-delay"
    | "proximity-conflict"
    | "runway-surface"
    | "runway-identity"
    | "squawk-emergency";
  title: string;
  detail: string;
  flightIds: string[];
  reason: string;
  suggestedAction: string;
  createdAtTick: number;
  lookaheadMin?: number;
  /** Runway this alert concerns, when it is runway-scoped. Used to scope suppression. */
  runwayId?: string;
  /** Set when another alert suppressed this one; retained for audit rather than dropped. */
  suppressedBy?: string;
};

export type TrailPoint = { x: number; y: number; alt: number };

/** Re-exported shape from lifecycle.ts, declared here to avoid a cycle. */
export type TrackedAlert = Alert & {
  firstSeenTick: number;
  lastSeenTick: number;
  stale: boolean;
};

export type SimState = {
  tick: number;
  clockMin: number;
  sectorId: string;
  flights: Flight[];
  runways: Runway[];
  gates: Gate[];
  weather: Weather;
  alerts: Alert[];
  /**
   * Full tracked alert set, including alerts clearing through their grace
   * period and those suppressed by a higher-severity alert on the same runway.
   * `alerts` above is the operator view derived from this. Live mode only;
   * scenario playback recomputes from scratch each tick.
   */
  trackedAlerts?: TrackedAlert[];
  speed: 0 | 1 | 2 | 4 | 8;
  trails: Record<string, TrailPoint[]>;
  live?: boolean;
  /**
   * Which airport the weather in this state was observed for, when it was
   * observed at all. A live session seeds a default block (VFR, calm, ten
   * miles, twenty thousand feet) so the shape is valid before the first METAR
   * arrives, and that default was indistinguishable from a reading: the panel
   * printed it, and the weather doctrines ran against it, for as long as the
   * five-minute weather poll took. Switching airports has the same gap, and
   * carrying the previous airport's observation across it trades a fabricated
   * reading for a real one belonging to somewhere else. Undefined means no
   * observation for the airport on screen.
   */
  weatherObservedFor?: string;
  liveUpdatedAt?: number;
  /**
   * The last picture came from the proxy's stale fallback after the upstream
   * feed refused. `liveUpdatedAt` already carries the real age; this flags that
   * the age is the result of a refusal rather than ordinary caching.
   */
  liveStale?: boolean;
  liveError?: string;
};
