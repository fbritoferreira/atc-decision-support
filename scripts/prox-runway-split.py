#!/usr/bin/env python3
"""Split a window's proximity pairs by runway identity.

Regenerates the numbers behind the parallel-approach demotion: under
centreline attribution, what share of proximity pairs have both aircraft
attributed to a runway, how many of those sit on distinct parallel runways
(labels differ, numeric courses within one ten-degree step), and what that
population looks like (horizontal gap, cross-track, vertical, criticals).
The old heading-only attribution could not produce this split, which is why
the papers previously said runway identity could not settle whether the
proximity volume was parallel approaches.

Usage:
  python3 scripts/prox-runway-split.py <tag>
  python3 scripts/prox-runway-split.py tuned12

Reads data/prox-<tag>.csv (schema with a_runway/b_runway and cross_track_nm,
present since tuned11).
"""
import csv
import os
import statistics as st
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wilson import disjoint, wilson  # noqa: E402  (path set above so the script runs from any cwd)
from window_files import open_window, scope_line  # noqa: E402

TAG = sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__)

rows = list(csv.DictReader(open_window(f"data/prox-{TAG}.csv", TAG)))
arr = [r for r in rows if r["both_arrivals"] == "true"]
print(f"window {TAG}: {len(rows)} proximity pairs, {len(arr)} arrival-arrival")
print(scope_line(rows))

both = [r for r in arr if r["a_runway"] and r["b_runway"]]
neither = [r for r in arr if not r["a_runway"] and not r["b_runway"]]
one = len(arr) - len(both) - len(neither)
print(f"both attributed: {len(both)} ({100 * len(both) / max(1, len(arr)):.0f}%), "
      f"one: {one}, neither: {len(neither)}")

def parallel(r):
    a, b = r["a_runway"], r["b_runway"]
    if a == b:
        return False
    import re
    na = int((re.match(r"\D*(\d+)", a) or [None, "-99"])[1])
    nb = int((re.match(r"\D*(\d+)", b) or [None, "-99"])[1])
    d = abs(na - nb)
    return min(d, 36 - d) <= 1

same = [r for r in both if r["a_runway"] == r["b_runway"]]
par = [r for r in both if parallel(r)]
other = len(both) - len(same) - len(par)
print(f"same runway: {len(same)}, distinct parallels: {len(par)} "
      f"({100 * len(par) / max(1, len(arr)):.0f}% of all pairs), other: {other}")

if par:
    med = lambda k: st.median(float(r[k]) for r in par if r[k])
    crit = sum(1 for r in par if r["critical"] == "true")
    print(f"distinct-parallel pairs: horiz median {med('horiz_nm'):.2f} NM, "
          f"cross-track median {med('cross_track_nm'):.2f} NM, "
          f"vertical median {med('vert_ft'):.0f} ft, critical {crit}")
# Both counts, because every figure above this line is scoped to arrival-arrival
# pairs and a single "overall" number here read as the window total. It is not:
# departure pairs and mixed pairs carry criticals of their own, broken out below.
crit_arr = sum(1 for r in arr if r["critical"] == "true")
crit_all = sum(1 for r in rows if r["critical"] == "true")
print(f"critical: {crit_arr} of {len(arr)} arrival-arrival pairs, "
      f"{crit_all} of {len(rows)} pairs of all kinds")


def pair_kind(row):
    phases = {row["a_phase"], row["b_phase"]}
    if phases == {"departed"}:
        return "dep-dep"
    if "departed" in phases:
        return "dep-arr"
    return "arr-arr"


def attribution_state(row):
    a, b = bool(row["a_runway"]), bool(row["b_runway"])
    if a and b:
        return "both attributed"
    if a or b:
        return "one attributed"
    return "neither attributed"


# Criticals by pair kind, then by whether the pair could be triaged at all.
#
# The paper predicted this split would matter before it was measured: the
# category figure aggregates over pair kinds, and two airborne departures are
# separated by doctrine this detector does not model. The measurement was
# sharper than the prediction. In the 24-hour window the papers quote, the
# critical rate was 1 pair in 447 where attribution reached both aircraft and
# 41 in 837 where it reached neither, which made the residual an
# attribution-coverage problem rather than a doctrine problem: a different and
# more tractable statement.
#
# Those two figures are one window's measurement, not a constant, and that
# window is among the ones lost with apps/atc/data/. They are recorded here as
# provenance for the published table and nothing more. What the tool asserts
# about any window handed to it is printed below, with intervals, because a
# bare rate over a few hundred pairs invites a reader to compare two numbers
# that the sample cannot actually separate.
print("\ncriticals by pair kind:")
kinds = defaultdict(lambda: {"n": 0, "crit": 0})
for row in rows:
    bucket = kinds[pair_kind(row)]
    bucket["n"] += 1
    if row["critical"] == "true":
        bucket["crit"] += 1
for name in ("arr-arr", "dep-arr", "dep-dep"):
    b = kinds[name]
    if b["n"]:
        print(f"  {name:8s} {b['n']:5d} pairs  {b['crit']:4d} critical  ({100 * b['crit'] / b['n']:.1f}%)")

print("\ndeparture-to-departure pairs by whether the demotion could reach them:")
states = defaultdict(lambda: {"n": 0, "crit": 0})
for row in rows:
    if pair_kind(row) != "dep-dep":
        continue
    bucket = states[attribution_state(row)]
    bucket["n"] += 1
    if row["critical"] == "true":
        bucket["crit"] += 1
for name in ("both attributed", "one attributed", "neither attributed"):
    b = states[name]
    if b["n"]:
        lo, hi = wilson(b["crit"], b["n"])
        print(
            f"  {name:20s} {b['n']:5d} pairs  {b['crit']:4d} critical  "
            f"({100 * b['crit'] / b['n']:.1f}%, 95% interval "
            f"{100 * lo:.1f} to {100 * hi:.1f}%)"
        )

# The whole point of the split is whether the reachable and unreachable groups
# differ, so the tool answers that rather than leaving it to the reader's eye.
reach = states["both attributed"]
miss = states["neither attributed"]
if reach["n"] and miss["n"]:
    a = wilson(reach["crit"], reach["n"])
    b = wilson(miss["crit"], miss["n"])
    if disjoint(a, b):
        higher = "unreachable" if miss["crit"] / miss["n"] > reach["crit"] / reach["n"] else "reachable"
        print(
            f"  intervals are disjoint: this window separates the two groups, "
            f"with the {higher} group higher."
        )
    else:
        print(
            "  intervals OVERLAP: this window cannot separate the two groups. "
            "Any direction read from it is sampling noise."
        )
