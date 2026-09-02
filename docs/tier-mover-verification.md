# Verifying that two tier-moving corrections execute on live data

Status: preliminary, measured 2026-08-25 on a partially collected window
(tuned13, 12 clock hours matched against tuned12). The full-window numbers
replace these when the window closes; the conclusion being tested here is
binary and already settled.

## Why this check exists

Finding 4 of the paper is that a runway-identifier defect meant two of three
tuned fixes never executed on live data while every scenario test kept
passing. The lesson generalises: a correction verified only against scenarios
is unverified where it matters. Two of the recent corrections are especially
vulnerable to that failure, because both MOVE alerts between severity tiers
rather than removing them:

- the visual-separation cap, which holds a wake radar-floor violation at
  warning under VMC instead of letting the distance test call it critical;
- the parallel-approach demotion, which drops a non-converging pair on
  distinct parallels from warning to advisory.

Neither shows up in a critical-only comparison, and neither shows up in a
total-volume comparison. Both are invisible unless the measurement reports
the tier distribution, which `hour-match-compare.py` did not do until this
revision.

## Result: both fire

**Visual-separation cap.** The critical share of wake alerts fell from 6.5 per
cent to 0.3 per cent: 14 criticals of 217 wake alerts before, 1 of 287 after.
Wake alert volume itself rose slightly (5.4 to 7.0 per thousand aircraft),
which is the correct signature: the cap does not suppress the alert, it
reclassifies it. The single surviving critical is the designed carve-out, a
violation of a stated CWT minimum rather than of the radar floor, which keeps
its severity in every condition.

**Parallel-approach demotion.** Hour-matched, per thousand aircraft:

| airport | warning | advisory | critical | proximity total |
|---|---|---|---|---|
| KATL | 80.9 to 21.2 (-74%) | 68.9 to 116.8 (+69%) | 1.3 to 1.4 | 115.4 to 117.2 |
| KORD | 80.1 to 25.3 (-68%) | 49.3 to 91.4 (+86%) | 1.3 to 1.0 | 105.6 to 102.5 |
| KDFW | 64.2 to 22.9 (-64%) | 36.4 to 64.4 (+77%) | 3.3 to 1.0 | 84.4 to 77.6 |

Warnings fell roughly 70 per cent per aircraft at all three fields while
advisories rose roughly 80 per cent and proximity volume stayed flat. That is
a reclassification, not a reduction, and reporting it as a reduction would be
the dishonest reading available here: the pairs are still detected, still
listed, still auditable, and the claim is only that they no longer ask for the
operator's attention as conflicts.

## What this does not show

Nothing about whether the demotion is CORRECT, only that it runs. The
correctness argument rests on the 71-per-cent parallel-pair measurement and on
the test pinning that a converging blunder between parallels still escalates.
And silent-share moved the wrong way for this argument at two fields (20 to 11
per cent at KATL, 16 to 9 per cent at KORD), because a demoted alert is still
an alert and a snapshot carrying one is not silent. The honest summary is that
the operator's critical and warning load fell sharply while the total volume
did not, so the next question is whether an advisory tier this large is worth
displaying at all, which is a design question rather than a threshold one.
