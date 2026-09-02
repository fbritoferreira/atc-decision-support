import { proxyWithCache } from "../_cached-proxy";

// ADS-B positions move fast but the app polls every 20 s (LIVE_POLL_MS in
// live-store.ts), so the edge cache exists to collapse every viewer of an
// airport onto roughly one upstream request per poll interval.
//
// The TTL was 15 s, which is shorter than the poll interval, and that defeats
// the purpose: a copy fetched at t=0 is already expired when the next poll
// arrives at t=20, so EVERY poll went upstream and the cache collapsed
// concurrent viewers only. 25 s is longer than one poll and shorter than two,
// so alternate polls are served from cache and upstream load halves. That
// matters because adsb.lol rate-limits Cloudflare's shared egress ranges and
// the airplanes.live fallback is blocked by policy, so every avoidable
// upstream request is a chance to be refused with nothing to fall back to.
//
// The cost is a picture up to 25 s old rather than 15 s. At 150 kt that is
// about one nautical mile of extra position error, and the surface now states
// the age it is showing rather than timing from the HTTP response.
//
// Fallback: adsb.lol soft-throttles by source IP with HTTP 200 and an empty
// ac[] rather than an error. An empty bubble within 40 NM of a registry
// airport is not a plausible sky, so an ok-but-empty response falls through
// to airplanes.live, whose /v2/point API returns the same readsb record
// shape (dst included). The cache layer sits in front of both, so fallback
// traffic stays within one upstream request per freshness window.
//
// STATE OF THE FALLBACK, measured 2026-08-28: airplanes.live now refuses this
// client outright, 403 from every address and User-Agent tried, with the body
// "Please contact us at contact@airplanes.live. Your email MUST include any
// links, a description of the project, and any information you deem
// appropriate." That is an access policy, not a throttle, so the fallback
// currently converts one failure into two rather than rescuing anything. It is
// kept wired because the block lifts with an email rather than a code change,
// and because removing it would quietly drop the redundancy the design assumes.
// Until that email is sent and answered, live mode is single-homed on adsb.lol
// and the papers' data-access argument has one more concrete instance: two of
// the three public feeds this project can reach now gate on identity.
export const onRequest: PagesFunction = async ({ params, request, waitUntil }) => {
  const segments = Array.isArray(params.path) ? params.path : params.path ? [params.path] : [];
  const url = new URL(request.url);
  const path = `/${segments.join("/")}`;

  // Alternatives, tested from an ordinary address on 2026-09-01 while the
  // deployment was getting 429 from the primary and 403 from the fallback:
  //
  //   opendata.adsb.fi  200, 19.4 kB, and it takes the same
  //                     /v2/lat/{lat}/lon/{lon}/dist/{nm} path this file already
  //                     builds, so it would drop in as a third source.
  //   opensky-network   200, 9.3 kB anonymous, but a different schema and a
  //                     documented anonymous rate limit.
  //
  // adsb.fi is now wired in as a third source, below. OpenSky is not: its
  // schema differs and adapting it is a larger change than a fallback should
  // be.
  //
  // The honest caveat. Neither was tested from the deployment, which is the
  // only measurement that decides anything and the one this project cannot
  // make without shipping: the primary answers 200 from a laptop and 429 from
  // here, so a source working from a laptop says nothing about the egress it
  // would be called from. Adding it is therefore a bet rather than a fix, and
  // it is a cheap one, because a third source cannot make the current state
  // worse: today both existing upstreams refuse and the display shows an empty
  // scope.
  const primary = await proxyWithCache(`https://api.adsb.lol${path}${url.search}`, 25, waitUntil);
  let primaryOutcome = `adsb.lol ${primary.status}`;
  if (primary.ok) {
    const body = (await primary.clone().json().catch(() => null)) as { ac?: unknown[] } | null;
    const contacts = body ? (body.ac ?? []).length : -1;
    if (contacts > 0) return primary;
    // 200 with an empty ac[] is adsb.lol's soft throttle, and it is a
    // different fault from a refusal even though both end up here. Carrying
    // the distinction into the error is the whole reason this string exists:
    // when live mode broke, the response said "upstream 403" and could not say
    // which of the two feeds, or whether the first had refused or merely
    // returned an empty sky.
    primaryOutcome = contacts === 0 ? "adsb.lol 200 empty" : "adsb.lol 200 unparseable";
  }

  const m = path.match(/\/v2\/lat\/([-\d.]+)\/lon\/([-\d.]+)\/dist\/([\d.]+)/);
  if (!m) return primary;
  const [, lat, lon, dist] = m;
  const fallback = await proxyWithCache(
    `https://api.airplanes.live/v2/point/${lat}/${lon}/${dist}`,
    25,
    waitUntil,
  );
  if (fallback.ok) return fallback;

  // Third source, same path shape as the primary, so no translation is needed.
  const third = await proxyWithCache(
    `https://opendata.adsb.fi${path}${url.search}`,
    25,
    waitUntil,
  );
  if (third.ok) {
    const body = (await third.clone().json().catch(() => null)) as { ac?: unknown[] } | null;
    // Same emptiness distinction the primary gets: a 200 with no aircraft is
    // not traffic, and returning it here would report a quiet sky as a
    // successful third-source read.
    if (body && (body.ac ?? []).length > 0) return third;
  }

  // The primary answered, and the only reason we are here is that its sky was
  // empty and the fallback could not second-guess it. An empty sky is an
  // answer. Returning an error instead turned the normal state of a quiet
  // field into "feed error: ADS-B upstream 403" on the display: the client
  // throws on any non-ok status, so Poznan or Porto at three in the morning,
  // where nothing within 40 NM is entirely ordinary, reported a broken feed
  // rather than an empty one. That is a fabricated failure, which is the same
  // fault as a fabricated alert and worse for trust, because it is the state a
  // reviewer opening a quiet airport is most likely to meet.
  //
  // The soft-throttle reading is kept, but as a header rather than as an
  // error, so the distinction survives for anyone looking without the display
  // asserting a fault that may not exist.
  if (primary.ok) {
    const out = new Response(primary.body, primary);
    out.headers.set("x-fallback-tried", `airplanes.live ${fallback.status}`);
    out.headers.set("x-primary-outcome", primaryOutcome);
    return out;
  }

  return new Response(
    JSON.stringify({
      error: "no upstream returned traffic",
      tried: [
        primaryOutcome,
        `airplanes.live ${fallback.status}`,
        `adsb.fi ${third.status}`,
      ],
    }),
    { status: fallback.status, headers: { "content-type": "application/json" } },
  );
};
