# What removing the departure blind spot cost, measured

Status: measured 2026-08-26 on tuned14, the first window under the corrected
proximity filter, hour-matched against tuned13. The fix was right and its cost
is real, and the cost has a structural cause rather than a threshold cause.

## The prediction, and what happened

The design record for the blind-spot fix recorded a prediction before the
window ran: proximity volume should rise, because a traffic class was added to
the detector with the largest volume, and most arrival-versus-departure pairs
would be non-converging and therefore outside the parallel-approach demotion.
It said that if volume did not rise, something else was wrong.

Volume rose. Per thousand aircraft, hour-matched: proximity 114.8 to 133.3 at
Atlanta, 92.6 to 148.7 at O'Hare, 79.2 to 151.1 at Dallas Fort Worth.
Departures now account for 3,352 of 7,548 pairs, 44 per cent of the population.

What the prediction did not anticipate is that criticals rose too, and sharply:
1.4 to 1.9 per thousand aircraft at Atlanta, 1.1 to 2.6 at O'Hare, and 0.9 to
3.9 at Dallas Fort Worth. Warnings rose between 176 and 362 per cent. A
prediction that gets the direction right and misses a fourfold move in the
tier that matters most is a prediction that was not specific enough, and this
record exists partly to say so.

## Where the new criticals come from

| pair kind | pairs | critical | rate |
|---|---|---|---|
| arrival to arrival | 4,196 | 77 | 1.8% |
| departure to arrival | 1,949 | 62 | 3.2% |
| departure to departure | 1,403 | 52 | 3.7% |

Departure-involved pairs reach critical at roughly twice the arrival-to-arrival
rate. The largest single phase combination in the whole population is two
airborne departures, 1,403 pairs at a median 1.32 NM and 350 ft.

Two readings are available and the second is better supported. Either
departures genuinely converge more often, which is plausible while climbing
through each other's altitudes, or the detector has no doctrine for departure
separation and therefore cannot tell procedural separation from conflict.

The second is the same shape as a finding this project has already made and
fixed on the arrival side. Arrival-to-arrival volume turned out to be 71 per
cent simultaneous parallel approaches, ordinary operations that the detector
was calling conflicts, and the fix was to demote the non-converging
distinct-parallel case. Successive departures are separated by doctrine too:
JO 7110.65 separates them by diverging courses or by time intervals depending
on category and runway, and this detector models neither. A departure pair 1.3
NM apart on diverging courses is the ordinary state of a busy field, exactly as
two aircraft abreast on parallel finals was.

## Why the same fix cannot be applied

The arrival-side false-positive class was identifiable because arrivals carry a
runway attribution: the parallel-approach demotion works by comparing the two
aircraft's assigned runways. Departures carried no attribution at all when this
was written: live ingest assigned runways only to arrivals, recorded in
`phase-vocabulary-audit.md` as the reason the runway-identity doctrine cannot
fire live. Both clauses are past tense now. Airborne departures have been
attributed since 2026-08-26, and the identity doctrine still cannot fire, on the
narrower fact that the departures it reads are the ones at altitude zero, which
ingest labels queued and leaves unattributed. The limit had this second
consequence: the departure population cannot
be triaged the way the arrival population was, because the discriminator does
not exist in the data.

So the honest position is that removing the blind spot traded an unmeasurable
gap for a measurable false-positive source, and that the trade is still correct.
A detector that cannot see airborne departures is wrong in a way that no volume
figure excuses; the Potomac reconstruction detecting its own collision only
because of a phase label is the demonstration. But the cost is now quantified
rather than assumed, and closing it needs departure runway attribution, which
needs either flight-plan-correlated tracks from a facility or an inference
built from departure geometry and the runway coordinates that landed with the
centreline work.

## What to do next, in order

1. Report the measured cost in both papers, including the critical rise, rather
   than reporting only the confirmed prediction.
2. Attempt departure runway attribution from the extended-centreline geometry
   already in the registry. A departure climbing out is close to its runway's
   extended centreline for the first miles, which is the same geometry the
   arrival attribution uses, run backwards. If that works, the same
   diverging-course test the doctrine uses becomes computable.
3. Only then consider a demotion, and measure it the same way.

Nothing here justifies re-hiding the departures.
