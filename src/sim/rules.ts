import type { Alert, Flight, Runway, SimState } from "./types";
import type { CwtCategory } from "./types-cwt";
import { cwtFromType } from "./cwt-lookup";

/**
 * Wake separation on final approach, in NAUTICAL MILES of in-trail spacing,
 * indexed [leader][follower]. Values follow the FAA JO 7110.65 arrival
 * separation table, with this codebase's four categories mapped onto the
 * order's five (medium is the order's "large", light its "small"). The 3 NM
 * floor is standard terminal radar separation, which governs whenever no
 * larger wake minimum applies.
 *
 * This replaces a matrix of TIME minima (2 to 3 minutes) that the earlier
 * revisions compared against ETA differences. That model was wrong on both
 * axes, and the 24-hour five-airport window measured the consequence: 78% of
 * same-stream arrival pairs read as critical violations, which cannot be true
 * of routine operations at major US fields.
 *
 * Wrong axis: time-based minima govern DEPARTURES; arrivals on final are
 * separated by distance. Wrong magnitude: at a 150 kt final-approach speed
 * the old 2 and 3 minute values demand 5.0 and 7.5 NM against the order's
 * actual 3 to 5 NM, so the detector required roughly 1.4 to 1.7 times the
 * legal spacing. Measured live at KDFW: two Envoy regionals 4.0 NM in trail,
 * legal under the 3 NM medium-behind-medium requirement, were reported
 * critical.
 *
 * Not modelled, and deliberately: RECAT-II/III pair-wise categories, which
 * several US fields including KDFW now run and which permit tighter spacing
 * than these legacy values. Using legacy minima makes this detector
 * conservative rather than permissive, which is the safer direction for an
 * advisory system to err.
 */
/**
 * Wake separation on approach, in in-trail nautical miles, or null where the
 * wake table imposes no requirement at all.
 *
 * The null entries are the correction. Every one of them previously held 3 NM,
 * which is not a wake minimum: it is the radar minimum standing in for one. FAA
 * Order JO 7110.65 paragraph 5-5-4 and TBL 5-5-2 leave those cells blank, and a
 * blank cell means the radar minimum governs, not that 3 NM of wake separation
 * is required. Conflating the two rules made the detector demand wake spacing
 * where doctrine demands none.
 *
 * Measured on a completed 24-hour window at KATL, KORD and KDFW: of 189 pairs
 * the vortex band admitted, 158 carried a "3 NM requirement" that was really
 * this conflation, and correcting it moves the share judged legally separated
 * from 21 of 189 to 81 of 189. See docs/wake-residual-open.md.
 *
 * The blanks are taken literally rather than filled in conservatively. Inventing
 * a requirement the table does not state is precisely the error being corrected,
 * so super-behind-super is null because TBL 5-5-2 leaves it blank, even though a
 * cautious guess would put a number there.
 */
/**
 * FAA Consolidated Wake Turbulence on-approach minima, NM, [leader][follower].
 * JO 7110.65 paragraph 5-5-4, TBL 5-5-2. The 126 series that introduced CWT is
 * cancelled; 7110.65 is the citable authority. Null where the table is blank,
 * meaning radar separation governs, exactly as in the legacy four-class table
 * this replaces.
 *
 * The legacy table classified the B757 as heavy (5 NM ahead of a medium); CWT
 * created category E for the B757 specifically because its wake does not behave
 * like a heavy's, and an E leader constrains only a category I follower, at
 * 4 NM. That 2 NM difference on a type operating at every major US field is the
 * sharpest single case this migration corrects.
 */
const CWT_ON_APPROACH: Record<CwtCategory, Record<CwtCategory, number | null>> = {
  A: { A: null, B: 5, C: 6, D: 6, E: 7, F: 7, G: 7, H: 8, I: 8 },
  B: { A: null, B: 3, C: 4, D: 4, E: 5, F: 5, G: 5, H: 5, I: 6 },
  C: { A: null, B: null, C: null, D: null, E: 3.5, F: 3.5, G: 3.5, H: 5, I: 6 },
  D: { A: null, B: 3, C: 4, D: 4, E: 5, F: 5, G: 5, H: 6, I: 6 },
  E: { A: null, B: null, C: null, D: null, E: null, F: null, G: null, H: null, I: 4 },
  F: { A: null, B: null, C: null, D: null, E: null, F: null, G: null, H: null, I: 4 },
  G: { A: null, B: null, C: null, D: null, E: null, F: null, G: null, H: null, I: null },
  H: { A: null, B: null, C: null, D: null, E: null, F: null, G: null, H: null, I: null },
  I: { A: null, B: null, C: null, D: null, E: null, F: null, G: null, H: null, I: null },
};

/**
 * The wake minimum for a pair, or null when radar separation governs: the cell
 * is blank, or either type has no CWT assignment. An unmapped type falls to the
 * radar floor deliberately. The legacy lookup defaulted unknown types to
 * "light", which made them light LEADERS attracting 3 to 4 NM requirements;
 * a default should constrain least, not most, and the sampling harness counts
 * unmapped types so the rate is visible rather than absorbed.
 */
/**
 * Exported so the suite can compare all 81 cells against TBL 5-5-2 as
 * published, rather than against a second copy of the same literal in the test
 * file, which would only prove the file agrees with itself.
 */
export const wakeMinimumNm = (lead: Flight, trail: Flight): number | null => {
  const leadCat = cwtFromType(lead.aircraft);
  const trailCat = cwtFromType(trail.aircraft);
  if (!leadCat || !trailCat) return null;
  return CWT_ON_APPROACH[leadCat][trailCat];
};

/**
 * Radar separation, which governs whenever the wake table is blank.
 *
 * 7110.65 5-5-4(j), reproduced in JO 7110.126B Appendix B and read against the
 * order on 2026-08-31, authorises 2.5 NM between aircraft established on the
 * final approach course within 10 NM of the landing runway, operating in FUSION
 * or single sensor slant range mode, remaining within 40 miles of the antenna,
 * and then requires four more things: wake separation still applied per
 * TBL 5-5-2, a documented average runway occupancy time of 50 seconds or less,
 * operational CTRDs used for quick glance reference, and turnoff points visible
 * from the control tower. So 2.5 NM is an assumption, not a certainty, and the
 * last two conditions are not merely unobservable from ADS-B: one is an
 * administrative record and the other a property of the tower building, so no
 * feed carries them.
 *
 * The first of those four keeps two rules apart. 2.5 NM never displaces a wake
 * minimum, because the order requires TBL 5-5-2 alongside it, so this floor
 * governs only where the wake table is blank. That is what the code does and it
 * is worth saying, since conflating the floor with the wake requirement is a
 * mistake this project has already made once and published.
 *
 * `bothOnShortFinal` below accepts `approach` as well as `final`, which is wider
 * than "established on the final approach course". The 10 NM range check bounds
 * it, and the error is permissive: a pair not yet established gets the lower
 * floor and so is judged less harshly. That direction is the one this file
 * chooses everywhere else, and it is recorded here rather than left to be
 * inferred from the predicate.
 *
 * It is the right assumption for an alerting layer even so. Using 3 NM reports a
 * violation across the whole 2.5 to 3.0 band, where doctrine may well permit the
 * spacing, and a false critical costs more than a missed marginal one. The band
 * is better described as indeterminate than as violation, and the harness counts
 * it separately so the choice stays visible in the measurement.
 */
// 3 NM is the terminal minimum within 40 miles of the antenna. 7110.65 5-5-4
// puts it at 5 miles at 40 or more, and at 5 when ISR shows in the data block
// under FUSION. Live ingest queries a 40 NM radius around the field reference
// point, so every contact is at or inside that boundary and a pair at the very
// edge of the query sits where doctrine changes. The pairs these detectors form
// are established on approach and far inside it, so nothing measured turns on
// this; the constant is conditional and is written down as such.
const RADAR_MIN_NM = 3;
const RADAR_MIN_FINAL_NM = 2.5;
const REDUCED_MIN_RANGE_NM = 10;

/** True when both aircraft are established on final inside the reduced-minimum range. */
const bothOnShortFinal = (a: Flight, b: Flight): boolean =>
  [a, b].every(
    (f) =>
      (f.phase === "final" || f.phase === "approach") &&
      Math.hypot(f.positionNm.x, f.positionNm.y) <= REDUCED_MIN_RANGE_NM,
  );

