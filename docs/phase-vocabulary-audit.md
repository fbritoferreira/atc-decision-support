# What phases live ingest produces, and what the detectors expect

Status: audited 2026-08-25, after the departure blind spot
(`departure-proximity-blindspot.md`) showed that a detector's phase gate can
silently exclude a whole traffic class. That defect was found by accident. This
document is the systematic version, because the same mismatch can exist in any
of the eleven detectors and nothing had checked.

## The declared vocabulary against the produced one

`FlightPhase` declares nine values. Live ingest assigns phase in one
expression per traffic type (`live-adsb.ts`): arrivals through
`phaseFromAlt(alt, gs, dist)`, departures as `queued` when altitude is zero and
`departed` otherwise. The reachable set is therefore:

| phase | produced live? | by what |
|---|---|---|
| `queued` | yes | arrival or departure at zero altitude, ground speed below 30 kts |
| `taxi-out` | yes | ARRIVAL at zero altitude with ground speed at or above 30 kts |
| `final` | yes | arrival below 2,000 ft within 5 NM |
| `approach` | yes | arrival below 6,000 ft within 20 NM, and the fallback for anything unmatched |
| `enroute` | yes | arrival above 25,000 ft |
| `departed` | yes | departure at any non-zero altitude |
| `landed` | **never** | nothing assigns it |
| `at-gate` | **never** | nothing assigns it |
| `taxi-in` | **never** | nothing assigns it |

Two consequences follow immediately, and neither was documented before this
audit.

**A landed arrival is labelled `taxi-out`.** An aircraft that has touched down
and is rolling out has zero altitude and a ground speed well above 30 kts, so
`phaseFromAlt` returns `taxi-out`, a phase whose name describes the opposite
manoeuvre. Nothing currently misbehaves because of it: the runway-identity
doctrine, which gates on `queued` or `taxi-out`, also requires
`type === "departure"`, and the rollout aircraft is typed as an arrival. The
protection is a second condition rather than the phase itself, which is worth
knowing before anyone relaxes that condition.

**Every exclusion of `landed`, `at-gate` or `taxi-in` is inert on live data.**
Five detectors carry such exclusions. <!-- claim-verified: a subset of the population, not a count of it; five of the eleven carry phase exclusions -->
They do nothing at all live, and this
section used to add that they are "correct for the scenario corpus, which does
use those phases". Measured on 2026-08-31, the corpus uses one of the three.
Across all 28 scenarios `at-gate` appears once, `taxi-in` never, and `landed`
never.

So `landed` is a declared phase that nothing in this project can produce.
`phaseFromAlt` cannot return it, since altitude zero yields `queued` or
`taxi-out` and everything else is airborne, and departures are typed `queued` or
`departed` without consulting it. Seven lines across the detectors test for it
anyway. They are not wrong, and they are exercised by nothing: neither a
scenario nor a live window can make any of them take its other branch.

That is worth stating rather than deleting the lines. A phase in the type that
no producer emits is either a gap in the corpus or a gap in the vocabulary, and
which one it is depends on whether a rollout aircraft ought to be modelled. If
it should, the corpus needs a scenario and `phaseFromAlt` needs a branch. If it
should not, `landed` should leave `FlightPhase` and take the seven exclusions
with it. Until that is decided, the exclusions stay and this paragraph records
that they are dead rather than defensive.

## Where the gates and the vocabulary disagree

| detector | phase gate | live fit |
|---|---|---|
| wake-spacing | `approach` or `final`, plus alignment | fits |
| runway-conflict | arrivals on `final` against departures `queued` or `taxi-out` | departures live are only ever `queued`, so the `taxi-out` half is scenario-only |
| runway-identity | departures `queued` or `taxi-out` | **structurally dead live**, and the reason given here until 2026-09-01 was out of date: ingest has attributed airborne departures since 2026-08-26. It does not attribute departures at altitude zero, which it labels `queued`, and those are the phases this doctrine reads, so the conclusion holds on a narrower fact than the one stated. Already reported in the paper |
| gate-conflict | `queued` or `taxi-out` | fires on live data only for aircraft that are, live, either ground traffic or landed arrivals; gate assignment itself is synthesised, so the doctrine cannot fire live regardless |
| fuel-hold | excludes `landed`, `at-gate` | inert exclusion. **The doctrine does fire live**, which this row denied: fuel is synthesised from the raw ETA at ingest, then `smoothEtas` overwrites `etaMin` before the detectors run and leaves `fuelMin` alone, so a warning fires once the blended ETA exceeds the synthesis value by 15 minutes. Criticals are unreachable through the 60-minute ETA cap, not through the synthesis; 19 were measured before that cap existed |
| crosswind | none, runway-scoped | fits |
| weather-shift | excludes `at-gate`, `landed`, `departed` | the `departed` exclusion means an airborne departure is not counted among the aircraft affected by low visibility. Defensible, since it is climbing away from the field, and stated here rather than assumed |
| runway-surface | same exclusions | same reading: a departure already airborne has left the surface |
| squawk-emergency | excludes `at-gate`, `landed` | inert exclusion, doctrine fits |
| cascading-delay | arrivals with ETA under 30 min, excludes `landed`, `at-gate` | fits |
| proximity | excludes `at-gate`, `departed`, and zero altitude | **the blind spot**: excludes the entire airborne departure population. Fix sequenced after the current window |

## What the audit changes

One finding of substance, the proximity exclusion, already recorded
separately. Two facts now stated rather than assumed: the `taxi-out` label on
landed arrivals, and the inertness of three phases live. And one guard: the
test suite pins the reachable phase set, so if the ingest heuristic starts
producing a phase this table does not account for, the audit fails loudly
instead of going quietly out of date.

The generalisable point for the paper is that a scenario corpus written in the
full declared vocabulary cannot exercise the subset a live feed produces, and
the gap between the two is invisible to both the tests and the live
measurement. That is the same shape as the runway-identifier defect, where
inferred labels did not match registry ids, and it is now the second instance
of it.
