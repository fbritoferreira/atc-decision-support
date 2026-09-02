#!/usr/bin/env python3
"""Hour-matched, traffic-normalised comparison of two fp-analysis windows.

Why this exists, and why fp-compare.mjs is not enough on its own.

fp-compare.mjs reports per-snapshot rates. That is correct when two windows
cover the same clock hours, and misleading when they do not. The tuned7 window
(2026-08-17) stopped at 17.4 hours because both volunteer ADS-B feeds began
refusing, so it lost 13:00-19:39Z, which is US midday. Traffic in that window
came in 16 to 45 per cent BELOW the 24-hour baseline at four of five airports,
and a naive per-snapshot comparison then credits the tuning for a reduction
that lower traffic produced.

This tool removes both confounds:

  1. It restricts BOTH windows to the set of UTC hours the second window
     actually covers, so the diurnal cycle cannot differ between them.
  2. It reports per 1,000 aircraft rather than per snapshot, so a difference in
     snapshot count or in traffic density cannot move the numbers.

Read the output as: if a rate falls here, the detector population genuinely got
quieter for the same amount of traffic at the same times of day.

Usage:
  python3 scripts/hour-match-compare.py <before-tag> <after-tag> [icao ...]

  python3 scripts/hour-match-compare.py tuned3-2026-08-10 tuned7
  python3 scripts/hour-match-compare.py tuned3-2026-08-10 tuned8 katl kord kdfw

Tags are the part of the filename after "fp-<icao>-". Airports default to the
five sampled fields; pass a subset when a window covers fewer.
"""

import csv
import datetime
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from wilson import wilson  # noqa: E402
from window_files import known_tags  # noqa: E402  (path set above)

DATA = Path(__file__).resolve().parent.parent / "data"
DEFAULT_AIRPORTS = ["kjfk", "katl", "kord", "kdfw", "klax"]

# Columns read per snapshot. Kept explicit so a rename in the harness fails
# loudly here instead of silently reporting zeros, which is how an earlier
# version of this analysis reported a 100 per cent silent share.
COUNTS = {
    "crit": "n_critical",
    # Warning and advisory are reported separately because two of this
    # project's corrections move alerts BETWEEN tiers rather than removing
    # them: the visual-separation cap on wake floor violations and the
    # parallel-approach demotion in proximity. A critical-only comparison
    # scores both as no change, and a total-volume comparison scores them as
    # no change too, so the tier split is the only view that can see them.
    "warn": "n_warning",
    "advis": "n_advisory",
    # Criticals split by the category that produced them. The aggregate alone
    # is not safe to draw conclusions from: comparing tuned14 to tuned15, the
    # critical rate at KDFW rose 90 per cent and the cause was a crosswind
    # event, 26 kt gusting 33, that put 100 crosswind criticals into the second
    # window and none into the first. Proximity criticals at that same field
    # FELL over the same comparison. A reader with only the aggregate would have
    # concluded that a change to the proximity detector had made things worse
    # at one field, which is the opposite of what happened.
    "crit_prox": "n_crit_proximity_conflict",
    "crit_wake": "n_crit_wake_spacing",
    "crit_runway": "n_crit_runway_conflict",
    "crit_wx": "n_crit_crosswind",
    "wake": "n_wake_spacing",
    "prox": "n_proximity_conflict",
    "pairs": "n_wake_pairs",
}


def load(path):
    with open(path) as fh:
        rows = list(csv.DictReader(fh))
    if not rows:
        raise SystemExit(f"{path}: no rows")
    time_key = next(c for c in rows[0] if "time" in c.lower())
    for required in ("n_flights", "n_alerts_total", *COUNTS.values()):
        if required not in rows[0]:
            raise SystemExit(f"{path}: missing column {required}")
    return [
        (datetime.datetime.fromisoformat(r[time_key].replace("Z", "+00:00")), r)
        for r in rows
    ]


def number(row, key):
    try:
        return float(row.get(key) or 0)
    except ValueError:
        return 0.0


