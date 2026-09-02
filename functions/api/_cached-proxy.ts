// Shared caching proxy for the two upstream APIs.
//
// adsb.lol rate-limits by source IP, and every request from a Pages Function
// leaves through Cloudflare's shared edge ranges — so an uncached pass-through
// gets intermittent 429s even at modest traffic, and every browser tab polling
// every 20 seconds multiplies the problem. This proxy makes the edge absorb
// the fan-out: one upstream fetch per URL per TTL window, shared by every
// viewer, with a stale copy served when the upstream refuses.
//
// Freshness is handled manually (x-fetched-at) rather than by cache-control
// expiry, because an expired entry must remain retrievable as the 429
// fallback; letting the cache evict on TTL would discard exactly the copy the
// fallback needs.

// How long a copy stays servable after the upstream starts refusing.
//
// Raised from 300 on 2026-08-28. adsb.lol answers 429 to Cloudflare's shared
// egress ranges, intermittently and for minutes at a time: measured the same
// afternoon, production returned 429 at 15:25, real traffic at 15:28 and 15:32,
// and 429 again at 15:40, while the identical request from a laptop returned
// 183 contacts throughout. Five minutes was not enough to cover a spell, and
// the fallback that would have covered it is blocked by policy. Ten minutes is
// chosen because the surface now labels a stale picture as STALE and dates it
// from the upstream fetch, so a viewer can see what they are looking at rather
// than being shown an old sky as a current one.
const STALE_LIMIT_SECONDS = 600;

/**
 * Identifies this project to the volunteer feeds, and it is load-bearing, not
 * courtesy.
 *
 * Measured 2026-08-28: `api.adsb.lol` answers 403 to a request carrying no
 * User-Agent and 200 to the identical request carrying any, deterministically,
 * three times each. Cloudflare Workers' `fetch()` sends no User-Agent unless
 * one is set, so every request this proxy made from the edge was rejected
 * while the same URL from a laptop returned a full traffic picture. Live mode
 * was therefore dead in production and healthy in every local check, which is
 * why it survived: the failure was a property of the caller, not of the URL.
 *
 * The contact address is included because these are volunteer aggregators and
 * both of them ask to be able to reach the operator of a client.
 */
const USER_AGENT =
  "atc-decision-support/0.5 (+https://atc.fbritoferreira.com; me@fbritoferreira.com)";

export const proxyWithCache = async (
  upstreamUrl: string,
  freshSeconds: number,
  waitUntil: (p: Promise<unknown>) => void,
): Promise<Response> => {
  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(upstreamUrl);

  const cached = await cache.match(cacheKey);
  const fetchedAt = cached ? Number(cached.headers.get("x-fetched-at") ?? 0) : 0;
  const ageSeconds = (Date.now() - fetchedAt) / 1000;

  if (cached && ageSeconds < freshSeconds) {
    return withProxyHeaders(cached, { age: ageSeconds, stale: false });
  }

  let upstream: Response | undefined;
  try {
    upstream = await fetch(upstreamUrl, { headers: { "user-agent": USER_AGENT } });
  } catch {
    upstream = undefined;
  }

  if (upstream?.ok) {
    const body = await upstream.arrayBuffer();
    const toStore = new Response(body, {
      status: 200,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        // Long enough that a stale copy survives to back the 429 fallback;
        // actual freshness is decided by x-fetched-at above.
        "cache-control": `s-maxage=${STALE_LIMIT_SECONDS}`,
        "x-fetched-at": String(Date.now()),
      },
    });
    waitUntil(cache.put(cacheKey, toStore.clone()));
    return withProxyHeaders(toStore, { age: 0, stale: false });
  }

  // Upstream refused (429, 5xx, network). Serve the stale copy if it is not
  // ancient; a picture inside STALE_LIMIT_SECONDS carrying a stale marker
  // beats an error, and since 2026-08-28 the client does surface the marker,
  // which is what this sentence asserted for some time before it was true.
  // The bound is named rather than spelled out in minutes because it has been
  // raised twice and every prose copy of it drifted.
  if (cached && ageSeconds < STALE_LIMIT_SECONDS) {
    return withProxyHeaders(cached, { age: ageSeconds, stale: true });
  }

  // Name the upstream that refused. The previous body said only
  // "upstream 403", so a client, a log line and a reviewer all saw the same
  // opaque string whether the primary feed, the fallback, or both had failed;
  // finding the User-Agent cause above needed the two feeds probed by hand
  // from outside the system. An error that cannot be attributed to a source is
  // the same defect class this project keeps finding in its own aggregates.
  return new Response(
    JSON.stringify({
      error: `upstream ${upstream?.status ?? "unreachable"}`,
      upstream: new URL(upstreamUrl).host,
    }),
    {
      status: upstream?.status ?? 502,
      headers: { "content-type": "application/json" },
    },
  );
};

const withProxyHeaders = (
  res: Response,
  meta: { age: number; stale: boolean },
): Response => {
  const out = new Response(res.body, res);
  out.headers.set("x-proxy-age", meta.age.toFixed(0));
  out.headers.set("x-proxy-stale", String(meta.stale));
  out.headers.set("cache-control", "no-store"); // browsers must not double-cache
  return out;
};
