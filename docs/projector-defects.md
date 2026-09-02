# Three defects in the forward projector

Status: found 2026-08-20 by reading `projectFlight` against the paper's own
description of it. Fixed 2026-08-21, all three together. The running sampling
window is unaffected because the collector loaded its modules at start; the
re-measurement lands in the next window.

## An inconsistency in the write-up, since resolved

The paper used to describe the projector twice and the two did not agree.
Section 2 called it "the crudest possible projector" while Section 5.3 gave the
descent and climb profiles, which is a different thing from constant motion.
Section 2 no longer describes the projector at all; it reaches the projector
only through the situation-awareness levels, so the disagreement is gone and
this passage is history. Section 5.3 says "holds heading and ground speed
constant, applies an 800 fpm descent profile to arrivals on approach and a 1500
fpm climb profile to departures once rolling", and that sentence is now checked:
verify-paper-claims.mjs reads quotations attributed to a numbered section in the
present tense and fails when the words are not in the paper.

That wording is quoted from the paper as it stands. This document previously
quoted it as "assumes constant heading and ground speed, with a 800 fpm descent
profile for arrivals on approach", which was a paraphrase inside quotation
marks: the paper's verbs and prepositions differ, and it never wrote "a 800".

Section 5.3 is correct. `projectFlight` advances position by heading and ground
speed, applies a fixed vertical rate by phase, and decays `etaMin` and `fuelMin`
linearly. Section 2 understates the model. Understating is the safer direction to
be wrong in, but a reviewer reading both will notice, and the sentence should say
what the code does.

## Defect 1: queued departures climb without moving

The climb applies when `type === "departure"` and phase is `departed` **or
`queued`**. A queued aircraft is holding for takeoff clearance: speed zero,
altitude zero, on the ground.

Measured on the `runway-conflict` scenario:

| aircraft | present | +1 min | +3 min |
|---|---|---|---|
| SWA88, queued | 0 ft, speed 0, x = -1.0 | 1,500 ft, x = -1.0 | 4,500 ft, x = -1.0 |
| JBU621, queued | 0 ft, speed 0, x = -0.5 | 1,500 ft, x = -0.5 | 4,500 ft, x = -0.5 |

Both climb to 4,500 ft without moving, because position advances by speed and
their speed is zero. The projected state therefore contains aircraft hovering a
mile above the runway threshold. Anything reasoning about altitude, proximity
above all, is handed traffic that cannot exist.

Fix: gate the climb on `departed` alone. A queued aircraft has no trajectory to
project until it is rolling.

## Defect 2: aircraft descend to zero and disappear

Altitude is clamped with `Math.max(0, ...)`. An arrival on short final projected
three minutes at 800 fpm reaches 0 ft: DAL512 goes 900 ft, then 100, then 0.

That interacts badly with `detectProximityConflict`, which filters to
`altitudeFt > 0`. An aircraft projected to 0 ft is silently removed from proximity
detection at that horizon, so the longer horizons quietly lose exactly the
aircraft closest to landing. The loss is invisible, because no alert is emitted to
be missed.

Two candidate fixes, and the choice matters. Clamping to a small positive floor
keeps the aircraft in the population but invents an altitude. Better is to stop
projecting a flight once its projected ETA reaches zero: a flight that lands
within the horizon should leave the projection rather than be placed at an
imaginary altitude.

## Defect 3: phase never advances

`projectFlight` copies phase unchanged while mutating position, altitude, ETA and
fuel. The projected state is therefore internally inconsistent: an aircraft can be
`queued`, meaning stationary on the ground, at 4,500 ft. An arrival can be `final`
at 0 ft ten miles out.

Every phase-gated detector then reads state that cannot occur. Wake gates on
`approach` or `final`; runway conflict gates on `final` against `queued` or
`taxi-out`; the fuel and surface doctrines gate on phase too. None is wrong on its
own terms. They are being asked about a world that does not exist.

This is the deepest of the three, because the other two are arithmetic and this is
a modelling omission: the projector projects the continuous variables and not the
discrete state that gives them meaning.

## Why this matters more than it looks

The paper already lists the projector as its crudest component, but for the wrong
reason. The stated limitation is that a constant-heading model predicts position
poorly. The real limitation is that the projected state is not always a physically
possible state, which is a stronger objection and the one a reviewer will reach
for.

It also bounds what the predictive tier can claim. Projected alerts are already
demoted and never critical, which limits the damage. But the demotion was
justified by forecast uncertainty, not by the projected state being unphysical,
and that distinction belongs in the write-up.

## Sequencing

Fix all three together after the current sampling window closes, then re-measure.
Expect projected-alert counts to move, so any figure separating present from
projected alerts needs regenerating.

## What the fix changed, measured on the corpus

The climb now gates on `departed` alone. An arrival whose projected ETA reaches
zero leaves the projection instead of being clamped to an invented 0 ft. Phase
advances with projected ETA using the thresholds the engine already applies tick
by tick: approach inside ten minutes, final inside three. Departures keep their
phase, because nothing in the state says when a queued aircraft gets clearance.

Two scenario outcomes moved, in opposite directions, and both movements are the
fix working:

- **Tenerife loses its two projected proximity advisories** (3 alerts to 2).
  Both 747s are queued at 0 ft, which the proximity doctrine excludes. The old
  projector's queued climb lifted them to projected altitudes and re-admitted
  them, so the projected conflict the paper cited was an artifact of defect 1.
  The present-state critical runway conflict, the alert that matters for the
  incident, is untouched.
- **Linate gains a projected runway conflict at the three-minute horizon**
  (still 3 alerts, but the third is now a forecast of the collision geometry
  rather than a proximity echo). Phase advancement puts the arrival on final
  within the horizon, which arms the runway-conflict gate that phase-copying
  had kept cold.

One artifact removed, one true forecast surfaced, by the same change. The test
that used Tenerife as its dedup vehicle now builds a synthetic overtake pair,
because the condition it relied on no longer exists to be deduplicated.

Negative controls: 0 critical before, 0 critical after. Table 1 in both papers
regenerated.
