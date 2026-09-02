"""Wilson score interval, shared by the analysis scripts that report rates.

Lives in its own module because two scripts need it and a copied statistical
function is the kind of duplicate that drifts silently: a fix to one copy
leaves the other reporting different intervals from the same window, and
nothing in the output would say which one a reader was looking at.

Pure standard library on purpose. This repository's analysis scripts take no
dependencies beyond it, so a reviewer can run them against a clean checkout.
"""
import math


def wilson(successes, n, z=1.96):
    """95 per cent Wilson score interval for a proportion.

    Chosen over the textbook normal approximation because that one is wrong in
    exactly the regime these tools operate in: at one pair out of one, or zero
    out of three, the normal interval has zero width or runs outside [0, 1] and
    would report false precision. Wilson stays inside the unit interval and
    stays wide when the sample is small, which is the honest behaviour here.

    n == 0 returns the whole unit interval rather than raising, because the
    callers report on buckets that a given window may not have populated at
    all, and "no information" is the correct answer for an empty bucket.
    """
    if n == 0:
        return (0.0, 1.0)
    p = successes / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = (z / denom) * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (max(0.0, centre - half), min(1.0, centre + half))


def disjoint(a, b):
    """True when two (lo, hi) intervals do not overlap.

    The readable form of "this sample can tell these two rates apart". Reported
    instead of a p-value because every other uncertainty statement in these
    scripts is an interval, and mixing the two idioms in one output invites a
    reader to compare a threshold against a width.
    """
    return a[1] < b[0] or b[1] < a[0]