/**
 * The separation a pair must actually hold: the wake minimum when the table
 * states one, otherwise the radar minimum.
 */
const requiredSeparationNm = (lead: Flight, trail: Flight): number => {
  const wake = wakeMinimumNm(lead, trail);
  if (wake !== null) return wake;
  return bothOnShortFinal(lead, trail) ? RADAR_MIN_FINAL_NM : RADAR_MIN_NM;
};

/**
 * Heading tolerance for treating an arrival as established on final. Aircraft
 * intercepting the localiser are within roughly 30 degrees of runway heading;
 * a downwind leg is near 180 degrees off and a base leg near 90.
 */
const FINAL_ALIGNMENT_DEG = 30;

/** Wake separation binds a follower at or below the leader's altitude, within this band. */
const WAKE_VERTICAL_BAND_FT = 1000;

/**
 * Arrivals whose cross-track offsets differ by less than this are treated as
 * being on the same final approach path. Same-final aircraft track within
 * ~0.05 NM of one localizer; the closest US parallel centerlines are ~750 ft
 * (0.123 NM) apart. See the clustering note in detectRunwayConflicts.
 */
const LATERAL_CLUSTER_NM = 0.1;

const headingDelta = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

const crosswindKts = (windDirDeg: number, windKts: number, runwayHeadingDeg: number): number => {
  const angle = headingDelta(windDirDeg, runwayHeadingDeg);
  return Math.abs(windKts * Math.sin((angle * Math.PI) / 180));
};

/**
 * Flights holding a runway assignment, grouped by runway, excluding those that
 * have finished with it. Shared by the two runway-scoped detectors so that each
 * carries one doctrine rather than two.
 */
const groupByRunway = (state: SimState): Record<string, Flight[]> => {
  const grouped: Record<string, Flight[]> = {};
  for (const f of state.flights) {
    if (!f.assignedRunway) continue;
    if (f.phase === "landed" || f.phase === "departed" || f.phase === "at-gate") continue;
    grouped[f.assignedRunway] = grouped[f.assignedRunway] ?? [];
    grouped[f.assignedRunway].push(f);
  }
  return grouped;
};

// Doctrine: wake-turbulence separation minima between a leading and trailing
// arrival on the same runway. Previously inlined in detectRunwayConflicts, which
// made that function carry two doctrines and broke the one-detector-per-doctrine
// property the architecture claims.
/**
 * Resolves a runway designator to its runway and the heading of THAT END.
 *
 * `inferRunway` returns a single end label ("04L"), while the registry stores
 * paired strips ("04L/22R") carrying one heading for the pair. Every earlier
 * lookup of the form `runways.find((r) => r.id === f.assignedRunway)` therefore
 * failed on live data and silently degraded: the lateral-stream axis fell back
 * to heading 0 (clustering by raw x instead of true cross-track), and the
 * established-on-final gate rejected every aircraft because it could not find
 * a runway to compare against. Scenarios were unaffected, because their
 * designators match their runway ids exactly, which is why the corpus never
 * caught it.
 *
 * The reciprocal end matters: on "04L/22R" the 04L end is the stored heading
 * and the 22R end is that plus 180.
 */
const runwayHasEnd = (runway: Runway, designator: string | undefined): boolean => {
  if (!designator) return false;
  if (runway.id === designator) return true;
  return runway.id.split("/").includes(designator);
};

const resolveRunway = (
  state: SimState,
  designator: string | undefined,
): { runway: Runway; headingDeg: number; trueCourseDeg?: number } | undefined => {
  if (!designator) return undefined;
  for (const runway of state.runways) {
    if (!runwayHasEnd(runway, designator)) continue;
    const ends: string[] = runway.id.split("/");
    const reciprocal = ends.length > 1 && ends[1] === designator;
    return {
      runway,
      headingDeg: reciprocal ? (runway.headingDeg + 180) % 360 : runway.headingDeg,
      // Same reciprocal rule as the magnetic heading. Undefined where the
      // strip has no surveyed coordinates, which is every scenario runway.
      trueCourseDeg:
        runway.trueCourseDeg === undefined
          ? undefined
          : reciprocal
            ? (runway.trueCourseDeg + 180) % 360
            : runway.trueCourseDeg,
    };
  }
  return undefined;
};

/**
 * Cross-track coordinate of a flight relative to a runway heading: the
 * component of its position perpendicular to the approach course, in the
 * local x-east / y-south frame. Shared by the wake and runway-conflict
 * doctrines for lateral stream separation.
 */
const crossTrackNm = (f: Flight, headingDeg: number): number => {
  const rad = headingDeg * (Math.PI / 180);
  return f.positionNm.x * Math.cos(rad) + f.positionNm.y * Math.sin(rad);
};

/**
 * Splits flights into lateral streams: sorted by cross-track offset, split
 * wherever neighbours are more than LATERAL_CLUSTER_NM apart. Aircraft on the
 * same final sit within ~0.05 NM of one localizer; distinct US parallels are
 * at least ~750 ft (0.123 NM) apart.
 */
const lateralStreams = (flights: Flight[], headingDeg: number): Flight[][] => {
  const sorted = [...flights].sort((a, b) => crossTrackNm(a, headingDeg) - crossTrackNm(b, headingDeg));
  const streams: Flight[][] = [];
  for (const f of sorted) {
    const last = streams[streams.length - 1];
    // Measured against the stream's FIRST member, not its most recent one.
    // Comparing to the last admitted aircraft is single-linkage clustering and
    // it chains: ten aircraft each 0.09 NM further off the centreline than the
    // one before all joined a single stream spanning 0.81 NM, eight times this
    // tolerance, and were paired in trail. The closest US parallel centrelines
    // sit 0.12 NM apart, so a chain crosses several of them and invents the
    // in-trail relationship the alignment filter above exists to prevent.
    //
    // Not observed in the corpus, where every stream has zero cross-track
    // spread and this change is therefore inert; demonstrated synthetically.
    if (
      last &&
      Math.abs(crossTrackNm(f, headingDeg) - crossTrackNm(last[0], headingDeg)) <
        LATERAL_CLUSTER_NM
    ) {
      last.push(f);
    } else {
      streams.push([f]);
    }
  }
  return streams;
};

/**
 * Every same-stream consecutive arrival pair with its wake gap and
 * requirement. The single pairing walk behind the wake detector and the
 * margin instrument.
 *
 * Pairing within lateral streams rather than raw runway labels is the second
 * wake finding from the clean-window comparison: KJFK's two same-heading
 * runway pairs make the heading-only runway inference flap between
 * parallels, so label-based pairs form and break across polls and smoothing
 * cannot help a pair that did not exist last tick. Wake separation doctrine
 * binds a trailing aircraft to the leader on ITS approach path; a parallel
 * stream is not that path.
 */
