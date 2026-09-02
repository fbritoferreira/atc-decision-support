/**
 * Extended-centreline geometry for runway attribution.
 *
 * The registry's runway record carries an identifier, a heading, a length and
 * no position, so nothing in it distinguishes 27L from 27R in space; the
 * papers document that as the attribution limit (docs/
 * runway-attribution-limit.md). This module is the data-model half of closing
 * it: real threshold coordinates per end, projected into the same ARP-local
 * frame every detector already works in, plus the two scalars attribution
 * needs, cross-track distance from an extended centreline and along-track
 * distance to a threshold.
 *
 * Courses here are TRUE bearings derived from the coordinates, not the
 * name-times-ten magnetic heuristic: ADS-B tracks are true, and the magnetic
 * variation the old heuristic ignored reaches 13 degrees at the New York
 * fields.
 */
import { type Airport, latLonToLocalNm } from "./airports";
import type { Runway } from "./types";
import { RUNWAY_ENDS } from "./runway-ends-data";

export type EndGeometry = {
  /** Registry strip id, "08L/26R". */
  runwayId: string;
  /** The end an aircraft lands on, "08L". */
  endLabel: string;
  /** Threshold position, ARP-local NM (x east, y south-positive). */
  threshold: { x: number; y: number };
  /** Unit vector of the direction of flight when landing this end. */
  course: { x: number; y: number };
  /** True course in compass degrees, for heading gates. */
  trueCourseDeg: number;
};

const unit = (dx: number, dy: number): { x: number; y: number } => {
  const len = Math.hypot(dx, dy);
  return len === 0 ? { x: 0, y: 0 } : { x: dx / len, y: dy / len };
};

/** Local-frame vector to compass degrees: x east, y south-positive. */
const toCompassDeg = (v: { x: number; y: number }): number =>
  (Math.atan2(v.x, -v.y) * 180) / Math.PI < 0
    ? (Math.atan2(v.x, -v.y) * 180) / Math.PI + 360
    : (Math.atan2(v.x, -v.y) * 180) / Math.PI;

/**
 * Both landable ends of every strip the data file covers for this airport.
 * Airports without coordinate data return an empty array, and callers fall
 * back to heading-only attribution.
 */
const geometryCache = new Map<string, EndGeometry[]>();

export const airportEndGeometries = (airport: Airport): EndGeometry[] => {
  const cached = geometryCache.get(airport.icao);
  if (cached) return cached;
  const strips = RUNWAY_ENDS[airport.icao];
  if (!strips) return [];
  const out: EndGeometry[] = [];
  for (const [runwayId, ends] of Object.entries(strips)) {
    const [leLabel, heLabel] = runwayId.split("/");
    const le = latLonToLocalNm(ends.leLat, ends.leLon, airport.arp);
    const he = latLonToLocalNm(ends.heLat, ends.heLon, airport.arp);
    // Landing on the first-named end crosses its threshold flying toward the
    // other end, so the course vector runs le to he; the reciprocal end
    // reverses it.
    const leCourse = unit(he.x - le.x, he.y - le.y);
    const heCourse = unit(le.x - he.x, le.y - he.y);
    out.push(
      { runwayId, endLabel: leLabel, threshold: le, course: leCourse, trueCourseDeg: toCompassDeg(leCourse) },
      { runwayId, endLabel: heLabel, threshold: he, course: heCourse, trueCourseDeg: toCompassDeg(heCourse) },
    );
  }
  geometryCache.set(airport.icao, out);
  return out;
};

/** Perpendicular distance from the end's extended centreline, NM. */
export const crossTrackToEndNm = (pos: { x: number; y: number }, end: EndGeometry): number => {
  const wx = pos.x - end.threshold.x;
  const wy = pos.y - end.threshold.y;
  return Math.abs(wx * end.course.y - wy * end.course.x);
};

/**
 * Distance to the threshold measured along the approach course, NM. Positive
 * on the approach side, negative once past the threshold (rollout or
 * overflight).
 */
export const alongTrackToThresholdNm = (pos: { x: number; y: number }, end: EndGeometry): number => {
  const wx = pos.x - end.threshold.x;
  const wy = pos.y - end.threshold.y;
  return -(wx * end.course.x + wy * end.course.y);
};

/**
 * The airport's runway records with the coordinate-derived true course of each
 * strip's first-named end attached, where geometry exists for it.
 *
 * The registry stores magnetic headings because runway names are magnetic. Any
 * doctrine comparing a record against an ADS-B track needs the true course, and
 * before this existed the runway-identity doctrine compared a true track
 * against a magnetic heading inside a 20-degree gate. Strips the geometry does
 * not cover keep an undefined course and every consumer falls back to the
 * magnetic heading, which is what scenario runways do.
 */
export const runwaysWithTrueCourse = (airport: Airport): Runway[] => {
  const ends = airportEndGeometries(airport);
  if (ends.length === 0) return airport.runways;
  return airport.runways.map((runway) => {
    const leLabel = runway.id.split("/")[0];
    const end = ends.find(
      (e) => e.runwayId === runway.id && e.endLabel === leLabel,
    );
    return end ? { ...runway, trueCourseDeg: end.trueCourseDeg } : runway;
  });
};
