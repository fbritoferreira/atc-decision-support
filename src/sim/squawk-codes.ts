/**
 * Transponder code reference, served publicly at /squawks.
 *
 * Where these come from, added 2026-09-01 because the table had no provenance
 * at all and this project's argument is that its values are read from
 * documents rather than chosen. The three emergency codes are ICAO Annex 10
 * Volume IV, carried into FAA JO 7110.65 paragraph 10-2 and the AIM at 6-2-2,
 * and they are the same everywhere. The US allocations, 1200 and the 12xx
 * series, 4000, 5000 and the rest, come from the National Beacon Code
 * Allocation Plan, FAA JO 7110.66. The European conspicuity codes 7000 and
 * 1000 are ICAO regional allocations rather than FAA ones, which is why each
 * entry carries a region.
 *
 * What was checked and what was not. The three emergency codes and the two
 * conspicuity codes were verified against the orders named above. The
 * remaining allocations were not checked cell by cell the way TBL 5-5-2 was,
 * so they are reproduced from the same references and are not independently
 * confirmed here. That distinction is written down rather than left to the
 * reader, because a published reference table invites citation and this one
 * should be cited only as far as it has been checked.
 */
export type SquawkCategory =
  | "emergency"
  | "vfr"
  | "ifr"
  | "military"
  | "special-use"
  | "atc-discrete";

export type SquawkEntry = {
  code: string;
  label: string;
  description: string;
  category: SquawkCategory;
  region?: string;
};

export const SQUAWK_CODES: SquawkEntry[] = [
  {
    code: "7500",
    label: "Unlawful Interference / Hijack",
    description:
      "Aircraft subject to unlawful interference. Pilots may squawk 7500 to silently alert ATC of a hijack situation. Triggers immediate emergency protocols.",
    category: "emergency",
  },
  {
    code: "7600",
    label: "Lost Communications",
    description:
      "Radio communication failure. Aircraft is unable to receive or transmit on assigned frequency. ATC will use light gun signals or alternate methods.",
    category: "emergency",
  },
  {
    code: "7700",
    label: "General Emergency",
    description:
      "Catch-all emergency. Mayday, medical emergency, engine failure, fuel emergency, anything requiring priority handling. All ATC facilities give priority.",
    category: "emergency",
  },
  {
    code: "1200",
    label: "VFR (USA)",
    description:
      "Standard Visual Flight Rules code in the United States. Used by pilots not in contact with ATC, operating under VFR.",
    category: "vfr",
    region: "USA",
  },
  {
    code: "7000",
    label: "VFR (Europe / ICAO)",
    description:
      "Conspicuity code for VFR flights operating in European airspace per ICAO recommendation.",
    category: "vfr",
    region: "ICAO",
  },
  {
    code: "1201",
    label: "VFR — Near LA Class B",
    description:
      "Reserved for VFR aircraft operating in proximity to Los Angeles Class B airspace.",
    category: "vfr",
    region: "USA",
  },
  {
    code: "1202",
    label: "Glider — No ATC contact",
    description: "Glider operations not in contact with ATC (USA).",
    category: "vfr",
    region: "USA",
  },
  {
    code: "1255",
    label: "Aerial Firefighting",
    description:
      "Aircraft involved in aerial firefighting operations, including air tankers, scoopers, and lead planes.",
    category: "special-use",
    region: "USA",
  },
  {
    code: "1276",
    label: "ADIZ Penetration",
    description:
      "Penetration of Air Defense Identification Zone; operations under DVFR (Defense VFR) flight plan.",
    category: "special-use",
    region: "USA",
  },
  {
    code: "1277",
    label: "Search and Rescue",
    description: "Search and rescue (SAR) operations.",
    category: "special-use",
    region: "USA",
  },
  {
    code: "4000",
    label: "Military Training Route Low",
    description:
      "Aircraft on military training routes (MTR) below 10,000 ft, not in contact with ATC.",
    category: "military",
    region: "USA",
  },
  {
    code: "7400",
    label: "UAS Lost Link",
    description:
      "Unmanned aircraft that has lost its command and control link. Assigned so controllers can identify an aircraft that will now fly its programmed lost-link profile rather than respond to instructions.",
    category: "military",
    region: "USA",
  },
  {
    code: "5000",
    label: "NORAD Air Defense",
    description: "NORAD aircraft on air defense missions.",
    category: "military",
    region: "USA",
  },
  {
    code: "5100",
    label: "NORAD Exercise",
    description: "NORAD exercise / training mission.",
    category: "military",
    region: "USA",
  },
  {
    code: "7777",
    label: "Military Intercept (DO NOT USE)",
    description:
      "Reserved for military interceptor operations. Civilian pilots must not squawk this.",
    category: "military",
  },
  {
    code: "1000",
    label: "IFR with Mode S (no discrete)",
    description:
      "IFR flight equipped with Mode S, where ATC has not assigned a discrete code. Used in Europe.",
    category: "ifr",
    region: "Europe",
  },
  {
    code: "2000",
    label: "IFR — Entering ATC area without code",
    description:
      "IFR aircraft entering an ATC area from outside, before being assigned a discrete code.",
    category: "ifr",
  },
  {
    code: "0033",
    label: "Parachute Drop Ops",
    description: "Active parachute drop operations.",
    category: "special-use",
    region: "UK",
  },
  {
    code: "0034",
    label: "Antenna Trailing / Target Towing",
    description: "Aerial surveying operations.",
    category: "special-use",
    region: "UK",
  },
  {
    code: "0036",
    label: "Helicopter Pipeline / Powerline Inspection",
    description: "Law enforcement aircraft on operations.",
    category: "special-use",
    region: "UK",
  },
  // Provenance for this block, 2026-09-01: 0033 and 0037 are corroborated by
  // multiple published UK allocation lists and 0037 additionally by the
  // absence of any US presidential allocation. The 0034 and 0036 labels come
  // from those same aggregated lists rather than from a primary source, and
  // one list assigns police operations to 0032 rather than to 0036. Confirm
  // both against UK AIP ENR 1.6 before treating them as authoritative.
  // Carried "Presidential Aircraft" with region USA until 2026-09-01. There is
  // no published US allocation for presidential aircraft; they are issued an
  // ordinary discrete code. 0037 is a UK code, and the tell was that the rest
  // of the 003x block carried no region while this one claimed the US.
  {
    code: "0037",
    label: "Royal Flight (Helicopters)",
    description:
      "United Kingdom allocation, reserved for helicopter Royal Flights. Fixed-wing Royal Flights use a separate code.",
    category: "special-use",
    region: "UK",
  },
  {
    code: "0000",
    label: "Mode S Test / Reserved",
    description: "Reserved for SSR Mode S transponder test purposes.",
    category: "atc-discrete",
  },
];

