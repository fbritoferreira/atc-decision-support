export type RouteAirport = {
  iata: string;
  icao: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
};

export type FlightRoute = {
  callsign: string;
  airline?: string;
  origin?: RouteAirport;
  destination?: RouteAirport;
};

type AdsbdbAirport = {
  iata_code: string;
  icao_code: string;
  name: string;
  municipality: string;
  country_name: string;
  latitude: number;
  longitude: number;
};

type AdsbdbResponse = {
  response?: {
    flightroute?: {
      callsign: string;
      airline?: { name: string };
      origin?: AdsbdbAirport;
      destination?: AdsbdbAirport;
    };
  };
};

// Only definitive answers land here. A miss and a failure both produce null at
// the call site, which makes them easy to conflate, and conflating them meant
// one transient network error left a callsign permanently routeless for the
// rest of the session: the entry was cached and never retried. The API saying
// a flight has no filed route is permanent and worth keeping; not being able
// to ask is not an answer at all.
const cache = new Map<string, FlightRoute | null>();
const inflight = new Map<string, Promise<FlightRoute | null>>();

const mapAirport = (a: AdsbdbAirport): RouteAirport => ({
  iata: a.iata_code,
  icao: a.icao_code,
  name: a.name,
  city: a.municipality,
  country: a.country_name,
  lat: a.latitude,
  lon: a.longitude,
});

export const fetchRoute = async (callsign: string): Promise<FlightRoute | null> => {
  const key = callsign.trim().toUpperCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key) ?? null;
  if (inflight.has(key)) return inflight.get(key) ?? null;

  const promise = (async (): Promise<FlightRoute | null> => {
    try {
      const res = await fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(key)}`);
      if (!res.ok) {
        // A 404 from this API means the callsign has no filed route, which is
        // an answer. Any other status is the service failing, so it is not
        // cached and the next open retries.
        if (res.status === 404) cache.set(key, null);
        return null;
      }
      const data: AdsbdbResponse = await res.json();
      const fr = data.response?.flightroute;
      if (!fr) {
        cache.set(key, null);
        return null;
      }
      const route: FlightRoute = {
        callsign: fr.callsign,
        airline: fr.airline?.name,
        origin: fr.origin ? mapAirport(fr.origin) : undefined,
        destination: fr.destination ? mapAirport(fr.destination) : undefined,
      };
      cache.set(key, route);
      return route;
    } catch {
      // Network failure, not an absent route. Deliberately not cached.
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
};
