# The suppression layer stopped mattering live, and nothing noticed

Status: measured 2026-08-25. No code change proposed. The finding is about
what a correction elsewhere did to a feature here, and about a figure in both
papers that describes a system state which no longer exists.

## The measurement

Share of emitted alerts that arrived pre-subsumed, per window:

| window | alerts | suppressed | share | critical runway-conflict alerts |
|---|---|---|---|---|
| KJFK, 03-04 August, untuned | 4,657 | 692 | 14.9% | (crosstab not yet in the harness) |
| tuned12, three fields, corrected | 4,958 | 15 | 0.3% | 0 |
| tuned13, three fields, corrected | 8,501 | 1 | 0.01% | 0 |

## Why

`applySuppression` triggers on a critical alert carrying a runway id, and the
declared pairs all require a critical runway-conflict. Live windows under the
corrected doctrine emit zero critical runway-conflict alerts, so the trigger
never occurs and the layer has nothing to do.

That is a direct consequence of a correction reported elsewhere in the paper.
The doctrine that produced most of those criticals, a critical for "multiple
arrivals on final to the same runway", was withdrawn as false: a continuous
in-trail arrival stream is the normal state of a busy field. Withdrawing it
was right. Its side effect was to remove the only condition that fires the
suppression layer on live data, and nothing in the test suite or the
measurement pipeline reported that, because both were watching suppression
work rather than watching whether it ran.

## What this does and does not mean

It does NOT mean the layer is dead machinery. Two scenarios exercise it, the
`runway-conflict` synthetic and the Linate reconstruction, and its unit tests
are real rather than vacuous. A generic caveat about untested code does not
apply here.

It DOES mean the operator-view figure both papers quote, that suppression cuts
the operator's view from 1.93 to 1.64 alerts per snapshot, describes the
untuned August system. Under the corrected doctrine the operator view and the
raw alert count are within one alert of each other across a whole
twenty-four-hour window. Quoting the 14.9 per cent without that context claims
a live benefit the current system does not deliver.

The general shape is worth keeping, because it is not the same as the earlier
findings and is easy to confuse with them. This is not a feature that never
ran, nor a test that passed vacuously. It is a feature whose trigger was
removed by a correction two doctrines away, leaving both the feature and its
tests entirely healthy while its live effect went to zero. Nothing that
watches correctness can see that; only something that watches frequency can.

## A measurement error worth recording

The first scan for this finding reported zero suppressed alerts across the
entire scenario corpus, which would have made the layer look untested as well
as inert. That was wrong: the scan filtered on a field name the `Alert` type
does not have, `subsumedBy` instead of `suppressedBy`, so every alert failed
the predicate silently. The corrected scan finds the two scenarios above.

A filter on a misspelled field returns an empty set rather than an error, and
an empty set reads as a finding. This is the same failure mode as the harness
that reimplemented the detectors it claimed to import, and as the negative
controls that asserted silence without running the doctrine: the measurement
looked like it worked. It was caught only because the result disagreed with a
passing test that asserts the opposite, which is the argument for keeping
assertions that would be redundant if everything were consistent.
