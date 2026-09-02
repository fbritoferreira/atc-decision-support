# The proximity detector cannot see airborne departures

Status: found 2026-08-25 by auditing whether each negative control exercises
the doctrine it asserts silence on. FIXED 2026-08-25 once the tuned13 window
closed, in both the detector population and the monolithic baseline. The three
tests that pinned the defect inverted, as they were written to; two now assert
the fixed behaviour and the third is unchanged.

Corpus effect: none. Alert counts and severities are identical across all
twenty-eight scenarios, because the scenarios that would expose the exclusion
encode their departures in phases the filter already admitted. That is the
finding restated: the defect was reachable only from live data, which is why a
passing corpus could not see it.

What changed for the two affected controls. The IAH control now forms the
candidate pair it was written to form, and its silence comes from the 1,000 ft
vertical boundary rather than from its departure never entering the walk. The
Potomac reconstruction now raises its proximity alert whether its helicopter
is encoded `enroute` or `departed`, so the flagship case no longer depends on
an encoding choice.

The live re-measurement is the next window's work, and the expectation is
recorded here before it runs: proximity volume should RISE, because a traffic
class was added to the detector with the largest volume, and most
arrival-versus-departure pairs will be non-converging and therefore outside
the parallel-approach demotion, which only covers pairs on distinct parallel
runways. If volume does not rise, something else is wrong.

## The exclusion

`detectProximityConflict` and the candidate enumeration both filter to

```
f.phase !== "at-gate" && f.phase !== "departed" && f.altitudeFt > 0
```

`at-gate` and the altitude floor are right: an aircraft on a stand or on the
ground is not in an airborne conflict. `departed` is not right. In this model
`departed` means airborne and climbing out, which is exactly the state in
which a departure can conflict with an arrival descending through the same
altitude. The filter therefore removes a whole traffic class from the only
detector that models mid-air proximity.

## How it was found, and why it took this long

The corpus has now hit the same defect class three times, each time one level
deeper:

1. 2026-08-18: six controls asserting silence formed zero WAKE pairs, so none
   exercised the wake detector.
2. 2026-08-25, first pass: four controls asserted silence while forming zero
   pairs of ANY kind. Fixed the visible half by exporting
   `proximityCandidatePairs`, which reports what the walk considered and which
   gate rejected it.
3. 2026-08-25, second pass: two of those four form zero candidates because
   their aircraft are removed before any gate runs. The silence they assert is
   real and means nothing.

A test that asserts silence passes identically whether the doctrine judged the
traffic safe or never saw it. The only defence is an assertion about the
inside of the walk, which is what the new enumeration provides.

## What it costs, measured on the corpus

- `negative-control-asrs-iah` (ASRS CALLBACK Issue 461, a departure level at
  2,000 ft with traffic crossing 1,000 ft overhead) forms no candidate pair.
  Its silence comes from the phase exclusion, not from the vertical boundary
  the control was written to exercise.
- `negative-control-converging-deps` forms no candidate pair either: one
  departure airborne and excluded by phase, one queued and excluded by the
  altitude floor. It has never exercised proximity on any axis.
- **The Potomac reconstruction survives only by an encoding choice.** PAT25 is
  encoded `type: "departure"` with `phase: "enroute"`, so it passes the
  filter. Re-encode the same aircraft as `departed`, which is what live ingest
  supplies for a departing rotor, and the reconstruction emits no
  proximity-conflict alert at all: the paper's opening example, the accident
  whose alert category the NTSB named, goes silent. A test now pins both
  halves of that.

Live ingest assigns `departed` to every departure it classifies (see
`live-adsb.ts`: an unclassified-arrival contact becomes `queued` at zero
altitude and `departed` otherwise), so on live data the exclusion applies to
the entire departure population, not to an edge case.

## The fix, and why it is not a one-line change

Dropping `departed` from the filter is one line. Landing it responsibly is
not, because it adds a traffic class to the detector that currently produces
the largest alert volume, and the effect on that volume is unknown until
measured. The sequence is:

1. Land after the tuned13 window closes, so no window spans the change.
2. Re-measure proximity volume per thousand aircraft, hour-matched, with the
   severity split, since arrival-versus-departure pairs will mostly be
   non-converging and the parallel-approach demotion does not cover them.
3. Expect the two affected negative controls to start forming candidate pairs
   and to keep asserting silence for the right reason. The three tests here
   invert, deliberately.
4. Consider whether the runway-conflict doctrine needs the same audit: it
   gates on phase too, and nothing has checked whether its phase set matches
   the states live ingest actually produces.

Item 4 is the general lesson. Every phase-gated detector is making an
assumption about the vocabulary live ingest supplies, and this project has now
been wrong about that twice: once when inferred runway labels did not match
registry strip ids, and once here.