/** `gap` and `required` are in-trail nautical miles; see CWT_ON_APPROACH. */
type WakePair = {
  lead: Flight;
  trail: Flight;
  gap: number;
  required: number;
  runwayId: string;
  /** trail minus lead, in feet. Positive means the follower is higher. */
  vertGapFt: number;
  /** False when the follower is outside the vortex band, so no requirement applies. */
  withinBand: boolean;
};
const wakeCandidatePairsInternal = (state: SimState): WakePair[] => {
  const pairs: WakePair[] = [];
  for (const [rwy, flights] of Object.entries(groupByRunway(state))) {
    // Wake separation governs aircraft ESTABLISHED ON FINAL, and phase alone
    // does not establish that: this model's "approach" is anything below
    // 6,000 ft within 20 NM, which includes downwind and base legs. An
    // aircraft on downwind is not yet on anyone's approach path, its
    // cross-track offset relative to the runway is meaningless, and pairing it
    // with a genuine final-approach arrival invents an in-trail relationship
    // that does not exist. Requiring alignment with the runway heading is what
    // "established" actually means.
    const resolved = resolveRunway(state, rwy);
    const alignedWithRunway = (f: Flight) => {
      const end = resolveRunway(state, f.assignedRunway);
      if (!end) return false;
      // True against true. This read `end.headingDeg`, which is the registry's
      // MAGNETIC value, while the aircraft's heading is a true ground track:
      // the same units error this file documents for the runway-identity
      // doctrine, in a different detector and never noticed because the gate
      // is wide enough to hide it. At KLAX the two differ by 14 degrees, so
      // nearly half of a 30-degree window went on the mismatch and an aircraft
      // established on final had 16 degrees of real tolerance rather than 30.
      // Scenario runways carry no true course, so they keep comparing magnetic
      // against magnetic through the fallback and none of the published
      // scenario measurements move; this changes live behaviour only.
      const course = end.trueCourseDeg ?? end.headingDeg;
      return headingDelta(f.headingDeg, course) <= FINAL_ALIGNMENT_DEG;
    };
    const arrivals = flights.filter(
      (f) =>
        f.type === "arrival" &&
        (f.phase === "approach" || f.phase === "final") &&
        alignedWithRunway(f),
    );
    const streams = resolved ? lateralStreams(arrivals, resolved.headingDeg) : [arrivals];
    for (const stream of streams) {
      // Sequence along the approach: nearest the field leads.
      //
      // By distance, not by estimated time. The requirement below is an
      // in-trail DISTANCE and the gap is measured between positions, so the
      // leader is the aircraft ahead in space; sequencing by time mixes two
      // orderings and they disagree whenever the aircraft differ in speed. An
      // aircraft 8 NM out at 180 kt has a smaller ETA than one 6 NM out at
      // 110 kt, which made the farther of the two the leader and applied its
      // wake category to a pair it was actually following. Both speeds are
      // ordinary on final.
      //
      // Every candidate pair in the scenario corpus orders identically under
      // either rule, which was checked before the change rather than after, so
      // no published scenario measurement moves. Pairing is already restricted
      // to aircraft established on final, where distance to the field is
      // monotonic along the approach and is the same quantity the gap uses.
      const distanceToField = (f: Flight) =>
        Math.hypot(f.positionNm.x, f.positionNm.y);
      const byEta = [...stream].sort(
        (a, b) => distanceToField(a) - distanceToField(b),
      );
      for (let i = 1; i < byEta.length; i++) {
        const lead = byEta[i - 1];
        const trail = byEta[i];
        // A follower more than 1,000 ft ABOVE the leader is out of the vortex
        // band and carries no wake requirement. The pair is TAGGED rather than
        // dropped here so the band's selection effect can be measured: see
        // wakeCandidatePairs below.
        const vertGapFt = trail.altitudeFt - lead.altitudeFt;
        pairs.push({
          lead,
          trail,
          gap: Math.hypot(
            lead.positionNm.x - trail.positionNm.x,
            lead.positionNm.y - trail.positionNm.y,
          ),
          required: requiredSeparationNm(lead, trail),
          runwayId: rwy,
          vertGapFt,
          withinBand: vertGapFt <= WAKE_VERTICAL_BAND_FT,
        });
      }
    }
  }
  return pairs;
};

/**
 * Every same-stream, ETA-adjacent arrival pair, including those the vortex
 * band excludes. Exported for the sampling harness so the band's selection
 * effect is measured from the production enumeration rather than a
 * reimplementation of it. Section 6.7's withdrawn figures came from a harness
 * that reimplemented two detectors while claiming to import them; that must
 * not happen twice.
 */
export const wakeCandidatePairs = (state: SimState): WakePair[] =>
  wakeCandidatePairsInternal(state);

/**
 * The pairs a wake requirement actually applies to. Identical to the set the
 * detector used before the band became a tag rather than a `continue`.
 */
const wakeArrivalPairs = (state: SimState): WakePair[] =>
  wakeCandidatePairsInternal(state).filter((p) => p.withinBand);

/**
 * In visual conditions the trailing pilot may have accepted visual separation,
 * and under JO 7110.65 7-2-1 that voids the radar minima for the pair; visual
 * approaches dominate US operations in VMC. No public feed carries the
 * acceptance, so the regime is unobservable and the alert cannot know whether
 * the minimum it is enforcing applies. Measured on two 24-hour windows, every
 * admitted wake pair formed under VFR, and across every surviving per-pair
 * dump 50 of the 59 violations are against a radar floor of 2.5 or 3 NM rather
 * than a wake minimum: the signature of legal visual-approach spacing, not of
 * non-compliance. That count is 50 of 59 over 286 pairs, recomputed 2026-09-02
 * and re-derived by the claim checker on any checkout holding the dumps. Any
 * figure quoted from a window that is no longer on disk reproduces from
 * nothing, so this one is stated against the pooled set the checker reads. The deployed analogue behaves the same way: ATPA is
 * suppressed when visual separation is applied.
 *
 * So under VMC, a violation of the radar floor (a pair the wake table itself
 * does not constrain) caps at warning and says why. A violation of a stated
 * wake minimum keeps its severity in every condition: visual separation
 * transfers wake responsibility to the pilot, but a pair inside the wake
 * table's own minimum is worth the operator's attention regardless of who
 * holds responsibility.
 */
const visualSeparationMayApply = (state: SimState): boolean =>
  state.weather.condition === "VFR" || state.weather.condition === "MVFR";

const detectWakeSpacing = (state: SimState): Alert[] => {
  const alerts: Alert[] = [];
  const vmc = visualSeparationMayApply(state);
  for (const { lead, trail, gap, required, runwayId: rwy } of wakeArrivalPairs(state)) {
    {
      if (gap < required) {
        const floorGoverned = wakeMinimumNm(lead, trail) === null;
        const demoted = vmc && floorGoverned;
        // One mile inside the requirement is the critical line: at 150 kt
        // that is 24 seconds of margin, and the follower is committed.
        const baseSeverity: Alert["severity"] = gap < required - 1 ? "critical" : "warning";
        alerts.push({
          id: `wake-${rwy}-${lead.id}-${trail.id}`,
          severity: demoted ? "warning" : baseSeverity,
          category: "wake-spacing",
          title: `${trail.callsign} too close behind ${lead.callsign} on ${rwy}`,
          detail: `In-trail ${gap.toFixed(1)} NM, ${required} NM required for ${lead.aircraft} (CWT ${cwtFromType(lead.aircraft) ?? "?"}) → ${trail.aircraft} (CWT ${cwtFromType(trail.aircraft) ?? "?"})`,
          flightIds: [lead.id, trail.id],
          reason:
            wakeMinimumNm(lead, trail) !== null
              ? `Wake turbulence separation on approach: a CWT category ${cwtFromType(lead.aircraft)} leader requires ${required} NM ahead of a category ${cwtFromType(trail.aircraft)} (FAA JO 7110.65 5-5-4, TBL 5-5-2).`
              : `No wake minimum applies to this pair; radar separation of ${required} NM governs (FAA JO 7110.65 5-5-4).${
                  vmc
                    ? " Conditions are visual: if the trailing pilot has accepted visual separation, this minimum does not apply to the pair (JO 7110.65 7-2-1), which is unobservable from surveillance."
                    : ""
                }`,
          suggestedAction: `Vector ${trail.callsign} for 360° or reduce to 180 kts; consider re-sequencing to 28R if available.`,
          createdAtTick: state.tick,
          runwayId: rwy,
        });
      }
    }
  }
  return alerts;
};

/**
 * Wake margins for every same-stream consecutive arrival pair: in-trail
 * distance minus required separation, in nautical miles. Negative means the
 * wake doctrine is violated; the detector's critical boundary sits at −1 NM.
 *
 * Exported for the sampling harness, which logs the distribution so the
 * critical boundary can be designed from measured margins rather than
 * guessed: the remaining 95% of live critical alerts are wake-spacing, and
 * the open question is how much of that mass sits within measurement noise
 * of the boundary. Same pairing walk as detectWakeSpacing — one source of
 * truth, the harness reimplements nothing.
 */
export const wakeGapMargins = (state: SimState): number[] =>
  wakeArrivalPairs(state)
    .filter((p) => p.required > 0)
    .map((p) => p.gap - p.required);

