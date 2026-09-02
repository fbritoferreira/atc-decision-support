import { type Airport, latLonToLocalNm } from "./airports";
import { inferRunway } from "./runway-infer";
import { airportEndGeometries } from "./runway-geometry";
import { wakeFromType } from "./wake-lookup";
import type { Flight } from "./types";

type AdsbRecord = {
  hex: string;
  flight?: string;
  r?: string;
  t?: string;
  type?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | "ground";
  gs?: number;
  track?: number;
  mag_heading?: number;
  squawk?: string;
  dst?: number;
  dir?: number;
  emergency?: string;
};

type AdsbResponse = { ac?: AdsbRecord[] };

const RANGE_NM = 40;
const RADIANS = Math.PI / 180;

/**
 * Exported for the phase-vocabulary guard in the test suite. Live ingest can
 * only ever produce a subset of the nine declared phases, and several
 * detectors gate on phases outside that subset; see
 * docs/phase-vocabulary-audit.md. The guard fails if this function starts
 * producing a phase the audit did not account for.
 */
export const phaseFromAlt = (altFt: number, gs: number, dst: number): Flight["phase"] => {
  if (altFt === 0 && gs < 30) return "queued";
  if (altFt === 0 && gs >= 30) return "taxi-out";
  if (altFt < 2000 && dst < 5) return "final";
  if (altFt < 6000 && dst < 20) return "approach";
  if (altFt > 25000) return "enroute";
  return "approach";
};

const bearingFromArp = (
  lat: number,
  lon: number,
  arp: { lat: number; lon: number },
): number => {
  const phi1 = arp.lat * RADIANS;
  const phi2 = lat * RADIANS;
  const dLambda = (lon - arp.lon) * RADIANS;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const brng = Math.atan2(y, x) * (180 / Math.PI);
  return (brng + 360) % 360;
};

/**
 * The aircraft's ground track in TRUE degrees, or undefined when the record
 * carries neither field.
 *
 * Order matters and used to be backwards. The expression here was
 * `rec.mag_heading ?? rec.track ?? 0`, wrong on three counts at once.
 * `mag_heading` is magnetic where every comparison downstream is true, so it is
 * out by the local variation, up to about fourteen degrees against gates of
 * twenty and thirty. It is also the aircraft's HEADING, where the nose points,
 * while `track` is where the aircraft is going, so the two differ by drift as
 * well. And `?? 0` handed a record carrying neither field a heading of due
 * north rather than treating it as having none, which was then compared against
 * runway courses like any measured value.
 *
 * Returning undefined rather than a number is the point: absence is
 * representable now, and the two callers that classify by geometry decline a
 * contact they cannot orient instead of guessing north for it. Measured against
 * adsb.lol on 2026-08-29, mag_heading is rare but real: absent at KATL and
 * KORD, one record of 62 at KJFK, two of 22 at KDFW, and one aircraft carrying
 * both read track 180.0 against mag_heading 174.4.
 */
const trueTrackOf = (rec: AdsbRecord): number | undefined => rec.track ?? rec.mag_heading;

// The `?? 0` on lat and lon in these two classifiers cannot fire. Both are
// called only from adsbToFlight, which rejects a record with either missing
// before it gets here, so the fallback exists to satisfy the optional fields on
// AdsbRecord rather than to handle a case. Stated because it reads as the
// opposite: a reader meets `rec.lat ?? 0` and reasonably concludes that a
// positionless record is given a bearing computed from the Gulf of Guinea, and
// then either trusts an attribution that never happens or removes a line the
// compiler needs. Checked 2026-09-01 by following the call sites.
const isArrival = (rec: AdsbRecord, distNm: number, arp: { lat: number; lon: number }): boolean => {
  const alt = typeof rec.alt_baro === "number" ? rec.alt_baro : 0;
  const heading = trueTrackOf(rec);
  if (heading === undefined) return false;
  const bearingToAirport = (bearingFromArp(rec.lat ?? 0, rec.lon ?? 0, arp) + 180) % 360;
  const headingDelta = Math.min(
    Math.abs(heading - bearingToAirport),
    360 - Math.abs(heading - bearingToAirport),
  );
  const descending = alt > 0 && alt < 12000 && distNm < 30;
  const headingToward = headingDelta < 60;
  return descending && headingToward;
};

