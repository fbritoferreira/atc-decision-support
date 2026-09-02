import type { CwtCategory } from "./types-cwt";

/**
 * FAA Consolidated Wake Turbulence category by ICAO type designator.
 *
 * Source: FAA Order JO 7110.126B, Appendix A, TBL A-1 "Aircraft Types
 * Categorized". Extracted rather than transcribed by hand, so the column to
 * category mapping is worth stating: several categories occupy two visual
 * sub-columns in the published table, D, F and G among them.
 *
 * Cite JO 7110.65 paragraph 5-5-4 as the authority, NOT the 126 series. CWT was
 * incorporated into 7110.65 and the standalone 126, 126A and 126B are cancelled;
 * 126B is only where this table is legible.
 *
 * NOT YET WIRED INTO THE DETECTOR. See docs/cwt-migration.md: switching the wake
 * model changes detector output, so it lands between sampling windows and every
 * wake figure needs re-measuring after.
 *
 * Categories:
 *   A  A388 and A225
 *   B  Pairwise Upper Heavy
 *   C  Pairwise Lower Heavy
 *   D  Non-Pairwise Heavy
 *   E  B757
 *   F  Upper Large excluding B757
 *   G  Lower Large
 *   H  Upper Small, MTOW above 15,400 lb up to 41,000 lb
 *   I  Lower Small, MTOW 15,400 lb or less
 */

const CWT_A: readonly string[] = [
  "A225", "A388",
];

const CWT_B: readonly string[] = [
  "A332", "A333", "A343", "A345", "A346", "A359", "B742", "B744",
  "B748", "B772", "B773", "B77L", "B77W", "B788", "B789", "C5M",
];

const CWT_C: readonly string[] = [
  "A306", "A30B", "A310", "B762", "B763", "B764", "C17", "DC10",
  "K35R", "MD11",
];

const CWT_D: readonly string[] = [
  "A124", "A339", "A342", "A3ST", "A400", "A50", "AN22", "B52",
  "B703", "B741", "B743", "B74D", "B74R", "B78X", "BLCF", "BSCA",
  "C135", "C141", "DC85", "DC86", "DC87", "E3CF", "E3TF", "E767",
  "IL62", "IL76", "IL86", "IL96", "K35E", "KE3", "L101", "MYA4",
  "T144", "T160", "TU95", "VMT",
];

const CWT_E: readonly string[] = [
  "B752", "B753",
];

const CWT_F: readonly string[] = [
  "A318", "A319", "A320", "A321", "B712", "B721", "B722", "B732",
  "B733", "B734", "B735", "B736", "B737", "B738", "B739", "C130",
  "C30J", "CVLT", "DC93", "DC95", "DH8D", "E190", "GL5T", "GLEX",
  "GLF5", "GLF6", "MD82", "MD83", "MD87", "MD88",
];

const CWT_G: readonly string[] = [
  "AT43", "AT72", "CL60", "CRJ1", "CRJ2", "CRJ7", "CRJ9", "CRJX",
  "DC91", "DH8A", "DH8B", "DH8C", "E135", "E145", "E170", "E45X",
  "E75L", "E75S", "F16", "F18H", "F18S", "F900", "FA7X", "GLF2",
  "GLF3", "GLF4", "SB20", "SF34",
];

const CWT_H: readonly string[] = [
  "ASTR", "B190", "B350", "BE40", "C560", "C56X", "C680", "C750",
  "CL30", "E120", "F2TH", "FA50", "GALX", "H25B", "LJ31", "LJ45",
  "LJ55", "LJ60", "SH36", "SW4",
];

const CWT_I: readonly string[] = [
  "BE10", "BE20", "BE58", "BE99", "C208", "C210", "C25A", "C25B",
  "C402", "C441", "C525", "C550", "P180", "PA31", "PAY2", "SR22",
  "SW3",
];

const TABLE: ReadonlyArray<readonly [CwtCategory, readonly string[]]> = [
  ["A", CWT_A], ["B", CWT_B], ["C", CWT_C], ["D", CWT_D], ["E", CWT_E],
  ["F", CWT_F], ["G", CWT_G], ["H", CWT_H], ["I", CWT_I],
];

const INDEX: ReadonlyMap<string, CwtCategory> = new Map(
  TABLE.flatMap(([cat, types]) => types.map((t) => [t, cat] as const)),
);

/**
 * Returns undefined for a type the FAA table does not list, deliberately.
 *
 * The legacy lookup this replaces defaulted an unknown type to "light", which
 * made it a light LEADER and attracted a 3 to 4 NM requirement. A default should
 * constrain least, not most, and an unmapped rate that cannot be seen is worse
 * than one that can. Callers decide what to do with undefined, and the sampling
 * harness counts it.
 */
export const cwtFromType = (icaoType: string | undefined): CwtCategory | undefined =>
  icaoType ? INDEX.get(icaoType.toUpperCase()) : undefined;

export const CWT_TYPE_COUNT = INDEX.size;
