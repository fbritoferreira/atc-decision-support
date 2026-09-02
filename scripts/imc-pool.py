#!/usr/bin/env python3
"""Pool wake pairs across windows and split them by flight condition.

The visual-separation finding predicts a lower wake-violation rate under
instrument conditions, where visual approaches stop and the radar minima
genuinely bind. No single window can test it: IMC at a sampled field is rare
and short-lived. The watcher launched a 12-hour window when Boston went IFR on
2026-08-24 and the IFR condition had cleared within about eighty minutes, so
that window is 96 per cent VFR like every other.

The contrast therefore has to accumulate across windows rather than wait for
one good one. This tool pools every window that carries both a per-pair dump
and per-snapshot weather, reports how many snapshots of each condition have
been sampled in total, and reports the violation rate within each condition.

Only windows collected under the corrected doctrine are comparable, so the
default set is explicit rather than a glob: earlier windows used the conflated
radar floor, the legacy four-class wake model, or heading-only runway
attribution, and pooling them would mix doctrines.

Usage:
  python3 scripts/imc-pool.py                      # the default corrected set
  python3 scripts/imc-pool.py tuned12 tuned13      # explicit tags
"""
import csv
import glob
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wilson import wilson  # noqa: E402  (path set above so the script runs from any cwd)

# Windows collected under the corrected wake floor, CWT categories and
# centreline attribution. Add tags here as windows close; do not glob.
# tuned16 is the exception and the only window here whose data survives: it
# closed 2026-08-29 16:23Z at KATL, KORD and KDFW and contributes 136 IFR and 9
# LIFR snapshots with two admitted wake pairs, one violating. Pooled with the
# earlier three pairs the instrument sample is five pairs and two violations,
# 40 per cent with a 95 per cent interval of 12 to 77, which still contains the
# visual rate, so the contrast still cannot distinguish the two regimes.
#
# SOME OF THE WINDOWS HERE HAVE NO DATA ON THIS MACHINE. The CSVs live in
# apps/atc/data/, which is gitignored, and the ones behind the published figures
# did not survive a move between machines. This script named them and reported
# nothing at all until windows collected after the move began to close; it pools
# those and still names the rest, so the gap between what it can pool and the 532
# snapshots both papers quote from the lost windows stays visible. That gap is
# the point rather than a bug: it is the concrete demonstration that the
# published numbers cannot be re-derived from the repository. Section 6.10 of
# the thesis and the Reproducibility section of the whitepaper both say so.
#
# The list is kept rather than emptied because it records which windows were
# collected under the corrected doctrine, which is the thing a future pool has
# to match. Add new tags as windows close.
#
# Deliberately a list and not a glob, which is worth stating because the
# opposite decision was right elsewhere in this repository on the same day: the
# engineering notes under docs/ are read from the directory, because every file
# there is a note about this code and membership is not a judgement. Membership
# here is: a window collected under a superseded wake floor or the old
# attribution would pool cleanly and mean nothing. A glob cannot tell the
# doctrine a window ran under; this list records it.
# Windows that exist and must never pool, recorded for the same reason the list
# below exists: membership is a fact about doctrine that no glob can recover.
# all_window_exposure() finds superseded windows by globbing data/, and data/ is
# gitignored, so on a clean clone there is no record that these ran at all. That
# matters because the papers cite them by name: a reader who looks up `tuned9`
# in the only committed window list finds nothing and cannot tell a superseded
# window from a typo. Hand-maintained, with the same failure mode as the list
# below, and holding only windows named somewhere in the documents.
SUPERSEDED_WINDOWS = [
    # Legacy wake doctrine, before the radar-floor split. Cited in
    # docs/wake-residual-open.md, which marks it "legacy doctrine" in the one
    # place its figures appear, and in the prior-art gap analysis.
    "tuned9",
    # The first window whose proximity dump carries a_runway/b_runway, which is
    # what the extended-centreline attribution figures in both papers are
    # measured from. Recorded 2026-09-01 when a check rejected the tag: it is
    # cited by name in the papers, it is not in CORRECTED_WINDOWS because the
    # corrected set starts at tuned12, and its dump is not on the authoring
    # checkout, so nothing here could distinguish it from a typo. The usage
    # note in prox-runway-split.py is the source for the schema claim.
    "tuned11",
]

