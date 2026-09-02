import type { Weather } from "./types";

type MetarRecord = {
  icaoId: string;
  wdir?: number | string;
  wspd?: number;
  wgst?: number;
  visib?: string | number;
  altim?: number;
  temp?: number;
  dewp?: number;
  cover?: string;
  clouds?: { cover: string; base: number }[];
  fltCat?: "VFR" | "MVFR" | "IFR" | "LIFR";
  rawOb?: string;
  wxString?: string;
};

/**
 * Present weather from a METAR.
 *
 * Two things here were wrong until 2026-09-01 and they compounded. The caller
 * passed the full raw observation in preference to the structured present-
 * weather field, and the match was a bare substring over the whole string,
 * remarks included. `TSNO` is a routine remark on US automated stations
 * meaning thunderstorm information is *not available*, and it contains "TS",
 * so a clear day at a field whose storm sensor is out was read as a
 * thunderstorm at the field. The detector that reads this emits a warning
 * suggesting a ground stop for departures.
 *
 * `RAB12E30` (rain began :12, ended :30) reads as rain now for the same
 * reason. Remarks describe the hour, not the moment.
 *
 * So: the body only, never the remarks, and whole tokens rather than
 * substrings. A present-weather group is an optional intensity or proximity
 * prefix, then two-letter codes.
 */
export const parsePrecipitation = (raw: string | undefined): Weather["precipitation"] => {
  // "none" for an absent observation is the same shape as the flight-category
  // default below, and it fails the same way: toward no thunderstorm, which is
  // the branch that suggests a ground stop. Checked rather than assumed
  // harmless on 2026-09-01. The caller passes `m.wxString || m.rawOb`, and a
  // record with neither is not a METAR the source produces; every observation
  // fetched from it while checking carried a raw body, and wxString is the one
  // that is often absent, which is why the fallback exists. So this branch is
  // reachable only through a malformed response, and the failure it would cause
  // is a silenced thunderstorm rather than an invented one. Left as "none"
  // rather than marked, because the type has no way to say "unknown" and
  // adding one to serve an unreachable branch buys nothing; the reasoning is
  // here so the next person does not have to redo it.
  if (!raw) return "none";
  // Everything from RMK onward describes the past hour and the station's own
  // health, not conditions now.
  const body = raw.toUpperCase().split(/\bRMK\b/)[0];
  const groups = body
    .split(/\s+/)
    .filter((tok) => /^(?:[-+]|VC)?(?:MI|PR|BC|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|PL|GR|GS|UP)?(?:DZ|RA|SN|SG|PL|GR|GS|UP)?$/.test(tok))
    .filter((tok) => tok.length > 1);
  const joined = groups.join(" ");
  if (/TS/.test(joined)) return "thunderstorm";
  if (/SN|SG/.test(joined)) return "snow";
  if (/RA|DZ/.test(joined)) return "rain";
  return "none";
};

/**
 * Every fallback in this file is optimistic, and that is a decision rather than
 * an accident, but it was never written down or reported.
 *
 *   missing flight category -> "VFR"
 *   missing visibility      -> 10 SM
 *   no opaque cloud layer   -> 20,000 ft ceiling
 *   missing wind speed      -> 0 kt, calm
 *   missing wind direction  -> 0
 *
 * So absent weather reads as the best weather, and the two detectors that fire
 * on bad weather, crosswind and weather-shift, stay silent exactly when the
 * data needed to trigger them did not arrive. For an advisory layer that is
 * arguably the right direction to fail, since a fabricated alert costs more
 * than a missed one in a tool a controller has to trust. It is still a
 * fabrication, and none of these can be told apart from a real reading
 * downstream: the sampled window stores one value per field per snapshot.
 *
 * The consequential one is the flight category, because Section 6.10's whole
 * comparison is visual against instrument conditions. See the note at its use
 * below.
 */
/**
 * Visibility in statute miles, as METAR reports it.
 *
 * `Number.parseFloat` was doing this, and it stops at the first non-numeric
 * character, so it read a fraction as its numerator: "1/2" became 1, "3/4"
 * became 3, "1 1/2" became 1, and "M1/4", which means less than a quarter
 * mile and is the worst category reported, matched nothing and fell through to
 * the ten-mile default. Forty times the actual value.
 *
 * The thresholds this feeds make that worse than a rounding error, because the
 * numerators land exactly on them. `belowCatI` is visibility under 0.5, `lifr`
 * under 1, `ifr` under 3; a half mile read as 1 fails `1 < 1`, three quarters
 * read as 3 fails `3 < 3`, and under a quarter read as 10 fails all three. In
 * the exact conditions these tests exist to catch, every one of them was
 * silent unless the flight category happened to carry the day separately,
 * which is itself defaulted optimistically a few lines below.
 */
