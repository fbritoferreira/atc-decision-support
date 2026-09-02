import { Link } from "@tanstack/react-router";

/**
 * What a visitor sees when the public ADS-B feed refuses.
 *
 * Before this existed the page showed an empty radar scope and one dim line
 * reading "feed error: ADS-B upstream 403". Someone arriving from the paper or
 * from an outreach email had no way to tell a dead project from a refused
 * request, and no indication that twenty-eight deterministic scenarios are one
 * click away and never touch the network.
 *
 * The wording is deliberate on two points. It does not apologise for a bug,
 * because this is not one: the demo egresses through Cloudflare's shared
 * address ranges and adsb.lol budgets by IP, so it competes with every other
 * tenant for the same allowance. The airplanes.live fallback is a separate
 * matter and the copy says so: it refuses this client by policy rather than by
 * budget, pending an introduction by email, so a refusal from the first feed is
 * currently a refusal from both. Describing both as rate limits, which this
 * component did until 2026-08-29, told a visitor the redundancy was working. And it says so plainly, because
 * the paper's Section 7 makes exactly this argument about why operational work
 * needs facility-correlated tracks rather than public aggregation. The failure
 * is the argument, so the page states it rather than hiding it.
 */
export const FeedUnavailable = ({ error }: { error: string }) => (
  <div className="flex min-h-0 flex-1 items-center justify-center p-8">
    <div className="max-w-xl border border-[var(--color-line)] p-6">
      <p className="font-mono text-[10px] tracking-widest text-[var(--color-critical)] uppercase">
        Live feed unavailable
      </p>

      <p className="mt-4 text-sm text-[var(--color-text)]">
        The public ADS-B aggregator refused this request. Live mode reads
        adsb.lol, which budgets requests by source address. This demo runs on
        Cloudflare and leaves through address ranges it shares with every other
        site hosted there, so it competes for an allowance it cannot see.
      </p>

      <p className="mt-3 text-sm text-[var(--color-text)]">
        The fallback behind it, airplanes.live, refuses this client outright
        rather than by budget: its policy asks operators to introduce a project
        by email before it will serve them. So the redundancy the design assumes
        is not currently there, and a refusal from the first feed is a refusal
        from both.
      </p>

      <p className="mt-3 text-sm text-[var(--color-text-dim)]">
        This is the limit the write-up describes rather than a fault in the
        detectors: alerting built on public aggregation inherits whatever
        access the aggregator grants that minute. Operational use needs
        flight-plan-correlated tracks from a facility, or a locally operated
        receiver.
      </p>

      <p className="mt-4 text-sm text-[var(--color-text)]">
        The detector population does not depend on the network. Every scenario
        below carries its own traffic picture and runs identically every time,
        including nine reconstructions of documented accidents and an
        eleven-scenario corpus that must stay silent on legal traffic.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link
          to="/"
          className="rounded border border-[var(--color-line)] px-3 py-1.5 font-mono text-[10px] tracking-widest text-[var(--color-text)] uppercase no-underline hover:border-[var(--color-text-dim)]"
        >
          Open the scenarios
        </Link>
        <a
          href="https://www.fbritoferreira.com/research/atc-decision-support/"
          className="font-mono text-[10px] tracking-widest text-[var(--color-text-dim)] uppercase no-underline hover:text-[var(--color-text)]"
        >
          Read the paper
        </a>
      </div>

      <p className="mt-5 font-mono text-[10px] text-[var(--color-text-dim)]">
        Upstream reported: {error}
      </p>
    </div>
  </div>
);