// Doctrine: a runway hosts exactly one operating aircraft at a time.
const detectRunwayConflicts = (state: SimState): Alert[] => {
  const alerts: Alert[] = [];
  for (const [rwy, flights] of Object.entries(groupByRunway(state))) {
    const arrivalsActive = flights.filter((f) => f.type === "arrival" && f.phase === "final");
    const departuresActive = flights.filter(
      (f) => f.type === "departure" && (f.phase === "queued" || f.phase === "taxi-out"),
    );
    if (arrivalsActive.length > 0 && departuresActive.length > 0) {
      alerts.push({
        id: `rwy-mix-${rwy}`,
        severity: "warning",
        category: "runway-conflict",
        title: `${rwy} has simultaneous arrival + departure intent`,
        detail: `${arrivalsActive[0].callsign} on final, ${departuresActive[0].callsign} on runway`,
        flightIds: [arrivalsActive[0].id, departuresActive[0].id],
        reason: `Runway ${rwy} cannot host overlapping arrival and departure clearances.`,
        suggestedAction: `Hold ${departuresActive[0].callsign}; route arrival to alternate runway if available.`,
        createdAtTick: state.tick,
        runwayId: rwy,
      });
    }
    if (departuresActive.length >= 2) {
      alerts.push({
        id: `rwy-multi-dep-${rwy}`,
        severity: "critical",
        category: "runway-conflict",
        title: `${rwy} has multiple aircraft on runway`,
        detail: `${departuresActive.map((f) => f.callsign).join(", ")} all on ${rwy}`,
        flightIds: departuresActive.map((f) => f.id),
        reason: `Two or more aircraft on the same runway = potential collision. Runways may host exactly one operating aircraft at a time.`,
        suggestedAction: `Halt all takeoff clearances. Confirm positions visually or by ground radar before resuming.`,
        createdAtTick: state.tick,
        runwayId: rwy,
      });
    }
    // REMOVED: a critical for "multiple arrivals on final to the same
    // runway". The doctrine as written ("unsafe under any spacing rule") is
    // false: a continuous in-trail arrival stream to one runway is the normal
    // state of every busy field, and the 24-hour window measured the
    // consequence at KDFW, where five parallel approach streams produced 156
    // of the window's 182 runway-conflict criticals on aircraft correctly
    // spaced 3 to 4 NM apart.
    //
    // What is genuinely unsafe is insufficient IN-TRAIL SEPARATION on final,
    // and that is the wake detector's concern: its matrix carries a 3 NM
    // standard-radar-separation floor for every category pair, so a stream
    // closer than the floor already raises there. Restating it here produced
    // a second alert on the same condition at a higher tier, which is how a
    // display teaches a controller to stop reading it.
    //
    // The lateral clustering built for this branch is retained: it is what
    // wake pairing now uses to tell one approach path from a parallel.
  }
  return alerts;
};

const detectGateConflicts = (state: SimState): Alert[] => {
  const alerts: Alert[] = [];
  const incomingByGate: Record<string, Flight[]> = {};
  for (const f of state.flights) {
    if (f.type !== "arrival" || !f.assignedGate) continue;
    if (f.phase === "landed" || f.phase === "at-gate") continue;
    incomingByGate[f.assignedGate] = incomingByGate[f.assignedGate] ?? [];
    incomingByGate[f.assignedGate].push(f);
  }
  for (const gate of state.gates) {
    const incoming = incomingByGate[gate.id] ?? [];
    if (gate.occupiedBy && incoming.length > 0) {
      const earliest = incoming.sort((a, b) => a.etaMin - b.etaMin)[0];
      if (earliest.etaMin < 15) {
        alerts.push({
          id: `gate-${gate.id}-${earliest.id}`,
          severity: earliest.etaMin < 5 ? "critical" : "warning",
          category: "gate-conflict",
          title: `Gate ${gate.id} occupied, ${earliest.callsign} inbound in ${earliest.etaMin.toFixed(0)} min`,
          detail: `Currently occupied by ${gate.occupiedBy}; no pushback scheduled`,
          flightIds: [earliest.id],
          reason: `Gate ${gate.id} (${gate.terminal}) is blocked. ${earliest.callsign} cannot park on arrival.`,
          // Says "another gate", not "a compatible gate". Gate.maxWake is
          // declared on the type and populated for every stand at every
          // airport, and no detector reads it: this alert offered a
          // wake-rated reassignment while the system has no notion of stand
          // compatibility to offer it from. Recommending a check the system
          // does not perform is the failure this project keeps finding in
          // its own prose, and an alert that carries its reasoning is the
          // worst place for it.
          suggestedAction: `Push ${gate.occupiedBy} to remote stand or reassign ${earliest.callsign} to another gate. Stand wake rating is not modelled.`,
          createdAtTick: state.tick,
        });
      }
    }
    if (incoming.length > 1) {
      const ids = incoming.map((f) => f.callsign).join(", ");
      alerts.push({
        id: `gate-double-${gate.id}`,
        severity: "advisory",
        category: "gate-conflict",
        title: `Gate ${gate.id} double-booked`,
        detail: `Multiple inbound assignments: ${ids}`,
        flightIds: incoming.map((f) => f.id),
        reason: `Only one of these arrivals can use ${gate.id}. Cascading delay risk.`,
        suggestedAction: `Reassign later arrival(s) now while alternate gates are free.`,
        createdAtTick: state.tick,
      });
    }
  }
  return alerts;
};

/**
 * The reserve this detector applies is one number where the rule it cites has
 * three, read against 14 CFR 91.167 on 2026-08-31.
 *
 * The rule applies IN IFR CONDITIONS. In visual conditions 91.151 governs
 * instead, at 30 minutes by day and 45 by night for airplanes, and this
 * detector does not condition on flight rules. Paragraph (a)(3) gives 45
 * minutes at normal cruising speed for aircraft and 30 FOR HELICOPTERS, and
 * this applies 45 to everything. And the alternate fuel the reason string
 * mentions is not always required: paragraph (b) waives it where the
 * destination has a standard instrument approach and the forecast holds a
 * 2,000 ft ceiling and 3 statute miles for an hour either side of arrival.
 *
 * None of that currently produces a wrong alert. The corpus carries one
 * helicopter and it is a departure, which this skips. It is written down because
 * the reason string is shown to a controller, and a tool that cites a regulation
 * should cite the one that applies to the aircraft in front of them.
 *
 * On live data this doctrine fires, and the reason it looks as though it cannot
 * is worth following. Ingest synthesises fuel from
 * the raw ETA of the same tick as max(30, eta + 60), which satisfies the
 * eta + 45 threshold below for every value of eta, so the reasoning was right
 * about ingest and stopped there. smoothEtas then overwrites etaMin against the
 * previous tick, before the detectors see the picture, and leaves fuelMin alone;
 * the pair stops describing the same aircraft. A warning fires once the blended
 * ETA exceeds the value fuel was synthesised from by 15 minutes.
 *
 * Criticals are unreachable, and by the ETA cap rather than by this
 * construction. Both ETAs are clamped to 60 minutes, so a blended value cannot
 * exceed the raw one by more than (1 - 0.4) * 60 = 36: past the 15-minute
 * warning threshold, short of the 45-minute critical one. Before that cap
 * existed, 19 criticals were measured in one KLAX window. Raise the cap to 120
 * and criticals return. Pinned by a test that builds the live synthesis, smooths
 * it and asserts the severity.
 */
const detectFuelHold = (state: SimState): Alert[] => {
  const alerts: Alert[] = [];
  for (const f of state.flights) {
    if (f.type !== "arrival") continue;
    if (f.phase === "landed" || f.phase === "at-gate") continue;
    const reserveBuffer = f.etaMin + 45;
    if (f.fuelMin < reserveBuffer) {
      alerts.push({
        id: `fuel-${f.id}`,
        severity: f.fuelMin < f.etaMin + 15 ? "critical" : "warning",
        category: "fuel-hold",
        title: `${f.callsign} low on fuel`,
        detail: `${f.fuelMin.toFixed(0)} min remaining, ETA ${f.etaMin.toFixed(0)} min + 45 min reserve required`,
        flightIds: [f.id],
        reason: `FAR 91.167 requires ≥45 min reserve at destination plus alternate fuel.`,
        suggestedAction: `Prioritize ${f.callsign} for direct approach; pre-arrange alternate if reserve breached.`,
        createdAtTick: state.tick,
      });
    }
  }
  return alerts;
};

