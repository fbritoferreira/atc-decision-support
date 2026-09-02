# What the sampling dumps contain

Written 2026-09-02. Two independent strategy reviews asked for a data dictionary and
there was none: a reader handed one of these files had to read the generator to
learn what a column meant, and one column means something other than what its
name suggests, which has already produced a wrong analysis here.

Three files come out of `scripts/fp-analysis.mjs`, one row per snapshot or per
pair, at the interval the run was given. Every window in `data/` used a
sixty-second interval.

## The schemas are not identical across windows

Columns were added over time and the header is written once, when a file is
created, so a dump carries the schema of the day it started. As of 2026-09-02:

| File | Column counts on disk |
| --- | --- |
| `fp-<icao>-<tag>.csv` | 55 columns in 9 windows, 57 in 6 |
| `prox-<tag>.csv` | 22 columns in 10 windows, 24 in 1 |

The two extra `fp` columns are `wx_observed_for` and `wx_condition_observed`.
The two extra `prox` columns are `a_ct_own_nm` and `b_ct_own_nm`. Read columns
by name from each file's own header, never by position. Every analysis script
here already does; `fp-analysis.mjs` refuses to append to a dump whose header
differs from its writer, because the newer columns sit mid-row and appending
would shift everything after them.

## `prox-<tag>.csv`, one row per proximity pair per snapshot

| Column | Meaning |
| --- | --- |
| `timestamp_utc`, `icao` | snapshot time and airport |
| `a`, `b` | the two callsigns |
| `a_type`, `b_type` | `arrival` or `departure` |
| `a_phase`, `b_phase` | lifecycle phase at the snapshot |
| `a_runway`, `b_runway` | the runway **end** inferred for each aircraft, such as `26R`. Empty when the aircraft is neither an arrival nor departed, or is beyond twelve miles, because the inference declines rather than guessing |
| `a_hdg`, `b_hdg`, `a_alt`, `b_alt` | heading in degrees, altitude in feet |
| `horiz_nm`, `vert_ft` | separation between the pair |
| `cross_track_nm` | **separation between the two aircraft** perpendicular to their mean heading. Not either aircraft's error. Two abreast on adjacent parallels differ mostly cross-track; two in trail on one localiser differ mostly along-track, which is the distinction it was added for |
| `along_track_nm` | the same separation resolved along that heading |
| `a_ct_own_nm`, `b_ct_own_nm` | **each aircraft's own distance from the centreline of the runway it is assigned.** A different quantity from `cross_track_nm`: that one measures how far apart the pair is, these measure how far each has strayed from where it should be. Added 2026-09-02 because a pair abreast on parallels and one aircraft leaving its localiser toward the other are indistinguishable in pair geometry. Empty when the aircraft has no inferred runway |
| `ft_per_nm` | vertical over horizontal separation, against roughly 318 ft/NM for a three-degree glideslope. Near it means in trail and descending |
| `critical` | whether the pair reached the critical tier |
| `both_arrivals` | both aircraft are arrivals |
| `same_runway` | both assigned the same runway, empty when either is unknown |

## `pairs-<tag>.csv`, one row per admitted wake pair per snapshot

`runway`, `lead`, `trail` and the two `_wake` columns identify the pair and its
wake categories. `gap_nm` is the measured in-trail gap and `required_nm` the
minimum the doctrine asks for, so `margin_nm` is the compliance margin and is
negative on a violation. `within_band` records whether the pair passed the
lateral admission test; a recorded pair outside it is counted but not admitted,
and the two counts differ. `lead_cwt` and `trail_cwt` are the FAA consolidated
wake turbulence categories from TBL 5-5-2, and `n_cwt_unmapped` in the snapshot
file counts aircraft types the lookup could not place.

## `fp-<icao>-<tag>.csv`, one row per snapshot

Traffic: `n_contacts` is what the feed returned, `n_flights` what survived
ingest, and the gap between them is the ingest coverage the papers report.

Alerts: `n_alerts_total` is a **stock**, the alerts standing at that instant.
`n_alerts_new`, `n_alerts_gone` and `n_alerts_returned` are **flows** since the
previous snapshot. Only a flow divides into exposure. Dividing the stock by
aircraft-hours produces a number that looks like an alert rate and is not, which
is a mistake made once here and recorded.

`n_critical`, `n_warning`, `n_advisory`, `n_info` split the stock by tier.
`n_<category>` and `n_crit_<category>` split it by detector and by detector at
the critical tier. `n_suppressed` counts alerts arriving pre-subsumed, and it is
near zero on every window under the current doctrine, for the reason the papers
give with the withdrawn in-trail rule.

Wake: `n_wake_pairs` admitted pairs, `wake_margin_min` the worst margin, the
three `n_wake_margin_*` columns a histogram of margins around zero,
`n_wake_candidates` pairs considered and `n_wake_band_excluded` those the
lateral test rejected. `adm_gap_med_nm` and `excl_gap_med_nm` are median gaps
for admitted and excluded pairs, and `n_adm_legal` / `n_excl_legal` how many of
each met their minimum.

Weather: `wind_dir_deg`, `wind_kts`, `gusts_kts`, `visibility_nm`, `ceiling_ft`
and `wx_condition`, which holds `VFR`, `MVFR`, `IFR` or `LIFR`. On the newer
schema, `wx_condition_observed` is a boolean recording whether the report was
observed rather than carried forward, and `wx_observed_for` how long it has
stood. `wx_condition_observed` is not a condition and reading it as one gives a
column of `true`.
