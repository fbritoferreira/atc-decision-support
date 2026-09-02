import type { Flight, TrailPoint } from "./types";

const MAX_POINTS = 30;

// How many ticks a vanished flight's trail lingers before it is dropped.
const FADE_TICKS = 10;

export const updateTrails = (
  prev: Record<string, TrailPoint[]>,
  flights: Flight[],
): Record<string, TrailPoint[]> => {
  const next: Record<string, TrailPoint[]> = {};
  const ids = new Set(flights.map((f) => f.id));
  for (const f of flights) {
    if (f.phase === "at-gate" || f.phase === "departed") {
      next[f.id] = prev[f.id] ?? [];
      continue;
    }
    const existing = prev[f.id] ?? [];
    const last = existing[existing.length - 1];
    const point: TrailPoint = { x: f.positionNm.x, y: f.positionNm.y, alt: f.altitudeFt };
    const moved = !last || Math.hypot(last.x - point.x, last.y - point.y) > 0.05;
    const updated = moved ? [...existing, point].slice(-MAX_POINTS) : existing;
    next[f.id] = updated;
  }
  for (const id of Object.keys(prev)) {
    if (!ids.has(id)) {
      // Flight gone from the feed: keep the tail of its trail briefly, then
      // forget it. This used to be `t.slice(-10)` on every tick, under this
      // same comment. That truncates once and is then a fixed point, so
      // nothing was ever forgotten: 200 flights passing through a live
      // session left 200 entries, each holding ten points, for as long as the
      // page stayed open. It reads like decay because slice looks like it is
      // removing something, and past the tenth element it is not.
      //
      // Now it shortens by one per tick and the key is dropped when empty, so
      // a vanished flight costs FADE_TICKS ticks and then nothing. Only
      // reachable by applying this function repeatedly, which is why the
      // tests for it call it in a loop rather than once.
      const t = prev[id];
      const faded = t.length > FADE_TICKS ? t.slice(-FADE_TICKS) : t.slice(1);
      if (faded.length > 0) next[id] = faded;
    }
  }
  return next;
};

export const resetTrails = (): Record<string, TrailPoint[]> => ({});