CORRECTED_WINDOWS = [
    "tuned12",
    "tuned13",
    # Closed 2026-08-29 16:23Z, three fields, 835 snapshots each.
    "tuned16",
    # Launched by the watcher when Atlanta went IFR at 2026-08-30 13:04:30Z and
    # closed 3.86 h later, 158 snapshots at a 60 s interval. The first window
    # collected under the corrected heading resolution, so its classified share
    # is not comparable with the windows above without saying so. Added after it
    # closed; the still-sampling guard below would have refused it before that.
    "imc-2026-08-301304",
    # Instrument-condition windows launched by imc-watch.mjs, plus one started
    # by hand while the watcher's guard was being fixed. Added as they close,
    # which is a hand-maintained list and failed as one: the two below closed on
    # 2026-08-29 and were not added until 2026-08-31, so every pooled run in
    # between quietly left out 138 instrument-condition snapshots that were
    # sitting in data/ the whole time. They hold no instrument-condition wake
    # pair, so the contrast is unchanged, but they nearly double the exposure it
    # is measured against, which is the half of the comparison this project
    # keeps having to be reminded is a measurement too.
    "imc-2026-08-290944",  # KSFO, 4 h, 138 IFR snapshots and no pairs
    "imc-2026-08-291331",  # KSEA, 4 h
    # Launched at Seattle 2026-08-31 15:08Z, closed four hours later. 34 IFR
    # snapshots and no admitted wake pair, so it adds exposure and no contrast.
    # The first window collected entirely under the corrected distance handling,
    # which declines a record carrying no distance rather than placing it at the
    # field; nothing here turns on that, since it produced no pairs either way.
    "imc-2026-08-311508",
    "imc-2026-08-24",  # KBOS, 55 IFR snapshots at 0.8 aircraft, no pairs
    "imc-202608250852",  # KSFO overnight, 238 IFR snapshots at 0.8 aircraft, no pairs
    "imc-2026-08-251657",  # KSFO afternoon, 53 IFR snapshots at 29 aircraft each:
    # the densest instrument-condition traffic sampled so far
    # KMIA, launched by the watcher at 2026-09-01 02:07:39Z and closed six
    # minutes later, 7 snapshots at 12.2 aircraft each, every one IFR. Holds one
    # admitted wake pair, compliant with its margin inside a mile, which is the
    # second instrument-condition pair this project has formed and the first at
    # a field other than San Francisco. Added the same day it closed, which the
    # two windows above were not: the guard that printed UNLISTED is the only
    # reason this one did not sit in data/ unnoticed as those did for two days.
    "imc-2026-09-010207",
    # The three below closed on 2026-09-01 and were added on 2026-09-02, so
    # every pooled run in between left them out. The UNLISTED guard named all
    # three on every run in that period, which is the difference from the
    # 2026-08-29 lapse recorded above: the instrument reported it and nobody
    # read the instrument. Between them they hold 296 IFR snapshots and one
    # admitted wake pair, so this was not a quiet exclusion of nothing.
    "imc-2026-09-011004",  # KJFK, 240 snapshots, 88 IFR and 152 MVFR, 16.7
    # aircraft each, no wake pair
    "imc-2026-09-011404",  # KJFK and KSEA, 239 snapshots, 112 IFR, 19.9
    # aircraft each, and the one wake pair of the three
    "imc-2026-09-011424",  # KBOS, 240 snapshots, 96 IFR against 120 VFR, 9.8
    # aircraft each, no wake pair
    # KMIA, launched by the watcher at 2026-09-02 and closed four hours later.
    # 239 snapshots, 18 of them instrument conditions and 12 of those LIFR,
    # against 198 visual. It carries 118 recorded proximity pairs, which is
    # more than the previous ten windows held between them at a single field,
    # and it is the first window collected under the schema that records each
    # aircraft's distance from its own assigned centreline.
    "imc-2026-09-012305",
    # KBOS, four hours to 2026-09-02 02:25 local. 238 snapshots, 6 IFR and 146
    # marginal against 86 visual, 8 recorded proximity pairs and no admitted
    # wake pair, so it adds exposure and no contrast. Added the morning it
    # closed, unlike the three from 2026-09-01 that sat unlisted for a day
    # while the guard named them on every run.
    "imc-2026-09-011824",
    "imc-2026-08-251256",  # KSFO morning marine layer, the first window with
    # instrument-condition traffic worth the name: 174 IFR snapshots at about
    # 7.9 aircraft each, and the first instrument-condition wake pair this
    # project has ever formed.
]

