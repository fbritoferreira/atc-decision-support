# Proximity warnings: first read from the per-pair dump

Status: the open half is settled, 2026-09-01. The original reading was partial,
39 pairs from an incomplete window, waiting on the cross-track column to
separate in-trail geometry from diagonal. That column has been collected across
every window since, and the answer is at the end of this note: the 44 per cent
in-trail bucket below was an upper bound roughly twice the measurement.

## What the dump shows

39 proximity-envelope pairs at KATL, KORD and KDFW. Every one is arrival against
arrival. **Zero are critical**, which is the convergence test of Section 2 doing
exactly what it was added for: a distance box alone would have escalated some of
these, and no pair here is closing.

Median horizontal separation is 1.48 NM, against a warning envelope of 2 NM.

## Splitting the population

A 3 degree glideslope descends about 318 ft per nautical mile, so two aircraft in
trail on one localiser separate vertically in proportion to their spacing.
Grouping the pairs by the ratio of vertical to horizontal separation:

| profile | pairs | share |
|---|---|---|
| 200 ft/NM or more, consistent with in trail on the glideslope | 17 | 44 per cent |
| 80 to 200 ft/NM, ambiguous | 12 | 31 per cent |
| under 80 ft/NM, consistent with abreast | 10 | 26 per cent |

The flattest pairs are unambiguous. DAL632 and DAL2818 at Atlanta appear at 1.21
NM horizontal with **0 ft** of vertical separation, and again at 1.31 NM with 25
ft. ENY3393 and MRA662 at Dallas Fort Worth, 1.27 NM and 25 ft. Two aircraft at
the same altitude more than a mile apart cannot be in trail on a single
localiser, because in trail on an approach means separated along a descending
path. They are on adjacent parallels.

So **at least a quarter of proximity warnings are simultaneous parallel
approaches**, which is ordinary high-density operations and not a conflict. That
is a floor, not an estimate.

## Where this read is weak, stated plainly

The ratio cannot separate two aircraft in trail on one localiser from two aircraft
diagonally offset across adjacent parallels. A diagonal pair has both cross-track
and along-track separation, and its vertical profile follows only the along-track
part, so it can present the same ratio as a true in-trail pair. The 44 per cent
bucket is therefore an upper bound on in-trail, not a measurement of it.

This is the limitation the cross-track column was added for: an in-trail pair
differs almost entirely along-track, an abreast pair almost entirely cross-track,
and a diagonal pair splits between them. That column is in the harness now and
takes effect on the next window.

## The other half of the problem

The 17 pairs with an in-trail profile sit at a median horizontal separation well
under the 3 NM radar minimum, which is implausible as real traffic at these
fields for the same reason the wake pairs were. See wake-floor-finding.md: the
same 2.5 against 3 NM conflation and the same absence of any measurement-error
allowance apply here, because proximity compares the same ADS-B positions against
the same kind of fixed threshold.

So proximity volume is likely two problems rather than one: parallel approaches
that should never have been paired, and a threshold applied to noisy positions
without tolerance. The first is a doctrine gate, the second is a constant. They
need separate fixes and separate measurement.

## The open half, settled 2026-09-01

Across the 7,288 proximity pairs carrying both components held in the twelve settled window dumps on this checkout, classifying by the
along-track share of total separation:

| geometry | share |
| --- | --- |
| in-trail (along-track 80 per cent or more) | 19.6 per cent |
| diagonal | 68.7 per cent |
| abreast (along-track 20 per cent or less) | 11.7 per cent |

So the 44 per cent bucket above overstates in-trail by roughly a factor of two,
which is what an upper bound is for and is the reason it was labelled one.
Diagonal pairs are the majority of the envelope, and they are the geometry the
ratio alone cannot distinguish.

The 80/20 split is a stated choice rather than a doctrinal boundary, and the
conclusion does not depend on it: at 70/30 in-trail is 25.7 per cent, at 90/10
it is 12.0, at 95/5 it is 7.4, on the pool as it stood on
2026-09-01. Every threshold puts in-trail below the 44 per
cent bound and leaves diagonal dominant, so the direction is a property of the
data rather than of where the line was drawn.
