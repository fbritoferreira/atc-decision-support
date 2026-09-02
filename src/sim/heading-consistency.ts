import { AIRPORTS } from "./airports";
import { RUNWAY_ENDS } from "./runway-ends-data";

/**
 * Per-airport agreement between stored runway headings and the bearings the
 * surveyed thresholds imply.
 *
 * Every runway at one airport shares one magnetic variation, so if the stored
 * headings are magnetic and the coordinates give true bearings, the difference
 * must be constant across that field's strips. A spread is the airport
 * contradicting itself, and it needs no external source: runway-ends-data.ts
 * already holds FAA NASR thresholds for the US fields.
 *
 * Written after the KSFO 10L/10R heading defect had been recorded as blocked
 * on fetching NASR data the repository already contained.
 */
export type HeadingOffset = { id: string; offset: number };
export type HeadingSpreadRow = {
  icao: string;
  offsets: HeadingOffset[];
  spread: number;
};

const toRad = (d: number): number => (d * Math.PI) / 180;

const trueBearing = (s: {
  leLat: number;
  leLon: number;
  heLat: number;
  heLon: number;
}): number => {
  const dLon = toRad(s.heLon - s.leLon);
  const y = Math.sin(dLon) * Math.cos(toRad(s.heLat));
  const x =
    Math.cos(toRad(s.leLat)) * Math.sin(toRad(s.heLat)) -
    Math.sin(toRad(s.leLat)) * Math.cos(toRad(s.heLat)) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};

export const headingSpread = (): HeadingSpreadRow[] => {
  const rows: HeadingSpreadRow[] = [];
  for (const airport of Object.values(AIRPORTS)) {
    const ends = RUNWAY_ENDS[airport.icao];
    if (!ends) continue;
    const offsets: HeadingOffset[] = [];
    for (const runway of airport.runways) {
      const strip = ends[runway.id];
      if (!strip) continue;
      let d = trueBearing(strip) - runway.headingDeg;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      offsets.push({ id: runway.id, offset: d });
    }
    if (offsets.length < 2) continue;
    const values = offsets.map((o) => o.offset);
    rows.push({
      icao: airport.icao,
      offsets,
      spread: Math.max(...values) - Math.min(...values),
    });
  }
  return rows;
};
