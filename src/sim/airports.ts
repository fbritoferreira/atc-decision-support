import type { Gate, Runway } from "./types";

export type Airport = {
  icao: string;
  iata: string;
  name: string;
  city: string;
  arp: { lat: number; lon: number };
  runways: Runway[];
  gates: Gate[];
};

const generateGates = (terminals: { name: string; size: "medium" | "heavy" | "super"; count: number }[]): Gate[] => {
  const gates: Gate[] = [];
  let n = 1;
  for (const t of terminals) {
    for (let i = 0; i < t.count; i++) {
      gates.push({ id: `${t.name}${n}`, terminal: t.name, maxWake: t.size });
      n++;
    }
  }
  return gates;
};

export const AIRPORTS: Record<string, Airport> = {
  KJFK: {
    icao: "KJFK",
    iata: "JFK",
    name: "John F. Kennedy Intl",
    city: "New York, NY",
    arp: { lat: 40.6398, lon: -73.7789 },
    runways: [
      { id: "04L/22R", headingDeg: 44, lengthFt: 12079, mode: "mixed", surfaceFriction: "dry" },
      { id: "04R/22L", headingDeg: 44, lengthFt: 8400, mode: "mixed", surfaceFriction: "dry" },
      { id: "13L/31R", headingDeg: 134, lengthFt: 10000, mode: "mixed", surfaceFriction: "dry" },
      { id: "13R/31L", headingDeg: 134, lengthFt: 14572, mode: "mixed", surfaceFriction: "dry" },
    ],
    gates: generateGates([
      { name: "T1-", size: "super", count: 4 },
      { name: "T4-", size: "super", count: 6 },
      { name: "T5-", size: "medium", count: 6 },
      { name: "T7-", size: "heavy", count: 4 },
      { name: "T8-", size: "super", count: 6 },
    ]),
  },
  KLAX: {
    icao: "KLAX",
    iata: "LAX",
    name: "Los Angeles Intl",
    city: "Los Angeles, CA",
    arp: { lat: 33.9425, lon: -118.4081 },
    runways: [
      { id: "06L/24R", headingDeg: 69, lengthFt: 8925, mode: "mixed", surfaceFriction: "dry" },
      { id: "06R/24L", headingDeg: 69, lengthFt: 10885, mode: "mixed", surfaceFriction: "dry" },
      { id: "07L/25R", headingDeg: 69, lengthFt: 12091, mode: "mixed", surfaceFriction: "dry" },
      { id: "07R/25L", headingDeg: 69, lengthFt: 11095, mode: "mixed", surfaceFriction: "dry" },
    ],
    gates: generateGates([
      { name: "T1-", size: "medium", count: 6 },
      { name: "T2-", size: "heavy", count: 4 },
      { name: "T4-", size: "super", count: 6 },
      { name: "TBIT-", size: "super", count: 6 },
      { name: "T7-", size: "heavy", count: 4 },
    ]),
  },
  KSFO: {
    icao: "KSFO",
    iata: "SFO",
    name: "San Francisco Intl",
    city: "San Francisco, CA",
    arp: { lat: 37.6188, lon: -122.3754 },
    runways: [
      { id: "01L/19R", headingDeg: 14, lengthFt: 7650, mode: "departures", surfaceFriction: "dry" },
      { id: "01R/19L", headingDeg: 14, lengthFt: 8650, mode: "departures", surfaceFriction: "dry" },
      { id: "10L/28R", headingDeg: 119, lengthFt: 11870, mode: "arrivals", surfaceFriction: "dry" },
      { id: "10R/28L", headingDeg: 119, lengthFt: 11381, mode: "arrivals", surfaceFriction: "dry" },
    ],
    gates: generateGates([
      { name: "T1-", size: "heavy", count: 6 },
      { name: "T2-", size: "medium", count: 4 },
      { name: "T3-", size: "heavy", count: 6 },
      { name: "Intl-", size: "super", count: 6 },
    ]),
  },
  KORD: {
    icao: "KORD",
    iata: "ORD",
    name: "Chicago O'Hare Intl",
    city: "Chicago, IL",
    arp: { lat: 41.9786, lon: -87.9048 },
    runways: [
      { id: "04L/22R", headingDeg: 40, lengthFt: 7500, mode: "mixed", surfaceFriction: "dry" },
      { id: "04R/22L", headingDeg: 40, lengthFt: 8075, mode: "mixed", surfaceFriction: "dry" },
      { id: "09L/27R", headingDeg: 92, lengthFt: 7967, mode: "mixed", surfaceFriction: "dry" },
      { id: "09C/27C", headingDeg: 92, lengthFt: 11245, mode: "mixed", surfaceFriction: "dry" },
      { id: "09R/27L", headingDeg: 92, lengthFt: 7500, mode: "mixed", surfaceFriction: "dry" },
      { id: "10L/28R", headingDeg: 99, lengthFt: 13000, mode: "mixed", surfaceFriction: "dry" },
      { id: "10C/28C", headingDeg: 99, lengthFt: 10800, mode: "mixed", surfaceFriction: "dry" },
      { id: "10R/28L", headingDeg: 99, lengthFt: 7500, mode: "mixed", surfaceFriction: "dry" },
    ],
    gates: generateGates([
      { name: "T1-", size: "heavy", count: 6 },
      { name: "T2-", size: "medium", count: 6 },
      { name: "T3-", size: "heavy", count: 6 },
      { name: "T5-", size: "super", count: 6 },
    ]),
  },
  KATL: {
    icao: "KATL",
    iata: "ATL",
    name: "Hartsfield–Jackson Atlanta Intl",
    city: "Atlanta, GA",
    arp: { lat: 33.6407, lon: -84.4277 },
    runways: [
      { id: "08L/26R", headingDeg: 92, lengthFt: 9000, mode: "mixed", surfaceFriction: "dry" },
      { id: "08R/26L", headingDeg: 92, lengthFt: 10000, mode: "mixed", surfaceFriction: "dry" },
      { id: "09L/27R", headingDeg: 92, lengthFt: 12390, mode: "mixed", surfaceFriction: "dry" },
      { id: "09R/27L", headingDeg: 92, lengthFt: 9000, mode: "mixed", surfaceFriction: "dry" },
      { id: "10/28", headingDeg: 99, lengthFt: 9000, mode: "mixed", surfaceFriction: "dry" },
    ],
    gates: generateGates([
      { name: "T-", size: "medium", count: 6 },
      { name: "A-", size: "heavy", count: 8 },
      { name: "F-", size: "super", count: 6 },
    ]),
  },
  KDEN: {
    icao: "KDEN",
    iata: "DEN",
    name: "Denver Intl",
    city: "Denver, CO",
    arp: { lat: 39.8617, lon: -104.6731 },
    runways: [
      { id: "07/25", headingDeg: 84, lengthFt: 12000, mode: "mixed", surfaceFriction: "dry" },
      { id: "08/26", headingDeg: 84, lengthFt: 12000, mode: "mixed", surfaceFriction: "dry" },
      { id: "16L/34R", headingDeg: 174, lengthFt: 12000, mode: "mixed", surfaceFriction: "dry" },
      { id: "16R/34L", headingDeg: 174, lengthFt: 16000, mode: "mixed", surfaceFriction: "dry" },
      // 174, not 184. All six KDEN strips share one true course family, and
      // four of them give a variation of -6.5 degrees against these two at
      // +3.5: the wrong sign for a field where magnetic runs about eight
      // degrees east of true. The 184 came from the runway designator, which
      // is shifted here because six parallels need more labels than L, C and R
      // provide. Corrected 2026-08-29; KDEN is not in the sampling set, so
      // this could land while a measurement window was open on KATL, KORD and
      // KDFW, whose equivalents stay pinned until it closes.
      { id: "17L/35R", headingDeg: 174, lengthFt: 12000, mode: "mixed", surfaceFriction: "dry" },
      { id: "17R/35L", headingDeg: 174, lengthFt: 12000, mode: "mixed", surfaceFriction: "dry" },
    ],
    gates: generateGates([
      { name: "A-", size: "heavy", count: 8 },
      { name: "B-", size: "medium", count: 8 },
      { name: "C-", size: "super", count: 8 },
    ]),
  },
  KDFW: {
    icao: "KDFW",
    iata: "DFW",
    name: "Dallas/Fort Worth Intl",
    city: "Dallas, TX",
    arp: { lat: 32.8998, lon: -97.0403 },
    runways: [
      { id: "13L/31R", headingDeg: 134, lengthFt: 9301, mode: "mixed", surfaceFriction: "dry" },
      { id: "13R/31L", headingDeg: 134, lengthFt: 9301, mode: "mixed", surfaceFriction: "dry" },
      { id: "17C/35C", headingDeg: 184, lengthFt: 13401, mode: "mixed", surfaceFriction: "dry" },
      { id: "17L/35R", headingDeg: 184, lengthFt: 8500, mode: "mixed", surfaceFriction: "dry" },
      { id: "17R/35L", headingDeg: 184, lengthFt: 13401, mode: "mixed", surfaceFriction: "dry" },
      { id: "18L/36R", headingDeg: 184, lengthFt: 13401, mode: "mixed", surfaceFriction: "dry" },
      { id: "18R/36L", headingDeg: 184, lengthFt: 13401, mode: "mixed", surfaceFriction: "dry" },
    ],
    gates: generateGates([
      { name: "A-", size: "heavy", count: 8 },
      { name: "C-", size: "medium", count: 6 },
      { name: "D-", size: "super", count: 8 },
      { name: "E-", size: "heavy", count: 6 },
    ]),
  },
  KSEA: {
    icao: "KSEA",
    iata: "SEA",
    name: "Seattle–Tacoma Intl",
    city: "Seattle, WA",
    arp: { lat: 47.4502, lon: -122.3088 },
    runways: [
      { id: "16L/34R", headingDeg: 174, lengthFt: 11901, mode: "mixed", surfaceFriction: "dry" },
      { id: "16C/34C", headingDeg: 174, lengthFt: 9426, mode: "mixed", surfaceFriction: "dry" },
      { id: "16R/34L", headingDeg: 174, lengthFt: 8500, mode: "mixed", surfaceFriction: "dry" },
    ],
    gates: generateGates([
      { name: "A-", size: "medium", count: 6 },
      { name: "B-", size: "heavy", count: 6 },
      { name: "C-", size: "super", count: 6 },
      { name: "S-", size: "super", count: 4 },
    ]),
  },
  KBOS: {
    icao: "KBOS",
    iata: "BOS",
    name: "Boston Logan Intl",
    city: "Boston, MA",
    arp: { lat: 42.3656, lon: -71.0096 },
    runways: [
      { id: "04L/22R", headingDeg: 44, lengthFt: 7861, mode: "mixed", surfaceFriction: "dry" },
      { id: "04R/22L", headingDeg: 44, lengthFt: 10081, mode: "mixed", surfaceFriction: "dry" },
      { id: "09/27", headingDeg: 89, lengthFt: 7000, mode: "mixed", surfaceFriction: "dry" },
      { id: "14/32", headingDeg: 144, lengthFt: 5000, mode: "mixed", surfaceFriction: "dry" },
      { id: "15R/33L", headingDeg: 149, lengthFt: 10005, mode: "mixed", surfaceFriction: "dry" },
      { id: "15L/33R", headingDeg: 149, lengthFt: 2557, mode: "mixed", surfaceFriction: "dry" },
    ],
    gates: generateGates([
      { name: "A-", size: "heavy", count: 6 },
      { name: "B-", size: "medium", count: 6 },
      { name: "C-", size: "heavy", count: 6 },
      { name: "E-", size: "super", count: 6 },
    ]),
  },
  KMIA: {
    icao: "KMIA",
    iata: "MIA",
    name: "Miami Intl",
    city: "Miami, FL",
    arp: { lat: 25.7959, lon: -80.287 },
    runways: [
      { id: "08L/26R", headingDeg: 89, lengthFt: 8600, mode: "mixed", surfaceFriction: "dry" },
      { id: "08R/26L", headingDeg: 89, lengthFt: 10506, mode: "mixed", surfaceFriction: "dry" },
      { id: "09/27", headingDeg: 89, lengthFt: 13016, mode: "mixed", surfaceFriction: "dry" },
      { id: "12/30", headingDeg: 119, lengthFt: 9355, mode: "mixed", surfaceFriction: "dry" },
    ],
    gates: generateGates([
      { name: "D-", size: "heavy", count: 8 },
      { name: "E-", size: "super", count: 6 },
      { name: "F-", size: "heavy", count: 6 },
      { name: "H-", size: "super", count: 6 },
      { name: "J-", size: "super", count: 6 },
    ]),
  },
  OMDB: {
    icao: "OMDB",
    iata: "DXB",
    name: "Dubai International",
    city: "Dubai, UAE",
    arp: { lat: 25.2528, lon: 55.3644 },
    runways: [
      { id: "12L/30R", headingDeg: 119, lengthFt: 13287, mode: "mixed", surfaceFriction: "dry" },
      { id: "12R/30L", headingDeg: 119, lengthFt: 13123, mode: "mixed", surfaceFriction: "dry" },
    ],
    gates: generateGates([
      { name: "A-", size: "super", count: 8 },
      { name: "B-", size: "super", count: 8 },
      { name: "C-", size: "heavy", count: 8 },
      { name: "D-", size: "super", count: 6 },
    ]),
  },
  EGLL: {
    icao: "EGLL",
    iata: "LHR",
    name: "London Heathrow",
    city: "London, UK",
    arp: { lat: 51.4706, lon: -0.4619 },
    runways: [
      { id: "09L/27R", headingDeg: 89, lengthFt: 12798, mode: "mixed", surfaceFriction: "dry" },
      { id: "09R/27L", headingDeg: 89, lengthFt: 12001, mode: "mixed", surfaceFriction: "dry" },
    ],
    gates: generateGates([
      { name: "T2-", size: "super", count: 6 },
      { name: "T3-", size: "super", count: 6 },
      { name: "T4-", size: "heavy", count: 6 },
      { name: "T5-", size: "super", count: 8 },
    ]),
  },
  LPPR: {
    icao: "LPPR",
    iata: "OPO",
    name: "Francisco Sá Carneiro",
    city: "Porto, Portugal",
    arp: { lat: 41.23556, lon: -8.67806 },
    runways: [
      { id: "17/35", headingDeg: 167, lengthFt: 11483, mode: "mixed", surfaceFriction: "dry" },
    ],
    gates: generateGates([
      { name: "A-", size: "heavy", count: 8 },
      { name: "B-", size: "super", count: 4 },
    ]),
  },
  LPPT: {
    icao: "LPPT",
    iata: "LIS",
    name: "Humberto Delgado",
    city: "Lisbon, Portugal",
    arp: { lat: 38.7813, lon: -9.1359 },
    runways: [
      { id: "02/20", headingDeg: 18, lengthFt: 12484, mode: "mixed", surfaceFriction: "dry" },
      { id: "17/35", headingDeg: 167, lengthFt: 7874, mode: "mixed", surfaceFriction: "dry" },
    ],
    gates: generateGates([
      { name: "T1-", size: "heavy", count: 8 },
      { name: "T2-", size: "super", count: 6 },
    ]),
  },
  EPWA: {
    icao: "EPWA",
    iata: "WAW",
    name: "Warsaw Chopin",
    city: "Warsaw, Poland",
    arp: { lat: 52.1657, lon: 20.9671 },
    runways: [
      { id: "11/29", headingDeg: 113, lengthFt: 9186, mode: "mixed", surfaceFriction: "dry" },
      { id: "15/33", headingDeg: 147, lengthFt: 12106, mode: "mixed", surfaceFriction: "dry" },
    ],
    gates: generateGates([
      { name: "T1-", size: "heavy", count: 10 },
      { name: "T1R-", size: "medium", count: 8 },
    ]),
  },
  EPKK: {
    icao: "EPKK",
    iata: "KRK",
    name: "Kraków–Balice (John Paul II)",
    city: "Kraków, Poland",
    arp: { lat: 50.0777, lon: 19.7848 },
    runways: [
      { id: "07/25", headingDeg: 73, lengthFt: 8366, mode: "mixed", surfaceFriction: "dry" },
    ],
    gates: generateGates([
      { name: "T1-", size: "heavy", count: 6 },
      { name: "T1R-", size: "medium", count: 6 },
    ]),
  },
  EPPO: {
    icao: "EPPO",
    iata: "POZ",
    name: "Poznań–Ławica",
    city: "Poznań, Poland",
    arp: { lat: 52.421, lon: 16.8263 },
    runways: [
      { id: "10/28", headingDeg: 100, lengthFt: 8215, mode: "mixed", surfaceFriction: "dry" },
    ],
    gates: generateGates([{ name: "T1-", size: "medium", count: 8 }]),
  },
};

export const lookupAirport = (code: string): Airport | undefined => {
  const upper = code.toUpperCase();
  return AIRPORTS[upper] ?? Object.values(AIRPORTS).find((a) => a.iata === upper);
};

export const KJFK = AIRPORTS.KJFK;

export const listAirports = (): Airport[] => Object.values(AIRPORTS);

const NM_PER_DEG_LAT = 60;

export const latLonToLocalNm = (
  lat: number,
  lon: number,
  arp: { lat: number; lon: number },
): { x: number; y: number } => {
  const dLat = lat - arp.lat;
  const dLon = lon - arp.lon;
  const y = -dLat * NM_PER_DEG_LAT;
  const x = dLon * NM_PER_DEG_LAT * Math.cos((arp.lat * Math.PI) / 180);
  return { x, y };
};

export const distanceNm = (
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number => {
  const { x, y } = latLonToLocalNm(a.lat, a.lon, b);
  return Math.sqrt(x * x + y * y);
};