import datetime

IMC = {"IFR", "LIFR"}

# A window whose newest snapshot is younger than this is treated as still being
# written. Ten minutes is comfortably longer than the longest sampling interval
# used here, 60 s, and short enough that a window closed minutes ago is usable.
STILL_RUNNING_MIN = 10
MARGINAL = {"MVFR"}


def snapshot_conditions(tag, traffic=None):
    """(icao, timestamp) -> flight category, for every summary file of a tag.

    Also accumulates classified-aircraft totals per condition group when a
    `traffic` dict is passed, because the expected-pair calculation needs the
    traffic difference between conditions and not only the snapshot counts.
    """
    out = {}
    counts = Counter()
    for path in glob.glob(f"data/fp-*-{tag}.csv"):
        base = os.path.basename(path)
        icao = base[len("fp-") :].split("-")[0].upper()
        with open(path) as fh:
            for row in csv.DictReader(fh):
                cond = row.get("wx_condition")
                if not cond:
                    continue
                out[(icao, row["timestamp_utc"])] = cond
                counts[cond] += 1
                if traffic is not None:
                    group = "IMC" if cond in IMC else "VFR" if cond == "VFR" else None
                    if group:
                        total, n = traffic.get(group, (0, 0))
                        traffic[group] = (total + int(row.get("n_flights") or 0), n + 1)
    return out, counts


def newest_snapshot(tag):
    """The most recent snapshot timestamp for a window, or None if it has none.

    Extracted 2026-09-01 so the unlisted report can say whether a window is
    still collecting. The pooling loop below computes the same thing inline to
    decide whether to skip a window; both callers need the same answer and a
    second inline copy would be the kind of duplicate this project keeps
    finding disagreements between.
    """
    stamps = [
        datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
        for (_icao, ts) in snapshot_conditions(tag)[0]
    ]
    return max(stamps) if stamps else None


def all_window_exposure():
    """Instrument-condition exposure across EVERY window, including superseded ones.

    Reported separately and never pooled with the corrected windows, because the
    doctrine differed. Its purpose is to answer whether instrument conditions
    with sampleable traffic occur at all, which bears on whether the contrast is
    obtainable in principle or only in a better-sampled world.
    """
    import datetime

    hours = Counter()
    imc_flights = imc_n = vfr_flights = vfr_n = 0
    for path in glob.glob("data/fp-*.csv"):
        if "pairs" in path or "prox" in path:
            continue
        for row in csv.DictReader(open(path)):
            cond, ts = row.get("wx_condition"), row.get("timestamp_utc")
            if not cond or not ts:
                continue
            n = int(row.get("n_flights") or 0)
            if cond in IMC:
                imc_flights += n
                imc_n += 1
                try:
                    hours[datetime.datetime.fromisoformat(ts.replace("Z", "+00:00")).hour] += 1
                except ValueError:
                    pass
            elif cond == "VFR":
                vfr_flights += n
                vfr_n += 1
    print("\nall windows, including superseded doctrine (context only, never pooled):")
    print(f"  instrument-condition snapshots: {imc_n}, mean {imc_flights / max(1, imc_n):.1f} aircraft")
    print(f"  visual-condition snapshots:     {vfr_n}, mean {vfr_flights / max(1, vfr_n):.1f} aircraft")
    print(f"  instrument-condition snapshots by UTC hour: {dict(sorted(hours.items()))}")