const detectCrosswind = (state: SimState): Alert[] => {
  const alerts: Alert[] = [];
  const CROSSWIND_LIMIT_KTS = 25;
  for (const r of state.runways) {
    if (r.mode === "closed") continue;
    // METAR reports wind direction referenced to TRUE north; the registry's
    // headingDeg is magnetic. Passing the two into one angle is the third
    // instance of the units error this file already documents twice, and the
    // crosswind component is a sine of that angle, so at the 14 degrees of
    // variation KLAX carries it can be wrong by up to a quarter of the wind
    // speed in either direction: a wind lying along the magnetic heading
    // computes as no crosswind at all while the true geometry has some, and a
    // wind 14 degrees off computes nearly double. Scenario runways carry no
    // true course and fall back to the magnetic value, so they are unchanged.
    const runwayCourse = r.trueCourseDeg ?? r.headingDeg;
    const cw = crosswindKts(
      state.weather.windDirDeg,
      Math.max(state.weather.windKts, state.weather.gustsKts),
      runwayCourse,
    );
    if (cw > CROSSWIND_LIMIT_KTS) {
      const using = state.flights.filter((f) => runwayHasEnd(r, f.assignedRunway));
      alerts.push({
        id: `cw-${r.id}`,
        severity: cw > CROSSWIND_LIMIT_KTS + 5 ? "critical" : "warning",
        category: "crosswind",
        title: `Crosswind ${cw.toFixed(0)} kts on ${r.id} exceeds limit`,
        detail: `Wind ${state.weather.windDirDeg}°/${state.weather.windKts}G${state.weather.gustsKts} kts; ${r.id} heading ${r.headingDeg}°`,
        flightIds: using.map((f) => f.id),
        reason: `Demonstrated crosswind component limit ~${CROSSWIND_LIMIT_KTS} kts for narrow-body and most heavy types.`,
        suggestedAction: `Switch operations to a runway better aligned with the wind, or hold arrivals.`,
        createdAtTick: state.tick,
      });
    }
  }
  return alerts;
};

/**
 * Doctrine: an aircraft on its takeoff roll must be on the runway it was
 * cleared for. Compares the rolling aircraft's heading against its assigned
 * runway's heading; a mismatch beyond 20° is a lineup error, and if the actual
 * heading matches a different runway the alert names it.
 *
 * Motivating case: Comair 5191, Lexington 2006 (NTSB AAR-07/05). The crew was
 * cleared for runway 22 (7,003 ft) and began the roll on runway 26 (3,501 ft),
 * a 37° heading difference present and checkable from the moment thrust was
 * applied. 49 of the 50 aboard died.
 *
 * The critical tier is warranted here despite the standing-condition rule
 * applied to weather and surface state: a wrong-runway roll is not a condition
 * to monitor but an accident sequence already in motion, and the window to
 * reject the takeoff shrinks by the second.
 *
 * Live-mode note: this detector is scenario-only, but not for the reason stated
 * here until 2026-09-01, which was that live ingest never assigns runways to
 * departures. It has since 2026-08-26: airborne departures within 12 NM are
 * attributed by running the arrival centreline geometry backwards. The ones that
 * are not attributed are the ones at altitude zero, which live ingest labels
 * queued, and those are exactly the phases this detector reads. So the data does
 * exist, for aircraft this doctrine does not look at, and anyone extending it to
 * a rolling departure would find runways already there. What is still missing is
 * the clearance: knowing which runway an aircraft was told to use, as against
 * which one it is lined up on.
 */
const detectRunwayIdentity = (state: SimState): Alert[] => {
  const alerts: Alert[] = [];
  const ROLL_KTS = 40; // below this, taxi manoeuvring makes heading meaningless
  // The one angular gate in this file that carried no rationale. It is not
  // doctrinal; no order states a tolerance for "lined up on the wrong runway",
  // because a controller reads that from the picture rather than from an angle.
  // 20 degrees is tighter than the 30 used for final alignment and for course
  // attribution, and it can be, because a departure on its roll is aligned with
  // a strip by construction rather than intercepting one.
  //
  // What it cannot do is worth stating beside it. Parallel strips share a
  // heading, so no tolerance discriminates them: Dallas Fort Worth carries five
  // parallels on 184 and this gate sees one runway there, not five. Identifiers
  // ten degrees apart at the same field, 08 against 09 at Atlanta, sit inside
  // the tolerance too. The detector is guarded against that by construction
  // rather than by the number, since it fires only when an aircraft is OUTSIDE
  // tolerance of its assigned runway and inside it for a different one, and that ordering was described here as what makes 20 safe rather than the
  // value itself. It is not what the code does. The push below is
  // unconditional: the search for a runway the aircraft IS aligned with only
  // decides the wording of the alert, so an aircraft 25 degrees off its
  // assigned runway and matching nothing else still raises a critical, which
  // was measured on 2026-09-01. The corpus does not show it, because its one
  // runway-identity alert is Comair 5191 and that aircraft was aligned with
  // runway 26. Requiring the second condition before alerting would cost
  // nothing measured and would remove a critical-tier false positive path, but
  // it is a change to doctrine rather than a correction, so it is recorded
  // rather than made.
  const ALIGN_TOLERANCE_DEG = 20;
  for (const f of state.flights) {
    if (f.type !== "departure") continue;
    if (f.phase !== "queued" && f.phase !== "taxi-out") continue;
    if (!f.assignedRunway || f.speedKts < ROLL_KTS) continue;
    const assignedEnd = resolveRunway(state, f.assignedRunway);
    if (!assignedEnd) continue;
    const assigned = assignedEnd.runway;
    // An aircraft's heading is a TRUE track. Compare it against the strip's
    // coordinate-derived true course where one exists, and fall back to the
    // magnetic heading only where it does not, which keeps every scenario
    // comparing magnetic against magnetic as before. Comparing a true track
    // against a magnetic heading inside a 20-degree gate is what reported an
    // aircraft correctly lined up on Boston's 04L as rolling on the wrong
    // runway, at the severity a controller acts on immediately.
    // A strip carries one course, its low end's, so a runway in use the other
    // way round sits 180 degrees from the value stored on it. The assigned
    // side already accounts for that, because the end is resolved before the
    // course is read; this search did not, so an aircraft rolling on 28R at
    // 298 degrees matched nothing at a field whose stored course for that
    // strip is 118. The alert still fired, and named no runway: "heading 298
    // does not match 01L/19R" rather than "rolling on 10L/28R". Half of every
    // field's configurations are the reciprocal ones, so this was the usual
    // case rather than the exception. Both directions are compared now, which
    // identifies the strip; the strip is what the message names, so nothing
    // is lost by not distinguishing its two ends here.
    const courseOf = (r: Runway) => r.trueCourseDeg ?? r.headingDeg;
    const alignedWithEitherEnd = (r: Runway, headingDeg: number) => {
      const course = courseOf(r);
      return (
        Math.min(
          headingDelta(headingDeg, course),
          headingDelta(headingDeg, (course + 180) % 360),
        ) <= ALIGN_TOLERANCE_DEG
      );
    };
    const assignedCourse = assignedEnd.trueCourseDeg ?? assignedEnd.headingDeg;
    const offAssigned = headingDelta(f.headingDeg, assignedCourse);
    if (offAssigned <= ALIGN_TOLERANCE_DEG) continue;
    const actual = state.runways.find(
      (r) => r.id !== assigned.id && alignedWithEitherEnd(r, f.headingDeg),
    );
    alerts.push({
      id: `rwy-id-${f.id}`,
      severity: "critical",
      category: "runway-identity",
      title: actual
        ? `${f.callsign} rolling on ${actual.id}, cleared for ${assigned.id}`
        : `${f.callsign} heading ${Math.round(f.headingDeg)}° does not match ${assigned.id}`,
      detail: actual
        ? `Heading ${Math.round(f.headingDeg)}° matches ${actual.id} (${actual.lengthFt.toLocaleString()} ft); clearance was ${assigned.id} (${assigned.lengthFt.toLocaleString()} ft)`
        : `Assigned ${assigned.id} course ${Math.round(assignedCourse)}°, aircraft heading ${Math.round(f.headingDeg)}° at ${Math.round(f.speedKts)} kts`,
      flightIds: [f.id],
      reason: `A takeoff roll on a runway other than the cleared one invalidates every assumption behind the clearance: length, obstacle clearance, and traffic separation.`,
      suggestedAction: `Cancel takeoff clearance immediately; instruct ${f.callsign} to reject if speed permits.`,
      createdAtTick: state.tick,
      runwayId: actual?.id ?? assigned.id,
    });
  }
  return alerts;
};

/**
 * Doctrine: visibility and ceiling below approach minima change the separation
 * standard in force and remove the pilots' ability to maintain visual
 * separation, so the condition itself is reportable.
 *
 * Naming caveat, kept because the category name is load-bearing elsewhere:
 * `SimState` carries one weather observation and no history, so this detector
 * cannot see a *shift*. It reports adverse conditions and an unstable wind. A
 * true trend test needs a weather series the state does not hold, and is listed
 * as open work.
 *
 * Severity deliberately tops out at `warning`. Weather is a standing condition
 * rather than a conflict between two aircraft, and the alert-fatigue argument
 * says a condition that persists for hours must not sit in the critical tier.
 */