def aggregate(rows, hours):
    selected = [r for t, r in rows if t.hour in hours]
    if not selected:
        return None
    flights = sum(number(r, "n_flights") for r in selected)
    out = {
        "snapshots": len(selected),
        "flights": flights,
        "silent": sum(1 for r in selected if number(r, "n_alerts_total") == 0),
    }
    for label, column in COUNTS.items():
        out[label] = sum(number(r, column) for r in selected)
    return out


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    before_tag, after_tag = sys.argv[1], sys.argv[2]
    airports = [a.lower() for a in sys.argv[3:]] or DEFAULT_AIRPORTS

    print(
        f"{'':16} {'crit/1k':>9} {'warn/1k':>9} {'advis/1k':>9} "
        f"{'wake/1k':>9} {'prox/1k':>9} {'pairs/1k':>9} {'silent':>7}"
    )
    # Assigned inside the loop, and every airport can be skipped when a window
    # is missing. Without this the script died on UnboundLocalError at the last
    # line, which tells a reader nothing about what went wrong.
    hours = set()
    compared = 0
    for icao in airports:
        before_path = DATA / f"fp-{icao}-{before_tag}.csv"
        after_path = DATA / f"fp-{icao}-{after_tag}.csv"
        missing = [p.name for p in (before_path, after_path) if not p.exists()]
        if missing:
            print(f"{icao:16} skipped, no {' and no '.join(missing)}")
            continue
        compared += 1

        before, after = load(before_path), load(after_path)
        hours = {t.hour for t, _ in after}

        rates = {}
        for label, rows in (("before", before), ("after", after)):
            agg = aggregate(rows, hours)
            if not agg or agg["flights"] == 0:
                continue
            per_1k = 1000.0 / agg["flights"]
            rates[label] = agg
            print(
                f"{icao + ' ' + label:16} "
                f"{agg['crit'] * per_1k:9.1f} {agg['warn'] * per_1k:9.1f} "
                f"{agg['advis'] * per_1k:9.1f} {agg['wake'] * per_1k:9.1f} "
                f"{agg['prox'] * per_1k:9.1f} {agg['pairs'] * per_1k:9.1f} "
                f"{100 * agg['silent'] / agg['snapshots']:6.0f}% "
                f" n={agg['snapshots']} flights={agg['flights']:.0f}"
            )
        if {"before", "after"} <= rates.keys():
            b, a = rates["before"], rates["after"]
            for tier in ("crit", "crit_prox", "warn", "advis"):
                if not b[tier]:
                    print(f"{'':16} {tier} per aircraft: no baseline volume")
                    continue
                change = (a[tier] / a["flights"]) / (b[tier] / b["flights"]) - 1
                # The counts, and an interval, alongside the percentage. A ratio
                # of two rates says nothing about whether the rates can be told
                # apart, and this line printed "+371%" for one critical alert
                # against six on 2026-08-30: the Wilson intervals on those two
                # proportions are 0.007-0.213% and 0.081-0.387%, which overlap
                # across half their width. Every other comparison in this
                # project carries an interval for exactly this reason and the
                # tool that produces the comparisons did not.
                #
                # The interval assumes independent trials and the data is not.
                # An alert persists across consecutive snapshots, so the same
                # event is counted several times and the effective sample is
                # smaller than the flight-observation count, which makes these
                # intervals NARROWER than the truth. That is safe in one
                # direction only: an OVERLAPPING verdict would still overlap
                # with wider intervals, so it holds, while a disjoint verdict
                # is the one that could be overturned by proper treatment of
                # the autocorrelation. Read "disjoint" as "not obviously noise"
                # rather than as significance, and lean on the size of the
                # separation. The published Table 3 separations are two orders
                # of magnitude wide and are not at risk from this; a marginal
                # one would be.
                lo_b, hi_b = wilson(int(b[tier]), int(b["flights"]))
                lo_a, hi_a = wilson(int(a[tier]), int(a["flights"]))
                apart = hi_b < lo_a or hi_a < lo_b
                print(
                    f"{'':16} {tier} per aircraft: {change * 100:+.0f}%  "
                    f"({int(b[tier])}/{int(b['flights'])} to {int(a[tier])}/{int(a['flights'])}; "
                    f"95% CI {100 * lo_b:.3f}-{100 * hi_b:.3f}% vs {100 * lo_a:.3f}-{100 * hi_a:.3f}%, "
                    f"{'disjoint' if apart else 'OVERLAPPING: not distinguishable'})"
                )
            # Name a weather-driven swing explicitly rather than leaving it
            # inside the aggregate, since crosswind and weather criticals
            # depend on the wind that blew during the window and not on any
            # change to the detectors.
            for tier, label in (("crit_wx", "crosswind"),):
                if a[tier] or b[tier]:
                    print(
                        f"{'':16} NOTE: {a[tier]:.0f} {label} criticals after against "
                        f"{b[tier]:.0f} before; this category tracks the weather, "
                        f"not the detectors"
                    )
        print()

    if compared == 0:
        raise SystemExit(
            f"\nNothing compared: no airport had both a '{before_tag}' and a "
            f"'{after_tag}' window in {DATA}. Window CSVs are gitignored and are "
            f"not distributed, so a comparison needs two windows sampled on this "
            f"machine. Tags present: "
            + (", ".join(known_tags()) or "none in this checkout")
            + "."
        )
    print(f"UTC hours matched to the after window: {sorted(hours)}")


if __name__ == "__main__":
    main()