const isDeparture = (rec: AdsbRecord, distNm: number, arp: { lat: number; lon: number }): boolean => {
  const alt = typeof rec.alt_baro === "number" ? rec.alt_baro : 0;
  const climbing = alt > 0 && alt < 10000;
  const close = distNm < 25;
  const heading = trueTrackOf(rec);
  if (heading === undefined) return false;
  const bearingFromAirport = bearingFromArp(rec.lat ?? 0, rec.lon ?? 0, arp);
  const headingDelta = Math.min(
    Math.abs(heading - bearingFromAirport),
    360 - Math.abs(heading - bearingFromAirport),
  );
  const headingAway = headingDelta < 60;
  return climbing && close && headingAway;
};

const adsbToFlight = (rec: AdsbRecord, airport: Airport): Flight | null => {
  if (rec.lat === undefined || rec.lon === undefined) return null;
  if (typeof rec.alt_baro !== "number" && rec.alt_baro !== "ground") return null;
  // Distance from the field, declined rather than defaulted. This read
  // `rec.dst ?? 0` until 2026-08-31, the same fabrication shape the heading
  // resolution carried until 2026-08-30 and worse where it bit: zero means AT
  // the field, so a record with no distance passed every distance gate and
  // phaseFromAlt read it as "final" below 2,000 ft.
  //
  // Measured before changing, against adsb.lol across all fourteen registry
  // airports: 1,181 records carried `dst` and none omitted it. The only caller
  // queries the radius endpoint /v2/lat/{lat}/lon/{lon}/dist/{range}, which
  // reports a distance per aircraft because that is what a radius query is
  // for, so this branch is unreachable on that path rather than merely
  // believed to be, and declining costs nothing measured.
  //
  // The measurement also ruled out the repair that looked better. lat and lon
  // are required two lines above and airports.ts exports distanceNm, so the
  // distance is derivable and a computed value could replace the field
  // outright, declining no contact. It should not. distanceNm is
  // equirectangular, exact at the reference point and drifting with range, and
  // against the provider's own dst the residual reached 0.154 NM at the 40 NM
  // query radius, 0.4 per cent. Small, and not small enough: over the 672
  // records of the second sample it changed the answer to one of the 4,032
  // gate comparisons, because twenty-four of those contacts sat within 0.2 NM
  // of one of the six distance gates this file applies. A fabrication that
  // fires zero times is a better trade than a projection error that fires
  // once.
  const distNm = rec.dst;
  if (distNm === undefined) return null;
  if (distNm > RANGE_NM) return null;

  const arrival = isArrival(rec, distNm, airport.arp);
  const departure = isDeparture(rec, distNm, airport.arp);
  if (!arrival && !departure) return null;

  const alt = typeof rec.alt_baro === "number" ? rec.alt_baro : 0;
  const gs = rec.gs ?? 0;
  // Reached only for a contact isArrival or isDeparture accepted, and both
  // now decline a record with no track, so this is defined by construction.
  // Kept as a guard rather than an assertion so a future caller cannot
  // reintroduce the fabricated north silently.
  const heading = trueTrackOf(rec);
  if (heading === undefined) return null;
  const pos = latLonToLocalNm(rec.lat, rec.lon, airport.arp);
  const callsign = (rec.flight ?? rec.r ?? rec.hex).trim();
  const aircraft = rec.t ?? "UNKN";
  const wake = wakeFromType(rec.t);
  const phase = arrival ? phaseFromAlt(alt, gs, distNm) : alt === 0 ? "queued" : "departed";
  // ETA is dst/gs, and a near-stationary contact (helicopter, ground return
  // with residual speed) makes it degenerate: hundreds of minutes that then
  // poison the ingest EMA and can drag a smoothed ETA far above the
  // synthesised fuel figure, tripping fuel criticals the live pipeline is
  // supposed to be unable to produce (19 were measured in one KLAX window).
  // 40 NM at 120 kts is 20 minutes; 60 caps every plausible arrival while
  // clipping the degenerate tail.
  const ETA_CAP_MIN = 60;
  const etaMin = arrival && gs > 0 ? Math.min(ETA_CAP_MIN, Math.max(0, (distNm / gs) * 60)) : 0;
  // Departures are attributed too, within 12 NM, by running the same centreline
  // geometry backwards. Until 2026-08-26 only arrivals were, which left the
  // departure population with no runway and therefore no way to triage the
  // departure-versus-departure proximity pairs the blind-spot fix exposed
  // (docs/departure-fix-cost.md).
  //
  // AIRBORNE departures only, and the exclusion of ground ones is deliberate
  // rather than incidental. Attributing a departure still on the roll made the
  // runway-identity doctrine fire a false critical, measured at KBOS: that
  // doctrine compares the aircraft's heading against the registry's MAGNETIC
  // runway heading, while attribution compares against the TRUE course derived
  // from the threshold coordinates, and Boston's registry heading is about nine
  // degrees off its coordinate-derived course. An aircraft correctly lined up
  // on 04L was therefore 24 degrees from its "assigned" heading against a
  // 20-degree tolerance, and was reported as rolling on the wrong runway.
  //
  // The scope this fix keeps is the one the attribution was built for: airborne
  // proximity triage. Ground departures gain nothing from a runway label here,
  // and giving them one requires first making the identity doctrine compare
  // like with like, which is a data-model change to carry true courses on the
  // runway record. See docs/departure-attribution-identity.md.
  const attributable = arrival || phase === "departed";
  const assignedRunway =
    attributable && distNm < 12
      ? inferRunway(heading, alt, airport.runways, airportEndGeometries(airport), pos, departure)
      : undefined;

  return {
    id: rec.hex,
    callsign,
    type: arrival ? "arrival" : "departure",
    aircraft,
    wake,
    origin: arrival ? "----" : airport.icao,
    destination: arrival ? airport.icao : "----",
    phase,
    altitudeFt: alt,
    speedKts: gs,
    headingDeg: heading,
    positionNm: pos,
    assignedRunway,
    fuelMin: arrival ? Math.max(30, etaMin + 60) : 240,
    etaMin,
    squawk: rec.squawk ?? "----",
  };
};

