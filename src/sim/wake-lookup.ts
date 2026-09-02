// Legacy four-class wake lookup. As of the CWT migration (docs/cwt-migration.md)
// the wake DOCTRINE no longer reads this: separation comes from the CWT table in
// rules.ts keyed by cwtFromType. This lookup still feeds the legacy `wake` field
// used for gate compatibility and display.
import { cwtFromType } from "./cwt-lookup";
import type { CwtCategory } from "./types-cwt";
import type { WakeCategory } from "./types";

// Kept in step with the CWT table, which is the doctrinal one: every type it
// places in category A belongs here. A225 sat in HEAVY below while the CWT
// table had it in A, so the two tables in this repository disagreed about the
// same aircraft. A test compares them now rather than trusting this comment.
const SUPER = new Set(["A388", "A38F", "A225"]);
const HEAVY = new Set([
  "A332", "A333", "A338", "A339",
  "A342", "A343", "A345", "A346",
  "A359", "A35K",
  "B742", "B743", "B744", "B748", "B74F", "B74R", "B74S",
  "B752", "B753", "B75F",
  "B762", "B763", "B764", "B76F",
  "B772", "B773", "B77L", "B77W", "B77F",
  "B788", "B789", "B78X",
  "MD11", "DC10", "L101",
  "A124",
  "IL76", "IL96",
]);
const MEDIUM = new Set([
  "A318", "A319", "A320", "A20N", "A321", "A21N",
  "B712",
  "B736", "B737", "B738", "B739", "B37M", "B38M", "B39M",
  "B722",
  "MD80", "MD82", "MD83", "MD87", "MD88", "MD90",
  "E170", "E175", "E190", "E195", "E290", "E295",
  "CRJ7", "CRJ9", "CRJX",
  "AT72", "AT43", "AT45", "AT75",
  "DH8D", "DH8C",
]);

/**
 * The four-class label shown on the strip and the detail card. Not doctrine:
 * separation reads the CWT table, and rules.ts never touches this field.
 *
 * The enumerated sets below were the whole answer, and anything absent fell to
 * "light", which is the lightest class rather than an unknown one. That put 27
 * of the 60 Super, Heavy and B757 types the CWT table knows on the display as
 * LIGHT, including both 747 variants it lists, the A300 and A310 family, the
 * Beluga and the DC-8s. A 747 on the flight strip read LIG.
 *
 * So the CWT table is consulted first, and the sets remain as the fallback for
 * the types it does not carry. Deriving the label from the doctrinal table
 * rather than extending a second list by hand is what stops the two drifting
 * again, which is the fault this pair has now produced twice.
 */
// Keyed over the CWT union, not over string, so a category added to the
// doctrine table fails the typecheck here rather than silently falling through
// to the enumerated sets below. Written as a bare string map earlier the same
// day, which is the defect this file's neighbour was corrected for an hour
// later; the lesson did not travel until the sweep found it here too.
const FROM_CWT: Record<CwtCategory, WakeCategory> = {
  A: "super",
  // B, C and D are the heavy families. E is the B757, which the four-class
  // scheme has no room for and which this table has always called heavy.
  B: "heavy",
  C: "heavy",
  D: "heavy",
  E: "heavy",
  F: "medium",
  G: "medium",
  H: "light",
  I: "light",
};

export const wakeFromType = (icaoType: string | undefined): WakeCategory => {
  if (!icaoType) return "medium";
  const t = icaoType.toUpperCase();
  const cwt = cwtFromType(t);
  if (cwt && FROM_CWT[cwt]) return FROM_CWT[cwt];
  if (SUPER.has(t)) return "super";
  if (HEAVY.has(t)) return "heavy";
  if (MEDIUM.has(t)) return "medium";
  return "light";
};
