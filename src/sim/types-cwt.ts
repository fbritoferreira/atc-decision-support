/**
 * FAA Consolidated Wake Turbulence categories, JO 7110.65 paragraph 5-5-4.
 *
 * Separate from the legacy `WakeCategory` in types.ts on purpose: both exist
 * during the migration described in docs/cwt-migration.md, and a single union
 * carrying nine CWT letters plus four legacy weight classes would let the two
 * schemes be mixed silently in the same comparison.
 */
export type CwtCategory = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I";