export type LiveTrafficResult = {
  /** Contacts classified as arrivals or departures for this airport. */
  flights: Flight[];
  /** Raw ADS-B contacts inside RANGE_NM, before arrival/departure classification. */
  contacts: number;
  /**
   * Seconds since the edge proxy fetched this picture from the upstream feed,
   * from its `x-proxy-age` header, or undefined when that header is absent
   * or unparseable. Not the age of the HTTP round trip: the
   * proxy serves a cached copy for 15 seconds and a stale one for up to five
   * minutes while adsb.lol refuses, so these can differ by minutes.
   */
  ageSeconds: number | undefined;
  /** The proxy served this after an upstream refusal (`x-proxy-stale`). */
  stale: boolean;
};

/**
 * As `fetchLiveTraffic`, but also reports how many raw contacts the feed
 * returned. The gap between `contacts` and `flights.length` is the share of
 * nearby traffic the heuristic classifier cannot attribute to this airport
 * (overflights, and traffic belonging to other fields in shared airspace);
 * those contacts are never seen by the detector population. Used by
 * `scripts/fp-analysis.mjs` to quantify ingest coverage.
 */
export const fetchLiveTrafficDetailed = async (
  airport: Airport,
): Promise<LiveTrafficResult> => {
  const url = `/api/adsb/v2/lat/${airport.arp.lat}/lon/${airport.arp.lon}/dist/${RANGE_NM}`;
  const res = await fetch(url);
  // Status only: the caller decides which upstream served this, and an
  // earlier revision hardcoding one name hid a ten-hour mirror outage.
  if (!res.ok) throw new Error(`ADS-B upstream ${res.status}`);
  const data: AdsbResponse = await res.json();
  const records = data.ac ?? [];
  const flights: Flight[] = [];
  for (const rec of records) {
    const f = adsbToFlight(rec, airport);
    if (f) flights.push(f);
  }
  // The proxy has always set these two headers and nothing has ever read them.
  // Its own comment said "the client surfaces the marker", and the client did
  // not: the operator surface timed its "updated Ns ago" from the moment the
  // response arrived, so a five-minute-old sky served during an upstream
  // refusal was labelled current. Reading them here makes that number describe
  // the traffic picture rather than the round trip.
  // Strictly, and undefined when it cannot be read. `Number(h ?? 0) || 0`
  // turned both a missing header and an unparseable one into zero, which is
  // the claim "fetched just now" and is exactly the defect described above
  // reappearing through the parse rather than through the timing. The proxy
  // always sets this, so the absent case means the response did not come from
  // the proxy, and the honest answer then is that the age is unknown rather
  // than nothing.
  const rawAge = res.headers.get("x-proxy-age");
  const parsedAge = rawAge === null ? Number.NaN : Number(rawAge);
  const ageSeconds = Number.isFinite(parsedAge) ? parsedAge : undefined;
  return {
    flights,
    contacts: records.length,
    ageSeconds,
    stale: res.headers.get("x-proxy-stale") === "true",
  };
};

export const fetchLiveTraffic = async (airport: Airport): Promise<Flight[]> =>
  (await fetchLiveTrafficDetailed(airport)).flights;

export const fetchLiveKJFK = (): Promise<Flight[]> => {
  return import("./airports").then(({ KJFK }) => fetchLiveTraffic(KJFK));
};