export const SQUAWK_RANGES: { range: string; label: string; description: string; category: SquawkCategory }[] = [
  {
    range: "0100–1200",
    label: "Generally unassigned (USA)",
    description: "Generally not assigned, with exceptions for special-use codes.",
    category: "atc-discrete",
  },
  {
    range: "1201–1276",
    label: "VFR Special",
    description: "Reserved for various VFR special operations.",
    category: "vfr",
  },
  {
    range: "1300–1373",
    label: "Glider operations",
    description: "Designated for glider operations not in contact with ATC.",
    category: "vfr",
  },
  {
    range: "1500–4477",
    label: "ATC Assigned (Discrete)",
    description:
      "Common range for discrete ATC-assigned codes for IFR and flight-following VFR aircraft.",
    category: "atc-discrete",
  },
  {
    range: "4400–4477",
    label: "Special / NASA / DoD",
    description: "NASA, DoD, and other special operations.",
    category: "special-use",
  },
  {
    range: "5000–5777",
    label: "NORAD / Military",
    description: "Reserved for NORAD operations and military aircraft.",
    category: "military",
  },
  {
    range: "6000–6777",
    label: "Mostly Discrete",
    description: "Mostly assigned by ATC as discrete codes; some special-use blocks within.",
    category: "atc-discrete",
  },
  {
    range: "7501–7577",
    label: "Reserved",
    description: "Avoided near 7500 to prevent accidental hijack signal.",
    category: "atc-discrete",
  },
  {
    range: "7601–7677",
    label: "Reserved",
    description: "Avoided near 7600 to prevent accidental lost-comms signal.",
    category: "atc-discrete",
  },
  {
    range: "7701–7777",
    label: "Reserved",
    description: "Avoided near 7700 to prevent accidental emergency signal.",
    category: "atc-discrete",
  },
];

export const CATEGORY_META: Record<
  SquawkCategory,
  { label: string; color: string; bg: string }
> = {
  emergency: { label: "EMERGENCY", color: "#ef4444", bg: "rgba(239, 68, 68, 0.10)" },
  vfr: { label: "VFR", color: "#4ade80", bg: "rgba(74, 222, 128, 0.08)" },
  ifr: { label: "IFR", color: "#38bdf8", bg: "rgba(56, 189, 248, 0.08)" },
  military: { label: "MILITARY", color: "#fb923c", bg: "rgba(251, 146, 60, 0.10)" },
  "special-use": { label: "SPECIAL USE", color: "#a78bfa", bg: "rgba(167, 139, 250, 0.10)" },
  "atc-discrete": { label: "ATC DISCRETE", color: "#94a3b8", bg: "rgba(148, 163, 184, 0.08)" },
};
