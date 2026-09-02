#!/usr/bin/env python3
"""Regenerate src/sim/runway-ends-data.ts from FAA NASR (US) and OurAirports (rest).

Usage:
  curl -sL -o /tmp/runways.csv https://davidmegginson.github.io/ourairports-data/runways.csv
  # NASR: download the current 28-day APT_CSV.zip from
  # https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/
  # and unzip; pass APT_RWY_END.csv as the second argument.
  python3 scripts/gen-runway-geometry.py /tmp/runways.csv /tmp/nasr/APT_RWY_END.csv

US airports take their end coordinates from NASR, the FAA's own surveyed data
(public domain, LAT_DECIMAL/LONG_DECIMAL per runway end); everything else falls
back to OurAirports. Run without the NASR argument and the whole file comes
from OurAirports, which is how the deltas were found in the first place:
against the 2026-08-06 NASR cycle, OurAirports had KORD 09R/27L's east end
3,589 ft short (the 2021 extension), KJFK 22R off 732 ft and KATL 27R off
496 ft. All 51 US strips match NASR by ident.

Matches every strip in src/sim/airports.ts by ident with zero-padding
normalised, orients ends to the registry id order, and validates the result
three ways before writing anything: every strip must match, coordinate-derived
length is compared against the dataset's published length (mismatches are
reported, not fatal: they follow the pattern of pre-extension or
displaced-threshold coordinates, which moves a threshold along its own track
and barely moves the centreline direction), and coordinate-derived true
NOT DONE, AND WORTH DOING: this script emits coordinates only, so the registry's
magnetic `headingDeg` stays hand-entered, and hand-entry is where the defect
found on 2026-08-29 came from. Six of the ten US fields disagree with themselves
about their own magnetic variation, and at KATL and KDEN the wrong value is
demonstrably the runway designator: five KATL strips share one true course of
90.0 and four read 92 while 10/28 reads 99, which is its name rather than its
bearing. Both are fields with more parallel strips than L, C and R can label, so
the designator has been shifted off the magnetic bearing and someone read the
heading off the name.

NASR publishes what is needed to stop hand-entering it: a true alignment per
runway end in the same APT_RWY_END records this script already reads, and a
magnetic variation per airport in the airport base record. Magnetic heading is
the first minus the second. Confirm the column names against a current
subscription before relying on them; they are not quoted here because this file
has never read them. Deriving headingDeg the same way the coordinates are
derived would remove the whole class, and is the actual fix rather than
correcting the two fields the tests currently pin.

Two things for that regeneration to pick up, both established since this note
was written and neither applied here, because a value that will be published
should carry the same provenance as the rows around it:

1. The contradiction is measurable now without any subscription. Every runway
   at one airport shares one variation, so the difference between stored
   heading and the bearing these thresholds imply has to be constant across a
   field. Five contradict themselves: KSFO 14.8 degrees of spread, KBOS 11.9,
   KORD 10.5, KDFW 8.9, KATL 7.0. See src/sim/heading-consistency.ts, which
   the suite pins. That says which strips are wrong; it does not supply the
   corrected magnetic bearing, which is what the subscription is for.

2. Airport elevation is not carried anywhere in this repository, and
   inferRunway's altitude gate needs it. The gate is absolute MSL, so at
   Denver, which sits above the 5,000 ft cutoff, runway attribution never
   fires and two detectors are inert. APT_BASE.csv publishes elevation; add
   it to the registry and make the gate height-above-field.

3. KORD 09R/27L states 7,500 ft against 11,231 between its own thresholds,
   because the coordinates were rebuilt for the 2021 extension and the length
   was not. A published figure of 11,260 ft was found for that strip and is
   deliberately not applied: it came from a search rather than from a cycle.
   Take it from APT_RWY.csv when regenerating.

bearing is compared against the registry's magnetic heading (deltas beyond
about 16 degrees are reported; KBOS is a known registry error, see the header
of the generated file).
"""
import csv, json, math, re, sys

CSV = sys.argv[1] if len(sys.argv) > 1 else "/tmp/runways.csv"
NASR = sys.argv[2] if len(sys.argv) > 2 else None
REG = "src/sim/airports.ts"
OUT = "src/sim/runway-ends-data.ts"

