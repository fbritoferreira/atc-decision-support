# Why the admitted wake pairs read as violations

Status: diagnosed from live data 2026-08-21; two of the three changes below
have since landed and one has not, so "not yet fixed" was true when written and
stopped being true without this line being updated.

Landed: the wake minimum and the radar minimum are separate in the model. The
wake table now holds null where FAA Order JO 7110.65 TBL 5-5-2 leaves a cell
blank, meaning the radar minimum governs, and `RADAR_MIN_NM` and
`RADAR_MIN_FINAL_NM` carry that rule instead of 3 NM standing in for a wake
requirement that doctrine does not impose. The re-measurement landed with it;
the paper reports fewer than one in ten of the admitted pairs as legally
separated rather than the 6.8 per cent below.

Outstanding, and sized on 2026-09-01: there is still no explicit
measurement-error allowance.

How much it matters, recomputed 2026-09-02 across the 286 recorded pairs now
pooled. Fifty-nine of them violate by the direct test, gap against requirement.
Forty-one of those carry a computed compliance margin; the other eighteen sit
outside the lateral admission band, where no margin is calculated, so the
deficit distribution below is over the forty-one and not over the fifty-nine.
Quoting either number without saying which test produced it is how the recorded
and admitted counts were confused for each other once already:

| deficit below the requirement | violations | share |
| --- | --- | --- |
| within 0.05 NM | 10 | 24 per cent |
| within 0.10 NM | 12 | 29 per cent |
| within 0.20 NM | 18 | 44 per cent |

The smallest deficit is 0.010 NM, about sixty feet, and the median is 0.250 NM.
So a quarter of every violation this project has recorded sits within roughly
three hundred feet of compliance, which is inside the position error a
cooperative surveillance picture can carry. That does not make those pairs
compliant, and it does not make them violations either: it makes the count
sensitive to a source of error the model does not represent, by an amount
nobody had measured until now. Any allowance introduced later moves a quarter
of the violations at 0.05 NM and nearly half at 0.20, so the choice of
allowance is itself a finding rather than a detail.

 Admitted
pairs are compared against an exact threshold, so the margin distribution still
carries whatever error the ADS-B positions carry, undeclared.

## The number that prompted this

Over a complete 24-hour window at KATL, KORD and KDFW, of the wake pairs the
vortex band admits, 6.8 per cent were legally separated, at a median in-trail gap
of 2.56 NM. US airports do not routinely violate wake separation, so that figure
described the measurement rather than the traffic, and the paper says so.

## What the per-pair dump shows

The first pairs off the live feed are unambiguous about the shape of the problem.
All three are medium behind medium at KORD 09L, requirement 3 NM:

| lead | trail | gap | required | vertical gap |
|---|---|---|---|---|
| ENY4078 | VOI7890 | 2.43 NM | 3 NM | 675 ft |
| GJS4587 | AAL2379 | 2.65 NM | 3 NM | 800 ft |
| GJS4587 | AAL2379 | 2.02 NM | 3 NM | 625 ft |

Two things follow immediately. The vertical gaps over those distances work out
to 260 to 310 ft/NM, which sits on a 3 degree glideslope, so these are genuine
in-trail pairs and not two aircraft abreast on adjacent parallels. And the gaps
cluster just below the requirement rather than far below it, which is the
signature of a threshold set slightly too high rather than of traffic in danger.

It also rules out the candidate explanation this project had been carrying. Both
aircraft in every pair are medium, which maps to CWT category F or G, and TBL
5-5-2 is blank for those leaders. Reclassifying to CWT would not move these
pairs, so the wake category migration is not the cause here.

## The cause

FAA Order JO 7110.126B, paragraph 5-5-4 subparagraph j, authorises **2.5 NM**
separation between aircraft established on the final approach course within 10 NM
of the landing runway, when operating in FUSION or single sensor slant range mode
within 40 miles of the antenna, subject to conditions including a documented
average runway occupancy time of 50 seconds or less.

The same subparagraph requires that wake turbulence separation from TBL 5-5-2 be
applied separately. For a medium behind a medium, TBL 5-5-2 is blank: no wake
minimum applies at all. So the governing separation for these pairs is the radar
minimum, and on final within 10 NM that minimum can be 2.5 NM.

This detector applies a 3 NM floor. Against 2.5 NM the three observed pairs read
as one legal, one marginal by 0.07 NM, and one genuinely tight. Against 3 NM all
three are violations.

The second contributor is that the comparison is exact. Positions come from
ADS-B, sequencing uses a smoothed ETA, and the gap is a straight line between two
reported positions. A pair sitting exactly at the minimum will measure a few tenths either
side of it, and every excursion below counts as a violation. There is no
allowance for measurement error anywhere in the comparison.

Together these explain a residual violation rate concentrated in a narrow band
just under 3 NM, which is what the histogram shows.

## The honest complication

Whether 2.5 NM is authorised at a given field is a facility property. It depends
on the surveillance mode in use, distance from the antenna, a documented runway
occupancy time, and operational CTRDs. A prototype consuming public ADS-B cannot
observe any of those, so it cannot know which minimum applies at a given airport
at a given moment.

That is worth stating rather than hiding, because it bounds what this class of
system can conclude from public data. Three defensible options:

1. Apply 2.5 NM on final within 10 NM and state the assumption. Risks
   under-alerting at fields without the authorisation.
2. Keep 3 NM and report the sensitivity, so a reader can see how much of the
   violation rate is threshold choice rather than traffic.
3. Report both, treating the band between them as indeterminate rather than as
   violation. This is the most honest and the least useful operationally, which
   is a fair description of what public data supports.

Option 3 is the one that matches what the measurement can actually support, and
it makes the limitation visible instead of burying it in a threshold constant.

## What to change

- Separate the wake minimum from the radar minimum in the model. They are
  different rules from different tables and the code currently conflates them
  into one number per category pair.
- Add an explicit measurement-error allowance, stated as a constant with its
  justification, rather than comparing to an exact threshold.
- Re-measure. Table 4 and the margin distribution both move.