def main():
    args = [a for a in sys.argv[1:] if a != "--all-windows"]
    show_all = "--all-windows" in sys.argv
    tags = args or CORRECTED_WINDOWS

    snapshots = Counter()
    traffic = {}  # "IMC" | "VFR" -> (total classified aircraft, snapshot count)
    by_condition = defaultdict(lambda: {"pairs": 0, "violating": 0})
    missing_weather = 0
    recorded_pairs = recorded_violations = 0
    used, skipped = [], []

    for tag in tags:
        pairs_path = f"data/pairs-{tag}.csv"
        if not os.path.exists(pairs_path):
            skipped.append(f"{tag} (no per-pair dump)")
            continue
        conditions, counts = snapshot_conditions(tag, traffic)
        if not counts:
            skipped.append(f"{tag} (no per-snapshot weather)")
            continue
        # A window still being written must not be pooled. Its figures move with
        # every snapshot, so a number taken from it is a different number an hour
        # later, and the instruction not to add a tag before its window closes has
        # been written in three places and enforced in none of them. This is the
        # enforcement: if the newest snapshot is younger than STILL_RUNNING_MIN,
        # the sampler is probably still appending, and the window is named and
        # skipped rather than silently averaged in.
        newest = max(
            (
                datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
                for (_icao, ts) in conditions
            ),
            default=None,
        )
        if newest is not None:
            age_min = (
                datetime.datetime.now(datetime.timezone.utc) - newest
            ).total_seconds() / 60
            if age_min < STILL_RUNNING_MIN:
                skipped.append(
                    f"{tag} (still sampling: newest snapshot {age_min:.0f} min old)"
                )
                continue
        used.append(tag)
        snapshots.update(counts)
        with open(pairs_path) as fh:
            for row in csv.DictReader(fh):
                recorded_pairs += 1
                if float(row["gap_nm"]) < float(row["required_nm"]):
                    recorded_violations += 1
                # Everything below this line counts admitted pairs only, which
                # is a smaller set than the rows in the dump: a pair outside the
                # lateral band is recorded and not admitted. The two counts are
                # both cited in the papers and were confused for each other on
                # 2026-09-01, comparing 117 admitted pairs against a figure of
                # 165 that counted every row, so both are now printed with the
                # difference named rather than left for a reader to notice.
                if row["within_band"] != "true":
                    continue
                cond = conditions.get((row["icao"], row["timestamp_utc"]))
                if cond is None:
                    missing_weather += 1
                    continue
                bucket = by_condition[cond]
                bucket["pairs"] += 1
                if float(row["margin_nm"]) < 0:
                    bucket["violating"] += 1

    print(f"windows pooled: {', '.join(used) or 'none'}")
    for note in skipped:
        print(f"  skipped: {note}")

    # A per-pair dump sitting in data/ under a tag this list does not name is
    # invisible otherwise, and on 2026-08-31 two of them had been invisible for
    # two days: windows that closed on 2026-08-29 and were never added, holding
    # 138 instrument-condition snapshots the pooled exposure was missing. The
    # list stays a list, because membership is a judgement about which doctrine a
    # window ran under and a glob cannot make it. Silence about the candidates is
    # what had to go.
    # os.listdir on a missing directory raises, and data/ is gitignored, so on a
    # clean clone it is absent. Crashing there would break the one script whose
    # job is to report honestly on a checkout that has no windows in it.
    if not args and os.path.isdir("data"):
        # Both lists, or a superseded window whose dump is present reports as
        # unlisted while sitting in the list written to record it.
        known = set(CORRECTED_WINDOWS) | set(SUPERSEDED_WINDOWS)
        found = sorted(
            f[len("pairs-"):-len(".csv")]
            for f in os.listdir("data")
            if f.startswith("pairs-") and f.endswith(".csv")
        )
        unlisted = [t for t in found if t not in known]
        for tag in unlisted:
            # Say whether it is still collecting. A window can be unlisted
            # because nobody has added it yet or because it is still open, and
            # those want opposite actions: add the first, wait for the second.
            # Without the distinction the message reads as "add this now",
            # which would pool a window that is still filling and is the exact
            # thing the still-sampling guard above exists to prevent.
            newest = newest_snapshot(tag)
            if newest is not None and (
                datetime.datetime.now(datetime.timezone.utc) - newest
            ).total_seconds() / 60 < STILL_RUNNING_MIN:
                print(
                    f"  UNLISTED (still sampling): data/pairs-{tag}.csv exists; "
                    "wait for it to close before adding it to a list"
                )
            else:
                print(f"  UNLISTED: data/pairs-{tag}.csv exists and neither list names it")
    print(f"snapshots by condition: {dict(sorted(snapshots.items()))}")
    if missing_weather:
        print(f"pairs with no matching snapshot weather: {missing_weather}")

    admitted = sum(b["pairs"] for b in by_condition.values())
    adm_viol = sum(b["violating"] for b in by_condition.values())
    print(
        f"\nrecorded pairs: {recorded_pairs} ({recorded_violations} violating); "
        f"of those, admitted: {admitted} ({adm_viol} violating). "
        "A recorded pair outside the lateral band is not admitted."
    )
    print("\nadmitted wake pairs by condition:")
    for cond in sorted(by_condition):
        b = by_condition[cond]
        rate = 100 * b["violating"] / b["pairs"] if b["pairs"] else 0.0
        print(f"  {cond:5s} {b['pairs']:5d} pairs  {b['violating']:5d} violating  ({rate:.0f}%)")

    imc_pairs = sum(by_condition[c]["pairs"] for c in IMC if c in by_condition)
    imc_snaps = sum(snapshots[c] for c in IMC if c in snapshots)
    vfr_snaps = snapshots.get("VFR", 0)
    vfr = by_condition.get("VFR", {"pairs": 0, "violating": 0})

    # How many instrument-condition pairs the sampling would be expected to
    # produce if the violation mechanism were identical in both conditions.
    # Two factors, both measured rather than assumed. Instrument conditions are
    # a small share of snapshots. And they carry less traffic: measured across
    # every window, a snapshot in instrument conditions holds about half the
    # classified aircraft of one in visual conditions, because low ceilings at
    # these fields cluster in the early morning while traffic is still ramping
    # up. Pair formation needs two aircraft on one final, so it scales roughly
    # with the square of the aircraft count, and halving traffic quarters the
    # opportunity.
    expected = None
    if vfr_snaps and vfr["pairs"] and imc_snaps:
        imc_flights = traffic.get("IMC", (0, 0))
        vfr_flights = traffic.get("VFR", (0, 0))
        if imc_flights[1] and vfr_flights[1]:
            imc_mean = imc_flights[0] / imc_flights[1]
            vfr_mean = vfr_flights[0] / vfr_flights[1]
            ratio = (imc_mean / vfr_mean) ** 2 if vfr_mean else 0
            expected = vfr["pairs"] * (imc_snaps / vfr_snaps) * ratio
            print(
                f"\ntraffic per snapshot: {imc_mean:.1f} aircraft in instrument "
                f"conditions against {vfr_mean:.1f} in visual"
            )
            print(
                f"expected instrument-condition pairs if the mechanism were "
                f"identical: {expected:.1f}"
            )

    print()
    # A pool of nothing is not the same statement as a pool of zero pairs. When
    # every listed window was skipped for missing files the honest report is
    # that the data is gone, not that the sky was empty: saying "0 snapshots
    # have been sampled" of windows that were sampled and lost is the kind of
    # sentence this project keeps finding in its own prose.
    if imc_snaps == 0 and skipped:
        # The reason has to come from the skips rather than be assumed. This
        # message said every skip was a missing file, which was true while that
        # was the only skip there was; adding the still-sampling skip made it
        # state a cause that did not apply and blame a machine move for a window
        # sitting complete on disk.
        live = [x for x in skipped if "still sampling" in x]
        gone = [x for x in skipped if "still sampling" not in x]
        parts = [
            f"VERDICT: no data. "
            + (
                f"The one listed window was skipped, "
                if len(skipped) == 1
                else f"All {len(skipped)} listed windows were skipped, "
            )
            + f"so this reports nothing rather than nothing found."
        ]
        if gone:
            parts.append(
                f" {'Its files are absent' if len(gone) == 1 else str(len(gone)) + ' because their files are absent'}: apps/atc/data/ is "
                f"gitignored and those windows did not survive a move between "
                f"machines, so the figures the papers quote from them cannot be "
                f"re-derived here."
            )
        if live:
            parts.append(
                f" {'It is still being written by the sampler' if len(live) == 1 else str(len(live)) + ' because the sampler is still writing to them'}. A "
                f"figure taken from a window still being written is a different "
                f"figure an hour later; re-run this once it closes."
            )
        print("".join(parts))

    elif imc_pairs == 0:
        note = (
            f"VERDICT: untestable at this sampling rate, which is a stronger "
            f"statement than untested. {imc_snaps} instrument-condition snapshots "
            f"have been sampled and produced no wake pairs."
        )
        if expected is not None:
            note += (
                f" The sampling would be expected to produce about {expected:.1f} "
                f"such pairs even if instrument conditions carried exactly the same "
                f"violation rate as visual ones, so observing none is what the "
                f"exposure predicts and is not evidence about the hypothesis."
            )
            if expected < 0.5:
                note += (
                    " The limit is traffic rather than weather. The instrument-"
                    "condition snapshots in these windows average well under one "
                    "classified aircraft, because the low ceilings they caught fell "
                    "in the small hours, so the exposure is not merely small but "
                    "near zero. Quoting a required multiple of it would be "
                    "arithmetic on a number that is effectively zero. Run with "
                    "--all-windows to see the instrument-condition traffic that has "
                    "been sampled historically, under superseded doctrine."
                )
            else:
                note += (
                    f" Reaching thirty pairs, enough to separate a real difference "
                    f"from noise, needs roughly {30 / expected:.0f} times the "
                    f"current instrument-condition exposure."
                )
        print(note)
        if show_all:
            all_window_exposure()
    else:
        imc_viol = sum(by_condition[c]["violating"] for c in IMC if c in by_condition)
        imc_rate = 100 * imc_viol / imc_pairs
        vfr_rate = 100 * vfr["violating"] / vfr["pairs"] if vfr["pairs"] else float("nan")
        imc_lo, imc_hi = wilson(imc_viol, imc_pairs)
        vfr_lo, vfr_hi = wilson(vfr["violating"], vfr["pairs"])
        print(
            f"CONTRAST: {imc_rate:.0f}% of {imc_pairs} instrument-condition pairs violate "
            f"(95% interval {100 * imc_lo:.0f} to {100 * imc_hi:.0f}%), against "
            f"{vfr_rate:.0f}% of {vfr['pairs']} visual-condition pairs "
            f"(95% interval {100 * vfr_lo:.0f} to {100 * vfr_hi:.0f}%)."
        )
        # Overlap is the readable form of "this sample cannot tell them apart".
        # It is reported instead of a bare sample-size threshold because a
        # threshold hides how wide the uncertainty actually is: at three pairs
        # the interval spans most of the unit interval, and a reader who is told
        # only "too few" has to guess that.
        if imc_lo <= vfr_rate / 100 <= imc_hi:
            print(
                "  The instrument-condition interval CONTAINS the visual-condition rate, "
                "so this sample cannot distinguish them. Any direction read from it is "
                "sampling noise."
            )
        elif imc_hi < vfr_lo or vfr_hi < imc_lo:
            print(
                "  The two intervals DO NOT OVERLAP, which is the first sample that could "
                "support a real difference. Check the pair count before relying on it."
            )
        else:
            print(
                "  The intervals overlap but neither rate sits inside the other's interval; "
                "suggestive and not conclusive."
            )
        if imc_pairs < 30:
            print(
                f"  {imc_pairs} pairs against a rule of thumb of about 30 for a proportion "
                f"comparison of this kind."
            )


if __name__ == "__main__":
    main()