# ICAO to FAA location identifier for the US airports in the registry.
FAA_ID = {"KJFK": "JFK", "KLAX": "LAX", "KSFO": "SFO", "KORD": "ORD",
          "KATL": "ATL", "KDEN": "DEN", "KDFW": "DFW", "KSEA": "SEA",
          "KBOS": "BOS", "KMIA": "MIA"}

reg = {}
src = open(REG).read()
for am in re.finditer(r'icao: "(\w+)"(.*?)gates: generateGates', src, re.S):
    icao, body = am.group(1), am.group(2)
    reg[icao] = re.findall(r'\{ id: "([^"]+)", headingDeg: (\d+), lengthFt: (\d+)', body)

def norm(ident):
    m = re.match(r"0?(\d+[LRC]?)$", ident.strip())
    return m.group(1) if m else ident.strip()

rows = {}
with open(CSV) as f:
    for r in csv.DictReader(f):
        if r["airport_ident"] in reg:
            rows.setdefault(r["airport_ident"], []).append(r)

def dist_nm(lat1, lon1, lat2, lon2):
    R = 3440.065
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))

def true_bearing(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360

nasr_ends = {}
if NASR:
    with open(NASR) as f:
        for r in csv.DictReader(f):
            if r["ARPT_ID"] in FAA_ID.values() and r["LAT_DECIMAL"] and r["LONG_DECIMAL"]:
                strip_ends = frozenset(norm(x) for x in r["RWY_ID"].split("/"))
                nasr_ends[(r["ARPT_ID"], strip_ends, norm(r["RWY_END_ID"]))] = (
                    float(r["LAT_DECIMAL"]), float(r["LONG_DECIMAL"]))

out, problems, missing = {}, [], []
for icao, strips in reg.items():
    out[icao] = []
    for sid, hdg, length in strips:
        le, he = sid.split("/")
        hit = next(
            (r for r in rows.get(icao, [])
             if {norm(r["le_ident"]), norm(r["he_ident"])} == {norm(le), norm(he)}),
            None,
        )
        if not hit:
            missing.append(f"{icao} {sid}")
            continue
        swap = norm(hit["le_ident"]) != norm(le)
        val = lambda k: float(hit[("he_" if swap else "le_") + k] if k.startswith("lat") or k.startswith("lon") else hit[k])
        lelat = float(hit["he_latitude_deg" if swap else "le_latitude_deg"])
        lelon = float(hit["he_longitude_deg" if swap else "le_longitude_deg"])
        helat = float(hit["le_latitude_deg" if swap else "he_latitude_deg"])
        helon = float(hit["le_longitude_deg" if swap else "he_longitude_deg"])
        # NASR overrides for US airports: the FAA's surveyed end positions.
        if NASR and icao in FAA_ID:
            key = frozenset((norm(le), norm(he)))
            n_le = nasr_ends.get((FAA_ID[icao], key, norm(le)))
            n_he = nasr_ends.get((FAA_ID[icao], key, norm(he)))
            if not n_le or not n_he:
                sys.exit(f"FATAL: {icao} {sid} missing from NASR")
            lelat, lelon = n_le
            helat, helon = n_he
        geolen = dist_nm(lelat, lelon, helat, helon) * 6076.12
        dslen = int(hit["length_ft"] or 0)
        if dslen and abs(geolen - dslen) > 500:
            problems.append(f"{icao} {sid}: coord length {geolen:.0f} vs dataset {dslen}")
        tb = true_bearing(lelat, lelon, helat, helon)
        dh = min(abs(tb - int(hdg)), 360 - abs(tb - int(hdg)))
        if dh > 16:
            problems.append(f"{icao} {sid}: true bearing {tb:.0f} vs registry mag {hdg}")
        out[icao].append((sid, lelat, lelon, helat, helon))

if missing:
    sys.exit("FATAL, unmatched strips: " + ", ".join(missing))
for p in problems:
    print(" note:", p)

head = open(OUT).read().split("export const RUNWAY_ENDS")[0]
body = ["export const RUNWAY_ENDS: Record<string, Record<string, RunwayEnds>> = {"]
for icao, strips in out.items():
    body.append(f"  {icao}: {{")
    for sid, a, b, c, d in strips:
        body.append(f'    "{sid}": {{ leLat: {a}, leLon: {b}, heLat: {c}, heLon: {d} }},')
    body.append("  },")
body.append("};")
open(OUT, "w").write(head + "\n".join(body) + "\n")
print(f"wrote {OUT}: {sum(len(v) for v in out.values())} strips")