const detectWeatherShift = (state: SimState): Alert[] => {
  const alerts: Alert[] = [];
  const wx = state.weather;
  const active = state.flights.filter(
    (f) => f.phase !== "at-gate" && f.phase !== "landed" && f.phase !== "departed",
  );

  // CAT I minima are roughly 0.5 NM visibility and a 200 ft ceiling. Below
  // either, operations depend on positive controller separation.
  const belowCatI = wx.visibilityNm < 0.5 || wx.ceilingFt < 200;
  const lifr = wx.condition === "LIFR" || wx.visibilityNm < 1 || wx.ceilingFt < 500;
  const ifr = wx.condition === "IFR" || wx.visibilityNm < 3 || wx.ceilingFt < 1000;

  if (ifr || lifr || belowCatI) {
    alerts.push({
      id: "wx-lowvis",
      severity: belowCatI || lifr ? "warning" : "advisory",
      category: "weather-shift",
      title: belowCatI
        ? `Visibility ${wx.visibilityNm.toFixed(1)} NM below CAT I minima`
        : `${wx.condition} conditions in effect`,
      detail: `Visibility ${wx.visibilityNm.toFixed(1)} NM, ceiling ${wx.ceilingFt} ft, ${wx.condition}${wx.precipitation === "none" ? "" : `, ${wx.precipitation}`}`,
      flightIds: active.map((f) => f.id),
      reason: belowCatI
        ? `Below CAT I minima (0.5 NM / 200 ft) pilots cannot acquire the runway or preceding traffic visually, so every separation assurance rests on the controller.`
        : `Instrument conditions remove visual separation as an option and increase required spacing.`,
      suggestedAction: belowCatI
        ? `Apply low-visibility procedures: one aircraft on the runway at a time, positive position confirmation before every clearance, increased arrival spacing.`
        : `Confirm instrument approach in use and increase arrival spacing.`,
      createdAtTick: state.tick,
    });
  }

  // An unstable wind is the one genuinely time-varying signal available without
  // history: a wide gust spread means the crosswind component is not steady.
  const gustSpread = wx.gustsKts - wx.windKts;
  if (gustSpread >= 15) {
    alerts.push({
      id: "wx-gusts",
      severity: "advisory",
      category: "weather-shift",
      title: `Gust spread ${gustSpread.toFixed(0)} kts indicates unstable wind`,
      detail: `Sustained ${wx.windKts} kts, gusting ${wx.gustsKts} kts from ${wx.windDirDeg}°`,
      flightIds: active.map((f) => f.id),
      reason: `A gust spread of 15 kts or more means the crosswind component varies faster than a runway-configuration decision can track.`,
      suggestedAction: `Re-evaluate runway configuration on the next observation; brief arrivals on gust-additive approach speeds.`,
      createdAtTick: state.tick,
    });
  }

  if (wx.precipitation === "thunderstorm") {
    alerts.push({
      id: "wx-tstm",
      severity: "warning",
      category: "weather-shift",
      title: `Thunderstorm reported at the field`,
      detail: `Condition ${wx.condition}, wind ${wx.windDirDeg}°/${wx.windKts}G${wx.gustsKts} kts`,
      flightIds: active.map((f) => f.id),
      reason: `Convective activity over the field brings windshear and microburst risk on both approach and departure paths.`,
      suggestedAction: `Consider a ground stop for departures; brief arrivals on windshear escape procedures.`,
      createdAtTick: state.tick,
    });
  }

  return alerts;
};

// Doctrine: a contaminated runway surface (wet, snow, ice) degrades braking
// action and extends landing roll, so the condition is reportable while the
// runway hosts traffic. Added as the Section 6.9 doctrinal-change drill: this
// detector and its monolith counterpart implement the same rule, and the diff
// between the two changes is the drill's measurement.
const detectRunwaySurface = (state: SimState): Alert[] => {
  const alerts: Alert[] = [];
  // Keyed over the surface union rather than over string, so adding a state
  // to the type fails the typecheck here instead of silently skipping that
  // runway. `dry` is deliberately undefined: it raises nothing, and saying so
  // explicitly is what makes the omission a decision rather than a gap. Three
  // separate findings today came from one table quietly falling out of step
  // with another.
  //
  // Only `dry` and `wet` occur anywhere in the registry or the corpus, so the
  // snow and ice branches are reachable by construction and unexercised in
  // fact.
  const SEVERITY: Record<
    Runway["surfaceFriction"],
    "advisory" | "warning" | undefined
  > = {
    dry: undefined,
    wet: "advisory",
    snow: "warning",
    ice: "warning",
  };
  for (const r of state.runways) {
    if (r.mode === "closed") continue;
    const severity = SEVERITY[r.surfaceFriction];
    if (!severity) continue;
    const using = state.flights.filter(
      (f) =>
        runwayHasEnd(r, f.assignedRunway) &&
        f.phase !== "landed" &&
        f.phase !== "at-gate" &&
        f.phase !== "departed",
    );
    if (using.length === 0) continue;
    alerts.push({
      id: `surface-${r.id}`,
      severity,
      category: "runway-surface",
      title: `${r.id} surface ${r.surfaceFriction} with traffic assigned`,
      detail: `${using.length} aircraft assigned to ${r.id}; braking action degraded`,
      flightIds: using.map((f) => f.id),
      reason: `A ${r.surfaceFriction} surface extends landing roll and degrades braking action; arrivals must be briefed and spacing widened.`,
      suggestedAction:
        severity === "warning"
          ? `Request a braking-action report from the next arrival; consider switching operations to a treated runway.`
          : `Brief arrivals on the ${r.surfaceFriction} surface; expect longer occupancy per landing.`,
      createdAtTick: state.tick,
      runwayId: r.id,
    });
  }
  return alerts;
};

/**
 * Doctrine: the three emergency transponder codes demand immediate controller
 * attention. 7500 (unlawful interference) is critical; 7600 (radio failure)
 * and 7700 (general emergency) are warnings — the crew is handling those, the
 * controller's job is priority and space.
 *
 * The radar surface has rendered these codes since the first version; nothing
 * in the alert layer covered them, so an emergency showed on the scope but
 * never entered the alert ledger, the suppression logic, or the lifecycle.
 *
 * Scope honesty, recorded because the 9/11 scenario turns on it: this detector
 * sees a code the crew SET. It cannot see a transponder turned OFF — in live
 * mode the aircraft simply vanishes from ADS-B, which is the modern form of
 * the blindness the 2001 system had. Track-loss detection needs squawk
 * history and primary-radar correlation the state does not hold.
 */
const detectSquawkEmergency = (state: SimState): Alert[] => {
  const alerts: Alert[] = [];
  const MEANING: Record<string, { severity: "critical" | "warning"; label: string; action: string }> = {
    "7500": {
      severity: "critical",
      label: "unlawful interference",
      action: "Do not acknowledge on frequency. Notify supervisor and follow hijack protocol; keep other traffic clear without alerting the aircraft.",
    },
    "7600": {
      severity: "warning",
      label: "radio failure",
      action: "Expect the aircraft to follow lost-communications procedure; protect its expected route and altitude.",
    },
    "7700": {
      severity: "warning",
      label: "emergency",
      action: "Give the aircraft priority handling; clear airspace ahead and ask intentions when able.",
    },
  };
  for (const f of state.flights) {
    const m = MEANING[f.squawk];
    if (!m) continue;
    if (f.phase === "at-gate" || f.phase === "landed") continue;
    alerts.push({
      id: `squawk-${f.id}`,
      severity: m.severity,
      category: "squawk-emergency",
      title: `${f.callsign} squawking ${f.squawk} — ${m.label}`,
      detail: `${f.aircraft} ${Math.round(f.altitudeFt / 100)
        .toString()
        .padStart(3, "0")} ${Math.round(f.speedKts)} kts, phase ${f.phase}`,
      flightIds: [f.id],
      reason: `Transponder code ${f.squawk} is the international ${m.label} signal and overrides all routine handling.`,
      suggestedAction: m.action,
      createdAtTick: state.tick,
    });
  }
  return alerts;
};

