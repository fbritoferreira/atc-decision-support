import type { Flight, SimState } from "./types";

const advanceArrival = (f: Flight, dtMin: number): Flight => {
  if (f.phase === "landed" || f.phase === "at-gate" || f.phase === "taxi-in") return f;
  const speed = f.speedKts;
  const distNm = (speed * dtMin) / 60;
  // This was `x + dx * Math.cos(0)` with y left alone. Math.cos(0) is 1, so
  // the expression looked like it resolved a direction and did not: every
  // arrival moved due east at its own speed whatever its heading said, and no
  // aircraft ever changed latitude. A flight on heading 320 gained no
  // northward component at all.
  //
  // The frame is the one RadarMap draws: it converts a heading with
  // (headingDeg - 90), which is north-up with +x east and +y south. So the
  // east component of a compass heading is sin and the south component is
  // -cos. Detectors take their geometry from headingDeg directly and never
  // call tick, so this moved no reported measurement; what it moved is the
  // picture, where symbols slid east while pointing west.
  const headingRad = (f.headingDeg * Math.PI) / 180;
  const next: Flight = {
    ...f,
    positionNm: {
      x: f.positionNm.x + distNm * Math.sin(headingRad),
      y: f.positionNm.y - distNm * Math.cos(headingRad),
    },
    etaMin: Math.max(0, f.etaMin - dtMin),
    fuelMin: Math.max(0, f.fuelMin - dtMin),
  };
  if (next.etaMin <= 0 && next.phase !== "landed") {
    next.phase = "landed";
    next.altitudeFt = 0;
    next.speedKts = 80;
  } else if (next.etaMin < 3 && next.phase === "approach") {
    next.phase = "final";
    next.altitudeFt = Math.max(500, f.altitudeFt - 800 * dtMin);
  } else if (next.phase === "approach" || next.phase === "enroute") {
    next.altitudeFt = Math.max(2000, f.altitudeFt - 600 * dtMin);
    if (next.etaMin < 10 && next.phase === "enroute") next.phase = "approach";
  }
  return next;
};

const advanceDeparture = (f: Flight, dtMin: number): Flight => {
  if (f.phase === "departed") return f;
  const next: Flight = { ...f, fuelMin: Math.max(0, f.fuelMin - dtMin * 0.2) };
  if (f.phase === "at-gate") return next;
  if (f.phase === "taxi-out") {
    next.speedKts = 15;
  }
  return next;
};

export const tick = (state: SimState, dtMin: number): SimState => {
  if (state.speed === 0) return state;
  const effective = dtMin * state.speed;
  const flights = state.flights.map((f) =>
    f.type === "arrival" ? advanceArrival(f, effective) : advanceDeparture(f, effective),
  );
  return {
    ...state,
    tick: state.tick + 1,
    clockMin: state.clockMin + effective,
    flights,
  };
};

export const formatClock = (clockMin: number): string => {
  const m = Math.floor(clockMin) % (24 * 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}Z`;
};
