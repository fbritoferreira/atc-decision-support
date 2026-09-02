"""Opening a measurement window, or explaining precisely why it is not there.

data/ is gitignored, so a tag exists only if it was sampled on the machine
running the script. A reader following README.md runs these tools with the tag
`demo`, which nobody has, and got a nine-line Python traceback ending in
FileNotFoundError. That names the path and nothing else: not that windows are
never distributed, not how to make one, not which tags this checkout does have.

The same shape was already fixed twice in this repository. imc-pool.py reported
"0 snapshots have been sampled" of windows that were sampled and lost, stating a
null result where the truth was missing data, and hour-match-compare.py died on
UnboundLocalError when every airport was skipped. This module exists so the
third and fourth cases are fixed in one place rather than a third and fourth
time.
"""
import glob
import os
import re
import sys
import time


# A window still being written gives a different answer every time it is read.
# imc-pool.py refuses such a window outright, because pooling a moving figure
# into a published contrast is the specific harm there. These other tools are
# sometimes run mid-window on purpose, to see whether a collection is behaving,
# so this warns loudly instead of exiting: the harm is not reading a partial
# window, it is reading one without knowing.
#
# Judged by the file's modification time rather than by parsing timestamps,
# because every window CSV is appended to as it is collected and mtime is the
# one signal that works for all of them.
STILL_SAMPLING_MIN = 10


def _warn_if_still_sampling(path):
    age_min = (time.time() - os.path.getmtime(path)) / 60
    if age_min < STILL_SAMPLING_MIN:
        print(
            f"WARNING: {path} was written {age_min:.0f} min ago, so the sampler is\n"
            f"probably still appending to it. Every figure below is partial and will\n"
            f"differ when the window closes. Do not quote it.\n",
            file=sys.stderr,
        )


def known_tags():
    """Every tag with at least one file in data/, newest first by file time."""
    seen = {}
    for path in glob.glob("data/*.csv"):
        m = re.match(r"(?:fp-[a-z]{4}|prox|pairs)-(.+)\.csv$", os.path.basename(path))
        if m:
            seen[m.group(1)] = max(seen.get(m.group(1), 0), os.path.getmtime(path))
    return [t for t, _ in sorted(seen.items(), key=lambda kv: -kv[1])]


def open_window(path, tag, airport=None):
    """Open a window CSV, or exit with what is missing and how to produce it.

    Exits rather than raising: these are single-purpose command-line tools with
    no caller that could do anything useful with the exception, and a traceback
    puts the interpreter's frame stack where the instruction should be.
    """
    try:
        handle = open(path)
    except FileNotFoundError:
        handle = None
    if handle is not None:
        _warn_if_still_sampling(path)
        return handle

    # Wrong directory before missing data. These scripts read "data/..." relative
    # to the working directory, so run from the repository root they found no
    # data/ at all and the first version of this message reported "Tags present:
    # none in this checkout" for a window sitting on disk one level down. That
    # would send a reader to re-sample twenty-four hours they already had, which
    # is a worse outcome than the FileNotFoundError this replaced.
    app_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if not os.path.isdir("data"):
        sys.exit(
            f"{path} not found, and there is no data/ directory here at all.\n"
            f"\n"
            f"These scripts read window files by a path relative to the working\n"
            f"directory. Run them from {app_dir}\n"
            f"rather than {os.getcwd()}.\n"
        )

    tags = known_tags()
    have = ", ".join(tags) if tags else "none in this checkout"
    sample_airport = airport.upper() if airport else "KATL"
    sys.exit(
        f"{path} not found.\n"
        f"\n"
        f"Measurement windows are not distributed. data/ is gitignored, so tag\n"
        f"'{tag}' exists only if it was sampled here. Tags present: {have}.\n"
        f"\n"
        f"To sample one (24 hours, roughly 2.4 MB for three airports):\n"
        f"  ./node_modules/.bin/tsx scripts/fp-analysis.mjs "
        f"--airport={sample_airport} --hours=24 --tag={tag}\n"
    )


def scope_line(rows):
    """One line naming the airports and time span a window actually covers.

    Comparing two of these outputs is the obvious thing to do with them, and the
    obvious comparison is wrong whenever the windows differ in what they cover.
    On 2026-08-30 a 37.6%-to-92.4% improvement in departure attribution turned
    out to be 6.7 points once the airport set and the hours were held fixed: the
    earlier window sampled three fields and the later one sampled Atlanta alone,
    which attributes far better than the other two. Every number in the raw
    comparison was correct. Printing the scope does not stop anyone comparing
    windows that do not match; it stops the mismatch being invisible in the
    output being compared.
    """
    fields = sorted({r["icao"] for r in rows if r.get("icao")})
    times = sorted(r["timestamp_utc"] for r in rows if r.get("timestamp_utc"))
    span = ""
    if times:
        # Both dates when they differ. Printing the start date for both ends
        # made a twenty-four-hour window read "16:23Z to 16:23Z on 2026-08-28",
        # a span of zero on the face of it, hiding that it crosses a day.
        d0, d1 = times[0][:10], times[-1][:10]
        span = (
            f", {times[0][11:16]}Z to {times[-1][11:16]}Z on {d0}"
            if d0 == d1
            else f", {d0} {times[0][11:16]}Z to {d1} {times[-1][11:16]}Z"
        )
    return (
        f"  scope: {', '.join(fields) or 'no airport column'}{span}\n"
        f"  compare only against a window with the same fields and hours"
    )


def airports_in(tag):
    """The airports actually sampled for a tag, lowercase, in sorted order.

    Scripts here defaulted to a fixed ["katl", "kord", "kdfw"], which is right
    for a three-field measurement window and wrong for anything else. The
    watcher launches single-field windows on an IFR event, so
    wake-condition-split.py on one of those looked for data/fp-kord-<tag>.csv,
    did not find it, and printed the missing-window message: a reader is told to
    sample twenty-four hours they already have, in a different shape. That is
    the same failure this module was written to remove, one level up.
    """
    found = set()
    for path in glob.glob(f"data/fp-*-{tag}.csv"):
        m = re.match(rf"fp-([a-z]{{4}})-{re.escape(tag)}\.csv$", os.path.basename(path))
        if m:
            found.add(m.group(1))
    return sorted(found)
