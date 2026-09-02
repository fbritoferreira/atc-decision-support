# The published window count could not be re-derived, so it was removed

Status: removed 2026-08-28. Found while reading the rendered PDF end to end as a stranger, the
method that produced the stale *tau* claims and the stale outline.

## The claim

Three artifacts said the same thing in their opening summary, the part an
outreach recipient or an adjudicator reads first:

- thesis Section 1.4: "a false-positive analysis across five 24-hour live windows"
- thesis Section 10: "through five 24-hour windows and three rounds of correction"
- whitepaper operational-readers box: "five 24-hour false-positive windows on
  live ADS-B (KJFK and KATL untuned, then KATL, O'Hare and Dallas Fort Worth
  through three rounds of correction)"

The whitepaper's own decomposition makes the arithmetic explicit: two untuned
windows plus three correction rounds is five. That was coherent when written.

## Why it is no longer supportable

Two rounds of correction have landed since, each measured against its own
window and each written up in a section of its own: removing the departure
blind spot (6.7.2) and departure attribution (6.7.3). On the paper's own
decomposition that makes seven windows and five rounds, not five and three.

The count is also wrong in its adjective. Section 6.7.1 states that the second
window ran 17.4 hours rather than 24, because both volunteer feeds began
refusing and the hours it lost were US midday. A summary calling every window
24-hour contradicts the section it summarises.

## Why a corrected number was not substituted

The measurement CSVs are gone. `apps/atc/data/` is gitignored, it did not
survive the move to the current machine, and no copy of `pairs-*.csv`,
`prox-*.csv` or `fp-*.log` exists here. Nobody can now recount the windows from
the evidence; the only surviving record is what the prose already claims, which
is the thing under suspicion.

Replacing an unverifiable five with an unverifiable seven would repeat the
defect at a different value. The count is therefore removed rather than
corrected, and the summaries point at the sections that enumerate the rounds,
which are the checkable form of the same statement. The airports stay, because
five US airports is checkable against Table 4 and does not drift.

## What this costs and what it buys

It costs a concrete number in a summary, which is a real loss for a reader
skimming the opening. It buys a claim that stays true as rounds accumulate, and
it removes a figure that a reviewer with the repository could not confirm.

The generalisable point is the one the measurement work keeps arriving at from
other directions: a countable claim in prose is a measurement, it drifts when
the work moves, and nobody looks in a summary for stale data.
`scripts/verify-paper-claims.mjs` automates the countable claims that have
ground truth in the code. This one had its ground truth in a data directory,
and the data directory is exactly what did not survive.
