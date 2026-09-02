import type { Runway } from "./types";
import type { EndGeometry } from "./runway-geometry";
import { alongTrackToThresholdNm, crossTrackToEndNm } from "./runway-geometry";

const headingDelta = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

const runwayHeadings = (rwy: Runway): number[] => {
  if (rwy.id.includes("/")) {
    const [a, b] = rwy.id.split("/");
    const aHdg = Number.parseInt(a.replace(/[^0-9]/g, ""), 10) * 10;
    const bHdg = Number.parseInt(b.replace(/[^0-9]/g, ""), 10) * 10;
    return [aHdg, bHdg];
  }
  return [rwy.headingDeg, (rwy.headingDeg + 180) % 360];
};

/**
 * Heading gate against the coordinate-derived TRUE course. Wider than the
 * legacy 20-degree gate on purpose: the input heading is whichever of
 * magnetic heading and true track the feed supplied, so the gate has to
 * absorb up to 13 degrees of variation on top of intercept geometry. The
 * discrimination between parallels no longer rests on this gate at all; it
 * rests on cross-track distance, which headings cannot provide.
 *
 * That rationale was incomplete, and measuring the registry showed by how
 * much. `runwayHeadings` takes its course from the designator when the id
 * carries both ends, so the value entering this gate is rounded to the
 * nearest ten degrees before variation is applied, and the two errors add
 * rather than cancel wherever variation is easterly. Across all 62 strips the
 * worst gap between designator and surveyed true course is 23.0 degrees, at
 * KLAX 06L/24R, which uses 77 per cent of this gate rather than the 13
 * degrees the paragraph above anticipates. The gate is still wide enough and
 * is not being changed; what changed is that the margin is now measured and
 * pinned by a test, so an added airport or a renumbered runway that eats the
 * remaining seven degrees fails the suite instead of silently losing
 * attribution.
 */
const COURSE_GATE_DEG = 30;

/**
 * How far beyond a threshold a departure may be and still be attributed to the
 * runway it left. A climb-out follows the departure end's course for the first
 * few miles before turning on course, and 8 NM is inside that for the jet
 * departures this matters for while staying short of the point where a turn has
 * usually happened. Beyond it, attribution declines rather than guessing.
 */
const MAX_DEPARTURE_ALONG_TRACK_NM = 8;

/**
 * An aircraft further than this from every extended centreline gets no
 * attribution. Localiser tracking holds within about 0.05 NM; the closest US
 * parallel centrelines sit 0.12 NM apart, so 0.6 NM admits sloppy intercepts
 * while staying far below the point where attribution would be a guess.
 */
const MAX_CROSS_TRACK_NM = 0.6;

/**
 * Attribute an aircraft to a runway end.
 *
 * With end geometry and a position (live path at airports the coordinate file
 * covers): candidates pass the course gate, then the NEAREST extended
 * centreline within 0.6 NM cross-track wins. Parallel runways share a heading
 * and are exactly the case the legacy heuristic tie-broke arbitrarily; 51 of
 * the registry's 62 strips share a heading with another strip, so the
 * arbitrary tie was the ordinary case at a US field, not an edge. Cross-track
 * is the discriminator the runway record could never carry, because it stored
 * no position (docs/runway-attribution-limit.md).
 *
 * Without geometry or position (scenarios, airports outside the coordinate
 * file): the legacy heading-only match, unchanged, including its arbitrary
 * tie between parallels.
 */
/**
 * `isDeparture` runs the same geometry backwards. An arrival sits on the
 * approach side of the threshold, so its along-track distance is positive; a
 * departure has crossed the threshold it left and is climbing away, so its
 * along-track distance is negative. Both are near the same extended
 * centreline, and both fly the end's course. So the only difference between
 * attributing the two is the sign of one scalar and a cap on how far past the
 * threshold to keep looking.
 *
 * This exists because of a measured cost. Removing the departure exclusion
 * from the proximity walk made the whole departure population visible, and
 * departure-involved pairs then reached critical at roughly twice the
 * arrival-to-arrival rate, with two airborne departures the largest group in
 * the population. The arrival side had an equivalent false-positive class,
 * simultaneous parallel approaches, and it was triaged by comparing the two
 * aircraft's assigned runways. Departures could not be triaged the same way
 * because live ingest gave them no runway at all. This closes that gap in the
 * data rather than adding a threshold. See docs/departure-fix-cost.md.
 */