export const parseVis = (v: string | number | undefined): number => {
  if (typeof v === "number") return v;
  if (!v) return 10;
  const raw = v.trim().toUpperCase().replace(/SM$/, "").trim();
  // "10+" and "P6" both mean "at least this", and the bound is the useful
  // number here: no threshold below cares how far beyond it the value is.
  const atLeast = raw.replace(/^P/, "").replace(/\+$/, "");
  // "M" prefixes a value the observation is below, so a quarter mile reported
  // as M1/4 is under a quarter. The bound is used rather than a guess at how
  // far under, which keeps it honest and still trips every threshold.
  const bounded = atLeast.replace(/^M/, "");
  // "1 1/2" is a whole part and a fraction; "3/4" is a fraction alone.
  const mixed = bounded.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const [, whole, num, den] = mixed;
    const d = Number(den);
    return d === 0 ? 10 : Number(whole) + Number(num) / d;
  }
  const fraction = bounded.match(/^(\d+)\/(\d+)$/);
  if (fraction) {
    const [, num, den] = fraction;
    const d = Number(den);
    return d === 0 ? 10 : Number(num) / d;
  }
  const n = Number.parseFloat(bounded);
  return Number.isFinite(n) ? n : 10;
};

/**
 * Ceiling in feet: the lowest layer that constitutes one.
 *
 * Broken and overcast form a ceiling, and this accepted only those two. An
 * obscured sky does as well, and is the worse case: `VV` reports vertical
 * visibility into an indefinite ceiling, which is what fog gives, and the FAA
 * treats that value as the ceiling for minima. Being neither BKN nor OVC, an
 * obscured sky at 100 ft fell through to the 20,000 ft clear-day default, so
 * the single worst sky reported as the best one. The same shape as the
 * visibility parse above, and in the same direction.
 *
 * A layer whose base is missing used to reach Math.min and make the whole
 * result NaN, which then failed every `ceilingFt < n` test in rules.ts, so an
 * unreadable ceiling raised nothing rather than raising doubt. Such layers are
 * skipped now, and if that leaves none the clear default applies as before.
 */
export const lowestCloudFt = (clouds: MetarRecord["clouds"]): number => {
  if (!clouds || clouds.length === 0) return 20000;
  const CEILING_COVERS = new Set(["BKN", "OVC", "VV", "OVX"]);
  const bases = clouds
    .filter((c) => CEILING_COVERS.has(c.cover))
    .map((c) => c.base)
    .filter((b) => Number.isFinite(b));
  if (bases.length === 0) return 20000;
  return Math.min(...bases);
};

export const fetchAirportWeather = async (icao: string): Promise<Weather> => {
  const res = await fetch(`/api/wx/data/metar?ids=${icao}&format=json`);
  if (!res.ok) throw new Error(`metar ${res.status}`);
  const data: MetarRecord[] = await res.json();
  const m = data[0];
  if (!m) throw new Error("no metar");
  // "VRB" parses to nothing and falls to 0, which reads as a due north wind
  // that was never reported. Checked rather than assumed to be harmless: a
  // variable direction is only reported at 6 kt or less, and the crosswind
  // limit is 25, so no substituted direction can change that alert. It shows
  // as 000 on the display, which is the whole cost.
  const wdir = typeof m.wdir === "string" ? Number.parseInt(m.wdir, 10) || 0 : m.wdir ?? 0;
  return {
    windDirDeg: wdir,
    windKts: m.wspd ?? 0,
    gustsKts: m.wgst ?? m.wspd ?? 0,
    visibilityNm: parseVis(m.visib),
    ceilingFt: lowestCloudFt(m.clouds),
    // `?? "VFR"` is the most consequential fabricated default in this project,
    // and the least visible. A METAR that arrives without a flight category is
    // recorded as visual conditions, and nothing downstream can tell that
    // reading apart from a measured VFR: the sampled window stores one string
    // per snapshot, so the defaulted share cannot be recovered from it
    // afterwards.
    //
    // It lands on the variable the largest open question turns on. Section 6.10
    // rests on comparing wake violations under visual against instrument
    // conditions, the instrument sample is five pairs against the thirty the
    // comparison needs, and every snapshot mis-filed as VFR both inflates the
    // visual arm and removes exposure from the arm that is starved.
    //
    // NOT CHANGED HERE. A window has been sampling since 2026-08-30 13:04Z, and
    // the right change needs a decision rather than a default: absence is not
    // VFR and is not IFR, so it probably belongs in neither bucket, the way
    // MVFR already sits in neither. Making that change also wants the rate
    // measured first, which needs a field added to the window CSV, because the
    // present schema cannot express "unknown".
    condition: m.fltCat ?? "VFR",
    // Recorded beside the default rather than instead of it: changing the
    // bucket needs the rate measured first, and measuring the rate needs
    // exactly this flag. False here is what a defaulted VFR looks like.
    conditionObserved: m.fltCat != null,
    // Structured present weather first, the raw observation as fallback, and
    // falsy rather than nullish on purpose: an empty wxString is as likely to
    // mean "not provided" as "nothing to report", and falling through costs
    // nothing now that the parser reads only the observation body. A clear
    // report has no present-weather group in it either way.
    precipitation: parsePrecipitation(m.wxString || m.rawOb),
  };
};

export const fetchKjfkWeather = (): Promise<Weather> => fetchAirportWeather("KJFK");
