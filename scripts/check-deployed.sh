#!/usr/bin/env bash
#
# What is actually deployed, measured rather than inferred.
#
# Three times in two days a claim about the deployed site was about to be made
# from a git timestamp, and each time the timestamp meant something else: the
# most recent commit touching a file is not the date its behaviour arrived, and
# a deploy time recalled is not a deploy time looked up. Twice the wrong claim
# would have gone into a published paper. A commit date cannot answer "what is
# on the site"; fetching the site can.
#
# Compares the published research page against the local build and reports the
# page counts each one advertises. Any difference is a gap between what this
# repository holds and what a reader gets.
#
# Usage: ./scripts/check-deployed.sh
# Requires curl. Exits non-zero when the site cannot be read, never on a gap:
# a gap is a fact to report, and during a billing block it is the expected one.
set -uo pipefail

# Both published PDFs, not just the thesis. The site publishes two and the
# first version of this script checked one, which would have reported "no gap"
# on a day when only the other had moved.
SLUGS="atc-decision-support the-living-map"
BASE="https://www.fbritoferreira.com/research"
WEB="$(cd "$(dirname "$0")/../../web" && pwd)"
COUNTS="$WEB/src/papers/page-counts.json"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# The rendered page count is the one number that cannot be argued with, and it
# is why this compares PDFs rather than the pages around them: a research page
# does not state its own length anywhere a pattern can reach. The first version
# of this script "found" a count inside the letters of "Support" and "preview".
pages_of() {
  if command -v pdfinfo >/dev/null; then
    pdfinfo "$1" 2>/dev/null | awk '/^Pages/{print $2}'
  else
    strings "$1" | grep -c "/Type[[:space:]]*/Page[^s]"
  fi
}

gaps=0
for slug in $SLUGS; do
  out="$tmp/$slug.pdf"
  if ! curl -sS -L --max-time 90 -A "atc-deploy-check/1.0 (fbritoferreira.com)" \
       -o "$out" "$BASE/$slug.pdf" 2>/dev/null || [ ! -s "$out" ]; then
    echo "$slug: could not fetch $BASE/$slug.pdf" >&2
    exit 1
  fi
  live="$(pages_of "$out")"
  local_pdf="$WEB/public/research/$slug.pdf"
  built="$(pages_of "$local_pdf")"
  stated="$(grep -oE "\"$slug\": *[0-9]+" "$COUNTS" 2>/dev/null | grep -oE '[0-9]+' | head -1)"
  printf '%-22s served %s pp | built %s pp | page-counts.json %s pp\n' \
    "$slug" "${live:-?}" "${built:-?}" "${stated:-?}"
  # page-counts.json is what the site's own cards advertise, so a build that
  # did not update it is its own defect, separate from the deploy gap.
  if [ -n "$built" ] && [ -n "$stated" ] && [ "$built" != "$stated" ]; then
    echo "  STALE: page-counts.json disagrees with the built PDF; rebuild it"
    gaps=$((gaps + 1))
  fi
  if [ -n "$live" ] && [ -n "$built" ] && [ "$live" != "$built" ]; then
    echo "  GAP: $((built - live)) page(s) behind this checkout"
    gaps=$((gaps + 1))
  fi
done

# The application, not just the PDFs. Added 2026-09-01 after both papers said a
# reviewer meeting a refused feed gets a panel explaining what is unavailable,
# which is true of this checkout and false of the deployed build: the panel was
# added to an unmerged branch and none of the served bundles contains it. A
# claim about behaviour is a claim about a build, and the build a reader reaches
# is not the one in front of the author. This looks for one string that only the
# current source has, rather than trying to diff a minified bundle.
APP="https://atc.fbritoferreira.com"
MARKER="reconstructions of documented"
if grep -rq "$MARKER" src/components/FeedUnavailable.tsx 2>/dev/null; then
  found=0
  for asset in $(curl -s --compressed --max-time 30 "$APP/" 2>/dev/null \
    | tr -d '\000' | grep -oE '/assets/[A-Za-z0-9_.-]+\.js' | sort -u); do
    if curl -s --compressed --max-time 40 "$APP$asset" 2>/dev/null \
      | tr -d '\000' | grep -q "$MARKER"; then
      found=1
      break
    fi
  done
  if [ "$found" -eq 1 ]; then
    echo "application: the feed-unavailable panel is in the served bundle"
  else
    echo "application: GAP, the feed-unavailable panel is NOT in the served bundle"
    echo "  so the papers' description of what a refused feed looks like covers"
    echo "  this checkout and not the deployment."
    gaps=$((gaps + 1))
  fi
fi

if [ "$gaps" -eq 0 ]; then
  echo "no gap: the site serves what this checkout builds."
else
  echo "A gap means the deployment trails this checkout. Publishing was blocked"
  echo "from 2026-08-28 to 2026-09-01 by an account billing failure and now runs"
  echo "again, so what remains is whatever is unmerged. Measured here rather than"
  echo "inferred from a commit date, which was wrong three times in two days."
fi
