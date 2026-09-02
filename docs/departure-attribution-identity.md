# Attributing departures exposed a units mismatch in the identity doctrine

Status: found and contained 2026-08-26, while building departure runway
attribution. The attribution shipped, scoped to airborne departures. The
doctrine defect it exposed is pinned by a test and not yet fixed, because
fixing it properly is a data-model change.

## Why departures were being attributed at all

Removing the departure exclusion from the proximity walk made the whole
departure population visible, and the measurement that followed
(`departure-fix-cost.md`) found departure-involved pairs reaching critical at
roughly twice the arrival-to-arrival rate, with two airborne departures the
largest group in the population. The arrival side had an equivalent
false-positive class, simultaneous parallel approaches at 71 per cent of
volume, and it was triaged by comparing the two aircraft's assigned runways.
Departures could not be triaged that way because live ingest gave them no
runway. Attribution closes that gap in the data rather than adding a threshold.

The geometry is the arrival method run backwards. An arrival sits on the
approach side of a threshold, so its along-track distance is positive; a
departure has crossed the threshold it left, so its along-track distance is
negative. Both fly the end's course and both sit near the same extended
centreline. The only differences are the sign of one scalar and a cap, set at
8 NM, on how far past the threshold to keep looking before a turn on course has
probably happened.

## The defect this exposed

Attributing a departure still on the takeoff roll produced a **false critical
runway-identity alert**, measured at KBOS:

- 04L's coordinate-derived true course is about 020 degrees.
- The registry's stored heading for that strip is 44 degrees.
- Attribution compares the aircraft's heading against the TRUE course, inside a
  30-degree gate, so an aircraft tracking 020 is correctly attributed to 04L.
- The identity doctrine compares the same heading against the REGISTRY heading,
  inside a 20-degree gate. 020 against 44 is 24 degrees, over tolerance.

An aircraft correctly lined up on the runway it was cleared for is therefore
reported as rolling on the wrong one, at critical severity. That is the worst
possible false positive for that doctrine: it is the alert a controller would
act on immediately.

The cause is not the KBOS data alone, though that data is wrong: the phase
vocabulary audit already recorded that runway names and registry headings are
magnetic while ADS-B tracks are true, and that magnetic variation reaches 13
degrees at the New York fields. Any comparison of the two inside a 20-degree
gate is one bad datum away from firing. KBOS simply supplies the bad datum.

## What was done, and what was not

Live ingest now attributes arrivals and AIRBORNE departures, and not departures
on the ground. That is the scope the attribution was built for, since the
purpose is triaging airborne proximity pairs, and a ground departure gains
nothing from a runway label here. The identity doctrine gates on ground phases,
so with this scoping it remains unreachable on live data exactly as the phase
audit already described, and the false critical cannot occur in production.

The defect is not fixed. A test pins it: it asserts that KBOS 04L's true course
and registry heading differ by more than 20 degrees, that attribution picks 04L
for an aircraft tracking the true course, and that the identity doctrine then
emits a critical. If someone later attributes ground departures, or narrows the
attribution gate, that test fails and says why.

## Fixed 2026-08-29

`Runway` now carries `trueCourseDeg`, the coordinate-derived true course of the
strip's first-named end, and `runwaysWithTrueCourse(airport)` in
`runway-geometry.ts` attaches it wherever surveyed thresholds exist. Live mode
builds its runway list through that function. `resolveRunway` resolves the
course for the requested end with the same reciprocal rule it already applied to
the magnetic heading, and the identity doctrine compares against
`trueCourseDeg ?? headingDeg` on both sides of the check.

The fallback matters as much as the field. Scenario runways are written by hand
and carry no coordinates, so they keep comparing magnetic against magnetic,
which is internally consistent and leaves all twenty-eight scenarios unchanged.

The pinning test was inverted rather than deleted. It now asserts that with true
courses attached the aircraft on 04L's true course draws no alert, and that with
the raw registry runways the old false critical returns. The second half is
there because the fallback is a real code path: it documents why the field
exists and fails loudly if the doctrine ever stops preferring it.

**Live output is unchanged, which was checked rather than assumed.** The field is
read in exactly two places, both inside the identity doctrine, and that doctrine
gates on the `queued` and `taxi-out` phases. Live ingest assigns runways only to
arrivals and airborne departures, so it remains unreachable on live data exactly
as before. The change was made while a 24-hour measurement window was running,
and this is why that was safe.

**What is still not done.** Boston's registry headings are still wrong: 04L is
stored as 044 against a published ILS course of 035 and a coordinate-derived
true course of 020. Correcting them from the coordinates would change
attribution and the cross-track axis on live data, so it waits for a gap between
windows. The doctrine no longer depends on that correction.

## The fix, when it was worth doing

Carry the coordinate-derived true course on the runway record, generated by
`scripts/gen-runway-geometry.py` alongside the threshold coordinates it already
produces, and have the identity doctrine compare against that. Then both sides
of the comparison are true courses from the same source, the 20-degree gate
means what it says, and ground departures can be attributed without hazard.
That also lets the registry's wrong KBOS headings be corrected from the
coordinates rather than left as a documented trap.

It is not done here because it changes a shared data structure while a
measurement sequence is in progress, and because the containment above removes
the live hazard. It belongs with the next data-model change rather than bolted
onto an attribution fix.