const detectCascadingDelay = (state: SimState): Alert[] => {
  const alerts: Alert[] = [];
  const arrivalsSoon = state.flights.filter(
    (f) => f.type === "arrival" && f.etaMin < 30 && f.phase !== "landed" && f.phase !== "at-gate",
  );
  const buckets: Record<string, number> = {};
  for (const f of arrivalsSoon) {
    if (!f.assignedRunway) continue;
    const bucket = `${f.assignedRunway}-${Math.floor(f.etaMin / 5)}`;
    buckets[bucket] = (buckets[bucket] ?? 0) + 1;
  }
  for (const [bucket, count] of Object.entries(buckets)) {
    if (count >= 3) {
      const [rwy] = bucket.split("-");
      alerts.push({
        id: `cascade-${bucket}`,
        severity: "advisory",
        category: "cascading-delay",
        title: `${count} arrivals stacking on ${rwy} in same 5-min window`,
        detail: `Runway throughput ~30/hour. Sustained inbound rate exceeds capacity.`,
        flightIds: arrivalsSoon
          .filter((f) => f.assignedRunway === rwy)
          .map((f) => f.id),
        reason: `Compressed sequencing creates cascading downstream delays at gate, taxi, and connections.`,
        suggestedAction: `Speed-control inbound stream now; offload to 28R or hold on STAR.`,
        createdAtTick: state.tick,
        runwayId: rwy,
      });
    }
  }
  return alerts;
};

/** Tau-test constants for the proximity critical tier. */
const TAU_CRITICAL_S = 45;
const DMOD_NM = 0.5;
const VERTICAL_CRITICAL_FT = 200;

const velocityNmPerMin = (f: Flight) => {
  const rad = f.headingDeg * (Math.PI / 180);
  const nmPerMin = f.speedKts / 60;
  // Same convention as projectFlight: x east, y south-positive screen frame.
  return { vx: Math.sin(rad) * nmPerMin, vy: -Math.cos(rad) * nmPerMin };
};

/**
 * Converging-pair test: tau (minutes to closest point of approach) and the
 * miss distance at that point, from relative position and velocity.
 */
const isConvergingCritical = (a: Flight, b: Flight, vertFt: number): boolean => {
  if (vertFt >= VERTICAL_CRITICAL_FT) return false;
  const rx = b.positionNm.x - a.positionNm.x;
  const ry = b.positionNm.y - a.positionNm.y;
  const va = velocityNmPerMin(a);
  const vb = velocityNmPerMin(b);
  const vxRel = vb.vx - va.vx;
  const vyRel = vb.vy - va.vy;
  const closingSpeedSq = vxRel * vxRel + vyRel * vyRel;
  // No convergence, no critical — matching TCAS, which does not issue a
  // resolution advisory without closure. A pair holding a stable offset is a
  // formation or a parallel approach whatever its spacing, and a diverging
  // pair has already had its moment; both keep the warning tier from the
  // envelope test above.
  if (closingSpeedSq < 1e-9) return false;
  const tauMin = -(rx * vxRel + ry * vyRel) / closingSpeedSq;
  if (tauMin <= 0) return false; // diverging
  if (tauMin > TAU_CRITICAL_S / 60) return false; // closure too slow to be TCAS-grade
  const cpaX = rx + vxRel * tauMin;
  const cpaY = ry + vyRel * tauMin;
  return Math.hypot(cpaX, cpaY) < DMOD_NM;
};

/**
 * Every pair inside the proximity warning envelope, with the facts needed to
 * ask whether it is a conflict or two aircraft on separate parallel approaches.
 *
 * The warning tier is a raw distance box over all active aircraft. The critical
 * tier got a convergence test because a box cannot tell a stable parallel
 * formation from a closing pair, but the warning tier still fires on both, and
 * proximity is now the largest alert category by volume. Whether that volume is
 * simultaneous parallel approaches, which are ordinary operations at a field
 * like O'Hare, is a measurement rather than an opinion, so this exports the
 * pairing for the sampling harness. Exported rather than reimplemented: the
 * withdrawn Section 6.7 figures came from a harness that reimplemented two
 * detectors while claiming to import them.
 */
export type ProximityPair = {
  a: Flight;
  b: Flight;
  horizNm: number;
  vertFt: number;
  critical: boolean;
};

/**
 * Every pair the proximity walk considered, tagged with which gate each one
 * passed. Exported so a negative control can prove the doctrine SAW its
 * traffic and rejected it on a stated axis, rather than passing because no
 * pair was ever formed.
 *
 * This distinction is the same defect the corpus has now hit twice. Measured
 * 2026-08-18, six controls asserting silence formed zero wake pairs, so none
 * of them exercised the detector they were written for. Audited again
 * 2026-08-25 one level deeper: four controls asserted silence while forming
 * zero pairs of ANY kind, including the VFR-corridor case whose entire
 * purpose is to prove the vertical gate rejects laterally close traffic. A
 * silent pass and an unexercised gate are indistinguishable from outside, so
 * the tests need the inside view.
 */
/**
 * The proximity warning envelope, both axes. Declared once because it was
 * previously written as bare literals in two places, the detector and the
 * harness enumeration, which is the shape of drift that produced this
 * project's withdrawn Table 1: a harness that reimplemented what it claimed
 * to import.
 */
const PROXIMITY_HORIZONTAL_NM = 2;
const PROXIMITY_VERTICAL_FT = 1000;

export type ProximityCandidate = {
  a: Flight;
  b: Flight;
  horizNm: number;
  vertFt: number;
  /** Horizontal separation inside the 2 NM envelope. */
  withinHorizontal: boolean;
  /** Vertical separation inside the 1,000 ft envelope. */
  withinVertical: boolean;
};

export const proximityCandidatePairs = (state: SimState): ProximityCandidate[] => {
  const out: ProximityCandidate[] = [];
  const active = state.flights.filter(
    (f) => f.phase !== "at-gate" && f.altitudeFt > 0,
  );
  const seen = new Set<string>();
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      const key = [a.id, b.id].sort().join("-");
      if (seen.has(key)) continue;
      seen.add(key);
      const horizNm = Math.hypot(a.positionNm.x - b.positionNm.x, a.positionNm.y - b.positionNm.y);
      const vertFt = Math.abs(a.altitudeFt - b.altitudeFt);
      out.push({
        a,
        b,
        horizNm,
        vertFt,
        withinHorizontal: horizNm < PROXIMITY_HORIZONTAL_NM,
        withinVertical: vertFt < PROXIMITY_VERTICAL_FT,
      });
    }
  }
  return out;
};

export const proximityPairs = (state: SimState): ProximityPair[] =>
  proximityCandidatePairs(state)
    .filter((c) => c.withinHorizontal && c.withinVertical)
    .map(({ a, b, horizNm, vertFt }) => ({
      a,
      b,
      horizNm,
      vertFt,
      critical: isConvergingCritical(a, b, vertFt),
    }));

/**
 * True when two aircraft are attributed to distinct parallel runways: labels
 * differ, numeric courses within one ten-degree step (26R and 27L at Atlanta
 * are the same family; 28L and 28R at San Francisco likewise). Under
 * centreline attribution this is measurable for the first time: in the first
 * window collected with it, 71 per cent of all proximity pairs were aircraft
 * on distinct parallels at a median cross-track separation of 0.87 NM, the
 * runway spacing itself, with 8 critical among 1,855. That population is
 * simultaneous parallel approaches, the ordinary state of a busy US field and
 * the nuisance class ASRS CALLBACK documents on blunder-free approaches.
 */
const runwayCourseNumber = (designator: string): number => {
  // First-named end's course number: "27L" gives 27, and a full strip id
  // "10L/28R" gives 10 rather than the concatenation 1028, which a naive
  // digit-strip produced and which broke the mod-36 wraparound badly enough
  // to read crossing runways as parallel.
  const m = designator.match(/\d+/);
  return m ? Number.parseInt(m[0], 10) : Number.NaN;
};

const parallelRunwayPair = (a: Flight, b: Flight): boolean => {
  if (!a.assignedRunway || !b.assignedRunway) return false;
  if (a.assignedRunway === b.assignedRunway) return false;
  const na = runwayCourseNumber(a.assignedRunway);
  const nb = runwayCourseNumber(b.assignedRunway);
  if (Number.isNaN(na) || Number.isNaN(nb)) return false;
  const d = Math.abs(na - nb);
  return Math.min(d, 36 - d) <= 1;
};

