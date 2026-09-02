#!/usr/bin/env python3
"""Split a window's wake pairs by METAR flight condition and by what governs.

Regenerates the numbers behind the visual-separation finding: which share of
admitted pairs is judged legal, how the violations split between the radar
floor and stated wake minima, how far the violating pairs sit from a single
localiser course (cross-track), and the METAR condition every pair formed
under. JO 7110.65 7-2-1 voids the radar minima for a pair whose trailing pilot
holds visual separation, and that acceptance is unobservable from surveillance,
so the condition split is the closest measurable proxy: a violation under VFR
may be legal visual-approach spacing, a violation under IMC cannot be.

Usage:
  python3 scripts/wake-condition-split.py <tag> [icao ...]
  python3 scripts/wake-condition-split.py tuned12
  python3 scripts/wake-condition-split.py tuned12 katl kord

Reads data/pairs-<tag>.csv and data/fp-<icao>-<tag>.csv. The pairs dump must
carry cross_track_nm and the CWT columns (present since the tuned12 schema).
"""
import csv
import os
import statistics as st
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from window_files import airports_in, open_window, scope_line  # noqa: E402  (path set above)

TAG = sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__)
# Default to the airports this tag actually holds rather than a fixed three,
# so a single-field window from the watcher analyses without being told which
# field it is. Explicit arguments still win.
ICAOS = [a.lower() for a in sys.argv[2:]] or airports_in(TAG) or ["katl", "kord", "kdfw"]

wx = {}
snap_conditions = Counter()
for icao in ICAOS:
    with open_window(f"data/fp-{icao}-{TAG}.csv", TAG, icao) as f:
        for r in csv.DictReader(f):
            wx[(icao.upper(), r["timestamp_utc"])] = r["wx_condition"]
            snap_conditions[r["wx_condition"]] += 1

rows = list(csv.DictReader(open_window(f"data/pairs-{TAG}.csv", TAG)))
admitted = [r for r in rows if r["within_band"] == "true"]
violating = [r for r in admitted if float(r["margin_nm"]) < 0]

print(f"window {TAG}: {len(rows)} candidates, {len(admitted)} admitted, "
      f"{len(violating)} violating "
      f"({100 * (len(admitted) - len(violating)) / max(1, len(admitted)):.0f}% legal)")
print(scope_line(rows))
# The airport argument selects which per-snapshot weather files are read; it does
# not filter the wake pairs, which come from one pairs-<tag>.csv covering the
# whole window. So asking for one field of a three-field window gives that
# field's conditions against every field's pairs. That asymmetry predates the
# scope line and was invisible until the scope line printed the pairs' fields
# next to the requested ones. Said out loud rather than quietly fixed, because
# filtering the pairs would change what every previous run of this script meant.
_pair_fields = sorted({r["icao"] for r in rows if r.get("icao")})
if _pair_fields and sorted(a.upper() for a in ICAOS) != _pair_fields:
    print(
        f"  NOTE: conditions read for {', '.join(a.upper() for a in ICAOS)} but pairs "
        f"cover {', '.join(_pair_fields)}; the pairs are not filtered by airport"
    )
print(f"snapshot conditions: {dict(snap_conditions)}")

floor_gov = [r for r in violating if not r["lead_cwt"] or not r["trail_cwt"]
             or float(r["required_nm"]) <= 3]
# A pair is floor-governed when no wake minimum applied: either type unmapped,
# or the requirement equals a radar minimum (2.5 or 3). A stated CWT minimum
# is always at least 3.5 in TBL 5-5-2, so required_nm <= 3 identifies the
# floor exactly.
wake_gov = [r for r in violating if r not in floor_gov]
print(f"violations against the radar floor: {len(floor_gov)}; "
      f"against a stated wake minimum: {len(wake_gov)}")

if violating:
    ct = sorted(float(r["cross_track_nm"]) for r in violating)
    print(f"violating cross-track: median {st.median(ct):.3f} NM, "
          f"p90 {ct[int(0.9 * (len(ct) - 1))]:.3f} NM; "
          f"in-trail (<0.06 NM): {sum(1 for x in ct if x < 0.06)}/{len(ct)}")

for pool, name in [(admitted, "admitted"), (violating, "violating")]:
    split = Counter()
    unmatched = 0
    for r in pool:
        c = wx.get((r["icao"], r["timestamp_utc"]))
        if c is None:
            unmatched += 1
        else:
            split[c] += 1
    line = ", ".join(f"{k}: {v}" for k, v in sorted(split.items())) or "none"
    print(f"{name} pairs by METAR condition: {line}"
          + (f" (unmatched: {unmatched})" if unmatched else ""))

imc_viol = [r for r in violating
            if wx.get((r["icao"], r["timestamp_utc"])) in ("IFR", "LIFR")]
if not imc_viol and snap_conditions.get("IFR", 0) + snap_conditions.get("LIFR", 0) < 10:
    print("NOTE: window contains essentially no IMC, so the visual-separation "
          "hypothesis is untested by this window; it predicts a lower "
          "violation rate under IFR/LIFR.")
