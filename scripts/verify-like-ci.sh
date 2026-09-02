#!/usr/bin/env bash
# Run what deploy.yml runs, in its order, from a single command.
#
# Written after 245 passing tests hid three TS2304 errors for an hour (finding
# 122 in the findings ledger). The suite is what gets run after a change, and
# the suite was green; `tsc --noEmit` was not, and nothing was asking it. CI
# does run the typecheck, so this would have been caught on merge, except CI
# has not executed a step since 2026-08-28 for a billing reason. The net was
# the one that was switched off.
#
# Keep this in step with deploy.yml. The check below fails if that file grows a
# run: line naming a pnpm command this script does not carry, which is the only
# way the two stay honest without a human diffing them.
# One ordering trap: the suite checks generated documents in the sibling
# documents checkout, including the T-AES candidate, which is assembled from the
# outreach whitepaper. Change a count in the whitepaper and the candidate still
# carries the old one until it is rebuilt, so `atc test` fails here on a
# document neither repository has edited. Rebuild the generated artifacts
# first: build-taes-candidate.py in that checkout, then build-whitepaper-pdf.sh.
set -uo pipefail
# Resolved before the cd, because the drift guard below greps this script by
# path and $0 is relative to where it was invoked from. After changing
# directory a relative $0 no longer resolves, grep fails to open it, and the
# guard reports every command in the workflow as missing from a script that
# contains all of them. That made the guard depend on being run from the repo
# root, which nothing said and nothing checked. Found 2026-09-02.
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$0")/../../.." || exit 2

fail=0
run() {
  local label=$1; shift
  printf '%-34s' "$label"
  if out=$("$@" 2>&1); then
    echo "ok"
  else
    echo "FAILED"
    echo "$out" | tail -20 | sed 's/^/    /'
    fail=1
  fi
}

run "atc typecheck"   pnpm --filter @fbritoferreira/atc typecheck
run "atc typecheck (edge)" pnpm --filter @fbritoferreira/atc typecheck:functions
# The long-form documents sit in a separate checkout beside this one. Its
# directory name is not recorded here, because this repository is public and
# that one is not. It is found by looking for the paper itself in each sibling
# directory, and the two steps that need it skip by name when it is absent.
DOCS_DIR=""
for candidate in ../*/; do
  if [ -f "${candidate}atc_whitepaper.md" ]; then DOCS_DIR="${candidate%/}"; break; fi
done
[ -n "${ATC_DOCS_DIR:-}" ] && [ -f "$ATC_DOCS_DIR/atc_whitepaper.md" ] && DOCS_DIR="$ATC_DOCS_DIR"

# Not a CI step: the workflow has no documents checkout, so this can only run
# locally. It goes before `atc test` because it names the ordering trap above
# instead of leaving it to be inferred.
#
# It also covers more than that trap. The trap is the case where drift touches a
# checked count, and `atc test` then fails on a generated document neither
# repository has edited. Where drift touches anything else, and most of a paper
# is anything else, nothing noticed at all: editing a sentence in the whitepaper
# and running the whole suite gave nine passes and a stale candidate. Measured,
# not assumed, by planting exactly that edit.
if [ -n "$DOCS_DIR" ] && [ -f "$DOCS_DIR/scripts/build-taes-candidate.py" ]; then
  run "candidate freshness" python3 "$DOCS_DIR/scripts/build-taes-candidate.py" --check
else
  printf '  %-33s %s\n' "candidate freshness" "skipped, no documents checkout beside this one"
fi

# Same reasoning, the figures. Byte-reproducible with the date pinned, so a
# rebuild can be compared against the committed PDFs; the label agreement check
# in verify-paper-claims.mjs compares what the diagrams say, and this compares
# whether the artefact was rebuilt after its source changed.
if [ -n "$DOCS_DIR" ] && [ -f "$DOCS_DIR/scripts/build-figures.sh" ]; then
  run "figure freshness" "$DOCS_DIR/scripts/build-figures.sh" --check
else
  printf '  %-33s %s\n' "figure freshness" "skipped, no documents checkout beside this one"
fi

# Not a CI step either, and not a test: it reports when the set of absolute
# claims moves, because three of them were false on 2026-09-01 and no numeric
# check could have caught any. A new claim is the one nothing has read in
# context yet.
run "absolute claims"  pnpm --filter @fbritoferreira/atc exec tsx scripts/absolute-claims.mjs --check

run "atc test"        pnpm --filter @fbritoferreira/atc test
run "atc test count"  pnpm --filter @fbritoferreira/atc exec tsx scripts/check-test-count.mjs
run "atc build"       pnpm --filter @fbritoferreira/atc build
# The web steps only exist in the monorepo. `extract-standalone.sh` copies this
# app out on its own, and the published artifact has no web package, where pnpm
# exits zero when a filter matches nothing: three steps reported ok having run
# nothing, and the whole script still said all clean. That was found on
# 2026-09-02 by cloning the public repository and running this, which is the
# obvious first thing a reviewer does and the one thing nobody here had done
# since it went public. Skipping loudly is the fix; passing quietly was the bug.
if pnpm ls --filter @fbritoferreira/web --depth -1 >/dev/null 2>&1 &&
   [ -n "$(pnpm ls --filter @fbritoferreira/web --depth -1 --json 2>/dev/null | tr -d '[:space:]' | sed 's/\[\]//')" ]; then
  run "web check"       pnpm --filter @fbritoferreira/web check
  run "web unit tests"  pnpm --filter @fbritoferreira/web test:unit
  run "web build"       pnpm --filter @fbritoferreira/web build
else
  for step in "web check" "web unit tests" "web build"; do
    printf '  %-33s %s\n' "$step" "skipped, no web package in this checkout"
  done
fi

# Drift guard: every pnpm command deploy.yml runs must appear above, compared as
# whole command lines. An earlier version captured only the first word after the
# package name, which turned `... web exec playwright install` into `web exec`
# and made the guard fail permanently against a correct script. A guard that
# always fires is read as noise, which is the failure mode it exists to prevent.
#
# Exemptions carry their reason, one per line, matched as a substring:
#   playwright install  -- downloads browser binaries; test:unit needs none, and
#                          the e2e suite CI runs after it is not run locally.
wf=.github/workflows/deploy.yml
exempt="playwright install"
# The workflow is not copied into the standalone artifact, so this guard has
# nothing to compare against there. It used to grep the absent file, print a
# "No such file or directory" into the middle of the run, and let the script
# finish clean: the guard that exists to stop this script drifting from CI was
# itself the loudest thing failing, and it failed without failing.
if [ ! -f "$wf" ]; then
  printf '  %-33s %s\n' "deploy.yml drift" "skipped, no workflow in this checkout"
else
missing=$(grep -oE 'run: pnpm --filter @fbritoferreira/(atc|web) .*' "$wf" \
  | sed 's/run: //' | sort -u | while read -r cmd; do
      case "$cmd" in *"$exempt"*) continue ;; esac
      grep -qF "$cmd" "$SELF" || echo "  $cmd"
    done)
if [ -n "$missing" ]; then
  echo
  echo "deploy.yml runs commands this script does not:"
  echo "$missing"
  fail=1
fi
fi

[ "$fail" -eq 0 ] && echo "all clean" || echo "see failures above"
exit "$fail"