const detectProximityConflict = (state: SimState): Alert[] => {
  const alerts: Alert[] = [];
  // Airborne departures are included. The filter previously excluded phase
  // "departed", which in this model means airborne and climbing out: exactly
  // the state in which a departure can conflict with an arrival descending
  // through the same altitude. Live ingest assigns that phase to every
  // departure it classifies, so the exclusion removed the whole departure
  // population from the only detector that models mid-air proximity, and the
  // Potomac reconstruction detected its collision only because its helicopter
  // was encoded "enroute" rather than "departed". See
  // docs/departure-proximity-blindspot.md. The altitude floor and the at-gate
  // exclusion stay: an aircraft on a stand or on the ground is not in an
  // airborne conflict.
  const active = state.flights.filter(
    (f) => f.phase !== "at-gate" && f.altitudeFt > 0,
  );
  const seen = new Set<string>();
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      const horizNm = Math.hypot(a.positionNm.x - b.positionNm.x, a.positionNm.y - b.positionNm.y);
      const vertFt = Math.abs(a.altitudeFt - b.altitudeFt);
      if (horizNm < PROXIMITY_HORIZONTAL_NM && vertFt < PROXIMITY_VERTICAL_FT) {
        const key = [a.id, b.id].sort().join("-");
        if (seen.has(key)) continue;
        seen.add(key);
        // Critical tier is a tau test, the same family of check TCAS runs
        // (Section 2.2): time to closest point of approach from the pair's
        // relative position and velocity, not a static distance box. The
        // daytime re-measurement promoted this: proximity volume grows
        // several-fold at peak density, and a distance box cannot tell a
        // stable 0.4 NM parallel formation from a closing head-on pair.
        //
        // critical := converging (tau in (0, 45 s]) AND the horizontal miss
        // distance at closest approach is inside DMOD (0.5 NM) AND the pair
        // is already inside the vertical envelope (< 200 ft). The vertical
        // test stays instantaneous because ADS-B ingest carries no vertical
        // rate; that simplification is documented in Section 5.4.
        //
        // A pair with no closure never escalates past warning, whatever its
        // spacing: two aircraft holding a stable 0.4 NM offset are a
        // formation or a parallel approach, and the box used to call them a
        // TCAS-grade emergency.
        const critical = isConvergingCritical(a, b, vertFt);
        // A non-converging pair attributed to distinct parallel runways is a
        // simultaneous parallel approach, not a conflict: demote to advisory
        // so the pair stays visible without claiming operator attention. The
        // tau test above is unaffected, so a genuine blunder on parallels
        // still escalates to critical.
        const parallel = !critical && parallelRunwayPair(a, b);
        alerts.push({
          id: `prox-${key}`,
          severity: critical ? "critical" : parallel ? "advisory" : "warning",
          category: "proximity-conflict",
          title: parallel
            ? `${a.callsign} and ${b.callsign} abreast on parallel approaches — ${horizNm.toFixed(1)} NM / ${Math.round(vertFt)} ft`
            : `${a.callsign} and ${b.callsign} converging — ${horizNm.toFixed(1)} NM / ${Math.round(vertFt)} ft`,
          detail: `${a.callsign} ${Math.round(a.altitudeFt / 100).toString().padStart(3, "0")}, ${b.callsign} ${Math.round(b.altitudeFt / 100).toString().padStart(3, "0")}`,
          flightIds: [a.id, b.id],
          reason: parallel
            ? `Aircraft attributed to distinct parallel runways (${a.assignedRunway}, ${b.assignedRunway}) with no convergence: simultaneous parallel approach geometry, ordinary at this spacing. Escalates only if the pair begins converging (tau test).`
            : `TCAS RA threshold ~0.5 NM horizontal / 200 ft vertical. Below ${PROXIMITY_HORIZONTAL_NM} NM / ${PROXIMITY_VERTICAL_FT} ft = warning. Mixed fixed-wing and rotor traffic at shared corridors compounds risk.`,
          suggestedAction: `Issue immediate vector or altitude change to one aircraft. Confirm visual on both. Re-route helicopter traffic away from approach corridor.`,
          createdAtTick: state.tick,
        });
      }
    }
  }
  return alerts;
};

/**
 * Suppression pairs. When an alert of the first category exists at `critical`
 * on a runway, an alert of the second category at a lower tier on the SAME
 * runway is operationally subsumed by it: the controller is already halting
 * movement on that runway, so a spacing or flow advisory adds nothing but
 * noise.
 *
 * Suppression is deliberately narrow. It requires a critical trigger, a
 * matching `runwayId` on both alerts, and a strictly lower severity on the
 * suppressed alert. It never removes a critical, and never crosses runways.
 */
const SUPPRESSION_PAIRS: ReadonlyArray<[Alert["category"], Alert["category"]]> = [
  // The two pairs the write-up specified. Both require a critical
  // runway-conflict, which on the current corpus co-occurs with a lower-tier
  // wake or flow alert on the same runway in no scenario, so they are retained
  // for correctness rather than because they fire.
  ["runway-conflict", "wake-spacing"],
  ["runway-conflict", "cascading-delay"],

  // Same-category redundancy, which the write-up's specification missed.
  // detectRunwayConflicts emits up to three alerts per runway: a critical for
  // multiple aircraft on the runway, and a warning for overlapping
  // arrival/departure intent. When the critical is present the warning is
  // describing the same unsafe occupancy at a lower tier.
  ["runway-conflict", "runway-conflict"],

  // A critical wake-separation violation on a runway subsumes a flow advisory
  // about arrivals stacking on that same runway: the controller is already
  // breaking up the sequence.
  ["wake-spacing", "cascading-delay"],
];

const SEVERITY_RANK: Record<Alert["severity"], number> = {
  critical: 0,
  warning: 1,
  advisory: 2,
  info: 3,
};

/**
 * Marks subsumed alerts rather than deleting them. An operator surface showing
 * a suppressed alert has to be able to say what suppressed it, and an audit of
 * the system after an incident has to be able to see everything the detectors
 * found, including what was hidden. Callers that want the operator view filter
 * on `suppressedBy === undefined`.
 */
export const applySuppression = (alerts: Alert[]): Alert[] => {
  const triggers = alerts.filter(
    (a) => a.severity === "critical" && a.runwayId !== undefined,
  );
  if (triggers.length === 0) return alerts;

  return alerts.map((a) => {
    if (a.runwayId === undefined) return a;
    if (a.severity === "critical") return a;
    const trigger = triggers.find(
      (t) =>
        t.runwayId === a.runwayId &&
        t.id !== a.id &&
        SEVERITY_RANK[a.severity] > SEVERITY_RANK[t.severity] &&
        SUPPRESSION_PAIRS.some(([higher, lower]) => higher === t.category && lower === a.category),
    );
    return trigger ? { ...a, suppressedBy: trigger.id } : a;
  });
};

/**
 * The population, in the order the orchestrator has always run it. Exported as
 * an ordered list rather than inlined so a detector can be left out and the
 * rest re-run through suppression, which is the only honest way to ask what a
 * detector contributes: suppression couples them, so filtering finished alerts
 * by category answers a different and easier question. The order is preserved
 * exactly, because suppression keeps the first alert of a subsumed pair and
 * reordering would change which one survives.
 */
export const DETECTORS: ReadonlyArray<{
  category: Alert["category"];
  run: (state: SimState) => Alert[];
}> = [
  { category: "runway-conflict", run: detectRunwayConflicts },
  { category: "runway-identity", run: detectRunwayIdentity },
  { category: "wake-spacing", run: detectWakeSpacing },
  { category: "gate-conflict", run: detectGateConflicts },
  { category: "fuel-hold", run: detectFuelHold },
  { category: "crosswind", run: detectCrosswind },
  { category: "weather-shift", run: detectWeatherShift },
  { category: "runway-surface", run: detectRunwaySurface },
  { category: "squawk-emergency", run: detectSquawkEmergency },
  { category: "cascading-delay", run: detectCascadingDelay },
  { category: "proximity-conflict", run: detectProximityConflict },
];

/** Run the population with `without` omitted, then suppress as usual. */
export const runRulesWithout = (
  state: SimState,
  without: Alert["category"] | null,
): Alert[] => {
  const all = DETECTORS.filter((d) => d.category !== without).flatMap((d) =>
    d.run(state),
  );
  return applySuppression(all).sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
};

export const runAllRules = (state: SimState): Alert[] => {
  const all = DETECTORS.flatMap((d) => d.run(state));
  return applySuppression(all).sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
};