export const inferRunway = (
  headingDeg: number,
  altitudeFt: number,
  runways: Runway[],
  geometry?: EndGeometry[],
  posNm?: { x: number; y: number },
  isDeparture = false,
): string | undefined => {
  // Every gate below is written as "skip when out of range", and every
  // comparison against NaN is false, so a non-finite input satisfied all of
  // them and fell through to the attribution rather than out of it. A record
  // with a missing altitude, heading or position was therefore attributed to
  // whichever end the geometry lists first, with full confidence, while an
  // aircraft 400 NM away was correctly refused. Guards phrased as exclusions
  // fail open; the same logic phrased as inclusions would fail closed. Rather
  // than reword five comparisons and rely on nobody adding a sixth, reject
  // non-finite input once, here.
  //
  // Stated so the guard is not mistaken for evidence of a live bug: the
  // current ingest path cannot deliver one. live-adsb.ts returns null for a
  // record with no position before it projects, declines one with no track,
  // and maps a non-numeric altitude to zero. This is a boundary check on a
  // function three call sites reach, not a repair of an observed fault.
  if (
    !Number.isFinite(altitudeFt) ||
    !Number.isFinite(headingDeg) ||
    (posNm && (!Number.isFinite(posNm.x) || !Number.isFinite(posNm.y)))
  ) {
    return undefined;
  }

  // KNOWN DEFECT, pinned by a test rather than tuned. This gate is absolute
  // and the altitude reaching it is MSL, so it is really "within 5,000 ft of
  // sea level" and not "within 5,000 ft of the field". At Denver, whose
  // elevation is above 5,000 ft, an aircraft standing on the runway is
  // already over the cutoff, so attribution never fires there at all and both
  // the runway-conflict detector and the parallel-runway demotion in the
  // proximity walk are inert at that airport.
  //
  // The correct gate is height above the field, and this repository carries
  // no field elevation: airports.ts has no such property and the threshold
  // coordinates are horizontal only. Adding one is a data change with a
  // source (NASR publishes airport elevation), which is why this is recorded
  // for the next regeneration in scripts/gen-runway-geometry.py rather than
  // guessed at here. Raising the constant instead would move a threshold that
  // published measurements were taken against, for no better reason than that
  // it is easier.
  if (altitudeFt > 5000) return undefined;

  if (geometry && geometry.length > 0 && posNm) {
    let best: { endLabel: string; cross: number; delta: number } | undefined;
    for (const end of geometry) {
      const delta = headingDelta(headingDeg, end.trueCourseDeg);
      if (delta >= COURSE_GATE_DEG) continue;
      const cross = crossTrackToEndNm(posNm, end);
      if (cross > MAX_CROSS_TRACK_NM) continue;
      const along = alongTrackToThresholdNm(posNm, end);
      if (isDeparture) {
        // Past the threshold, climbing away, and not so far that a turn on
        // course has probably happened.
        if (along > 0 || -along > MAX_DEPARTURE_ALONG_TRACK_NM) continue;
      } else if (along < 0) {
        // An arrival past its own threshold has landed; it is not on approach
        // to this end. Previously unchecked, which let a rolling-out arrival
        // keep the attribution of the runway it had just used.
        continue;
      }
      if (!best || cross < best.cross || (cross === best.cross && delta < best.delta)) {
        best = { endLabel: end.endLabel, cross, delta };
      }
    }
    return best?.endLabel;
  }

  let best: { rwyId: string; endLabel: string; delta: number } | undefined;
  for (const rwy of runways) {
    const headings = runwayHeadings(rwy);
    const ends = rwy.id.includes("/") ? rwy.id.split("/") : [rwy.id, ""];
    // Paired by index, which is safe only because both lists are always two
    // long: runwayHeadings returns a pair either way, and ends is a split on a
    // single slash or a synthesised pair. An identifier carrying two slashes
    // would give three ends against two headings and silently label an end
    // with the wrong one. What holds that is the registry test added
    // 2026-09-01 asserting every identifier splits into exactly two parts, so
    // this pairing depends on a guarantee enforced elsewhere and the
    // dependency is named here rather than assumed.
    headings.forEach((h, i) => {
      const delta = headingDelta(headingDeg, h);
      if (delta < 20 && (!best || delta < best.delta)) {
        best = { rwyId: rwy.id, endLabel: ends[i] || rwy.id, delta };
      }
    });
  }
  return best?.endLabel;
};
