import { proxyWithCache } from "../_cached-proxy";

// METAR updates roughly hourly and the app polls every 5 minutes; a 120 s
// edge cache is conservative and keeps NOAA traffic minimal.
export const onRequest: PagesFunction = async ({ params, request, waitUntil }) => {
  const segments = Array.isArray(params.path) ? params.path : params.path ? [params.path] : [];
  const url = new URL(request.url);
  const upstream = `https://aviationweather.gov/api/${segments.join("/")}${url.search}`;
  return proxyWithCache(upstream, 120, waitUntil);
};
