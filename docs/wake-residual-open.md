# The residual wake violations: what the full window settled, and what it did not

Status: SETTLED 2026-08-24. The `tuned9` findings below stand as the record of
how it was narrowed. The `tuned12` window (closed 2026-08-22, 154 candidates,
124 admitted, measured under the corrected wake table, corrected floor,
projector fixes and centreline attribution) supplied the two facts that ended
it, and the prior-art sweep supplied the doctrine:

- With cross-track recorded per pair, 45 of 46 remaining violations sit within
  0.02 NM of one localiser course: in-trail on a single approach, not
  parallel-pairing artifacts. And 45 of 46 violate the 2.5 NM radar floor,
  not a wake minimum; the corrected wake table was violated once. Legal share
  moved 11 per cent (tuned9, legacy doctrine) to 63 per cent.
- JO 7110.65 7-2-1: a trailing pilot who accepts visual separation (or a
  visual approach following traffic) voids the radar minima for the pair, and
  the acceptance is a voice-channel event no surveillance feed carries.
  Every admitted pair in both windows, 189 and 124, formed under VFR. The
  residual was legal visual-approach spacing read as violation.

The detector now caps a radar-floor violation at warning under VMC and states
why (rules.ts, `visualSeparationMayApply`); a stated wake minimum keeps its
severity in every condition. The remaining test is the contrast: the
hypothesis predicts a lower violation rate under IMC, both windows were
essentially all-VFR (two MVFR snapshots in 1,823), and no IMC window has been
sampled. OpenSky historical access would allow choosing an IMC day on purpose;
see the prior-art gap analysis in the documents checkout.

## Confirmed: the model applies the wrong floor

Of the 189 admitted pairs, **158 carry a 3 NM requirement**, and the category
mix is dominated by medium behind medium (110), light behind medium (24), medium
behind light (21) and light behind light (15). These are exactly the pairs for
which the CWT approach table imposes no wake minimum at all, so the governing
figure is the radar minimum rather than a wake minimum.

Substituting the radar minimum doctrine authorises on final, 2.5 NM, for the 3 NM
floor the detector applies:

| radar floor used | pairs judged legal |
|---|---|
| 3.0 NM, as the detector does | 21 of 189, 11 per cent |
| 2.5 NM, as doctrine authorises on final | 81 of 189, 43 per cent |

A fourfold change in the headline from correcting one constant. This is the
single largest correction available and it confirms the diagnosis in
`wake-floor-finding.md`.

## Rejected: measurement error accounts for the rest

It does not. Of the 108 pairs still violating at a 2.5 NM floor, only 31 per cent
sit within 0.5 NM of the floor, and the median deficit is **1.17 NM**. ADS-B
position error is a few hundred feet, not a nautical mile. Seventy-five pairs, 40
per cent of those admitted, are more than 0.5 NM inside the floor and cannot be
explained by noise.

## Rejected: general aviation and uncorrelated targets

The smallest gaps looked like a GA artifact: pairs 0.02 to 0.04 NM apart with
ETAs four to ten minutes apart, carrying N-number registrations and one `~`
prefixed TIS-B target. Two aircraft that close cannot have ETAs ten minutes apart
if they are in trail, so those pairs are certainly spurious.

But they are a small minority. GA or uncorrelated callsigns appear in 19 per cent
of the large-deficit violations and 8 per cent of admitted pairs overall. Worth
excluding, not the explanation.

## Rejected: separation ceasing at the threshold

Doctrine requires the separation to exist when the preceding aircraft is over the
landing threshold, so a compressing pair behind a landing aircraft should not
count. If that were the cause, violations would cluster at low lead ETA.

They do not. The violation rate is flat across approach phase: 54 per cent with
the lead under a minute from the threshold, 54 per cent at one to two minutes, 58
per cent at two to four. Excluding every pair whose lead is within 30 seconds of
the threshold moves the rate from 57 to 57 per cent.

## Still unidentified

What remains is 61 pairs, 32 per cent of those admitted, between two airline
flights, with a median deficit of 1.37 NM. Their profile says they are real:
median 295 ft per nautical mile of vertical against horizontal separation, which
is a 3 degree glideslope, and **none** of them is flat enough to be two aircraft
abreast. Their ETAs are consistent with each other. They are sequential arrivals
on a glideslope, measured a median 1.80 NM apart in trail at O'Hare, Atlanta and
Dallas Fort Worth.

That is below the minimum those fields run, so either the measurement is wrong in
a way not yet found, or the pairing is joining aircraft that are not actually
sequential on one approach. The candidate that survives is the second, and the
instrument to test it already exists but not in this window: the cross-track
column was added to the proximity dump after `tuned9` started, and the wake dump
does not carry it at all. Adding cross-track and along-track separation to the
wake dump would settle it, because two aircraft in trail on one localiser differ
almost entirely along-track.

## What to change, and in what order

1. Separate the wake minimum from the radar minimum, and use 2.5 NM on final
   within 10 NM. Confirmed, largest effect, and it stands on its own.
2. Exclude uncorrelated targets and require ETA consistency with the measured gap
   before pairing. Small effect, cheap, removes pairs that are certainly spurious.
3. Add cross-track and along-track separation to the wake dump, then run one
   window to identify the remaining 32 per cent before changing the pairing.

Do not report a residual violation rate as a property of the traffic until step 3
is done. The honest statement today is that one third of admitted pairs are
unexplained.
