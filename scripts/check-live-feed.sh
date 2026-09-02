#!/usr/bin/env bash
# Is live mode actually working on the deployed application?
#
# Written 2026-09-01 after a hand probe reported the wrong diagnosis. The first
# attempt fetched /api/adsb/v2/point/{lat}/{lon}/{r}, which looks like the right
# shape and is a path this application never requests: its cache had therefore
# never been warmed, only the first upstream had been tried, and the answer named
# one refusing feed when two were refusing. The URL below is the one
# live-adsb.ts builds, kept in sync by the test that reads both.
#
# Exits 0 whether the feed is up or down. A check that fails on the expected
# state gets ignored, and the feed being closed is not this repository's defect
# to fix: adsb.lol rate-limits Cloudflare's shared egress, and airplanes.live
# needs an access request by email.
set -uo pipefail

HOST="${1:-https://atc.fbritoferreira.com}"
RANGE_NM=40

# Two fields, because a single airport cannot distinguish a feed-wide refusal
# from one bad coordinate.
probe() {
  local name="$1" lat="$2" lon="$3"
  local url="${HOST}/api/adsb/v2/lat/${lat}/lon/${lon}/dist/${RANGE_NM}"
  local body status
  body="$(curl -s --max-time 30 -w $'\n%{http_code}' "$url" 2>/dev/null)" || {
    printf '  %-6s unreachable\n' "$name"; return
  }
  status="${body##*$'\n'}"
  body="${body%$'\n'*}"
  if [ "$status" = "200" ]; then
    # readsb shape: aircraft live under ac[]. An ok-but-empty bubble inside
    # 40 NM of a major field is the soft-throttle signature, not a quiet sky.
    local count
    count="$(printf '%s' "$body" | grep -o '"hex"' | wc -l | tr -d ' ')"
    if [ "$count" -gt 0 ]; then
      printf '  %-6s ok, %s contacts\n' "$name" "$count"
    else
      printf '  %-6s HTTP 200 with no contacts (soft throttle, not a quiet sky)\n' "$name"
    fi
  else
    printf '  %-6s HTTP %s %s\n' "$name" "$status" "$(printf '%s' "$body" | head -c 160)"
  fi
}

echo "live feed, as the application requests it (${HOST}):"
probe KATL 33.6407 -84.4277
probe KJFK 40.6398 -73.7789
echo
echo "A refusal here means the deployed demo's live mode shows an error rather"
echo "than an empty sky; the scenario reconstructions are bundled and unaffected."
