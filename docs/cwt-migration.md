# Migrating the wake model from legacy weight classes to CWT

Status: implemented 2026-08-21. The running tuned10 window is unaffected
because its collector loaded modules at start; the first live measurement under
CWT is the next window. Scenario corpus and negative controls emit identically
under both schemes (measured, Table 1 unchanged), so only the live wake figures
need re-measuring.

Implementation notes, where they differ from the plan below:

- The category is derived from `Flight.aircraft` at the point of use via
  `cwtFromType`, not stored on the flight. `WakeCategory` did NOT widen: the
  legacy field still drives gate compatibility and display, and the doctrine
  no longer reads it. One source of truth for the category (the type
  designator), no schema churn, and the two schemes cannot be mixed silently
  because they never meet.
- Pairs with either type unmapped fall to the radar floor, and the harness
  counts unmapped aircraft per snapshot in a new `n_cwt_unmapped` summary
  column. The wake dump gained `lead_type,lead_cwt,trail_type,trail_cwt`.
- The baseline carries the identical CWT table inline, per item 3.
- One test needed its ETA tie broken: with equal ETAs the leader is whichever
  aircraft the stream clustering ordered first, which had silently made a C208
  the leader of a B752 and blanked the cell under test.

## Why

The detector's wake model uses four legacy weight classes (super, heavy, medium,
light). The FAA replaced that scheme with Consolidated Wake Turbulence, a nine
category system, and the paper's largest finding is about the wake model. A
reviewer is entitled to say the finding is a doctrine generation out of date.

## Authority, and a citation trap

Cite **FAA Order JO 7110.65, paragraph 5-5-4 and TBL 5-5-2**. CWT was
incorporated into JO 7110.65 itself, and the standalone JO 7110.126 series is
cancelled: 126 (cancelled 2018-06-28), 126A (cancelled 2019-08-28), and 126B
(cancelled, content folded into 7110.65).

So do not cite 126B as live doctrine. The table below was extracted from 126B
because that document reproduces it legibly, but the authority is 7110.65.

## CWT categories

| Cat | Definition |
|---|---|
| A | A388 and A225 |
| B | Pairwise Upper Heavy |
| C | Pairwise Lower Heavy |
| D | Non-Pairwise Heavy |
| E | B757 |
| F | Upper Large excluding B757 |
| G | Lower Large |
| H | Upper Small, MTOW above 15,400 lb |
| I | Lower Small, MTOW 15,400 lb or less |

## TBL 5-5-2, ON APPROACH minima, nautical miles

Leader down the side, follower across. Blank means no wake-specific minimum
applies, so standard radar separation governs.

| leader | A | B | C | D | E | F | G | H | I |
|---|---|---|---|---|---|---|---|---|---|
| A |  | 5 | 6 | 6 | 7 | 7 | 7 | 8 | 8 |
| B |  | 3 | 4 | 4 | 5 | 5 | 5 | 5 | 6 |
| C |  |  |  |  | 3.5 | 3.5 | 3.5 | 5 | 6 |
| D |  | 3 | 4 | 4 | 5 | 5 | 5 | 6 | 6 |
| E |  |  |  |  |  |  |  |  | 4 |
| F |  |  |  |  |  |  |  |  | 4 |
| G |  |  |  |  |  |  |  |  |  |
| H |  |  |  |  |  |  |  |  |  |
| I |  |  |  |  |  |  |  |  |  |

**Read the blanks carefully.** A blank is not zero separation. It means no wake
requirement beyond the radar minimum, which is 3 NM, or 2.5 NM on final under
the conditions 7110.65 specifies. The current model's 3 NM floors are therefore
approximately correct for blank cells, which narrows the size of this migration
considerably from a first reading.

## Two concrete errors in the current model

**1. B757 is classified heavy.** `wake-lookup.ts` puts B752, B753 and B75F in
the HEAVY set. CWT gives the B757 its own category E precisely because its wake
does not behave like a heavy's. On approach, an E leader imposes a requirement
only on a category I follower, at 4 NM. The current model demands 5 NM for a
B757 followed by anything medium, so it over-constrains a type that
operates at every major US field, by about 2 NM against the radar minimum. This is the clearest single case and worth
reporting whether or not the full migration lands.

**2. Unknown types default to light.** `wakeFromType` returns "light" for
anything outside its 77-type table. Business jets and general aviation are
common at the sampled fields, so an unknown type becomes a light leader and
attracts a 3 to 4 NM requirement. Under CWT most of those are H or I, and an H
or I leader carries no wake requirement at all. The default should be the
category that constrains least, not most, and unmapped types should be counted
so the rate is visible rather than silent.

## Measured disagreement between the two models

Extracted TBL A-1 gives 161 type-to-category assignments against the legacy
lookup's 77 types. Comparing the leader requirement each model imposes against
an Upper Large follower, taking a blank CWT cell as the 3 NM radar floor:

| type | legacy class | CWT category | legacy requirement | CWT requirement |
|---|---|---|---|---|
| B752, B753 | heavy | E | 5 NM | 3 NM |
| B762, B763, B764 | heavy | C | 5 NM | 3.5 NM |
| DC10, MD11 | heavy | C | 5 NM | 3.5 NM |

Seven common leader types are over-constrained by 1.5 to 2 NM. The B757 pair is
the sharpest case, since CWT created category E for the B757 specifically, and
the legacy model's answer is the one CWT was written to replace.

**Twenty-one legacy types are absent from the FAA table**, and the list matters
because it is not a tail of exotica: A20N, A21N, B37M, B38M, B39M are the neo and
MAX families, and A38F, B74F, B75F, B76F, B77F are freighter variants. TBL A-1
dates from 2021. Do not guess their categories from the aerodynamically similar
base type, which is the same reasoning the legacy weight classes already use and
the reason they are wrong. Either source a current assignment or leave them
unmapped and count them, so the unmapped rate is visible in the measurement
rather than absorbed into a default.

Expected effect on re-measurement: fewer wake violations among heavy leaders,
concentrated on B757 and the B767/DC10/MD11 group. That is a candidate partial
explanation for the residual violation rate, and it is checkable rather than
speculative, because the affected types are identifiable per pair in the wake
dump.

## What implementing this needs

1. A type to CWT category table. Categories A and E are per-type and easy. B, C
   and D are the pairwise heavy split, which needs the FAA pairwise list rather
   than a guess; do not approximate it, because guessing the split is what the
   legacy model already does wrong.
2. `WakeCategory` widens from four values to nine. It appears in `Flight`,
   `Gate.maxWake`, the scenarios and the baseline, so the change is broad but
   mechanical.
3. The monolithic baseline gets the identical table, or the architectural
   comparison measures a doctrine difference instead of a structural one.
4. Every scenario's expected output must be re-derived, and the incident corpus
   re-run. Comair 5191 and the wake-violation scenario both depend on specific
   requirement values.

## When to land this

**Not while a sampling window is running.** It changes detector output, so a
window spanning the change measures neither version. Land it after the current
window closes, then re-measure before quoting any wake number, because Table 4
and the margin distribution both move.

Expected direction: fewer wake violations, because the legacy model
over-constrains B757 leaders and unknown-type leaders. That makes it a candidate
explanation for part of the residual violation rate the paper currently reports
as an artifact, alongside the missing measurement-error allowance.
