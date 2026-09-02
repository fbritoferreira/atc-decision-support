import { Link, createFileRoute } from "@tanstack/react-router";
import { seo } from "#/lib/seo";

export const Route = createFileRoute("/about")({
  component: About,
  head: () =>
    seo({
      path: "/about",
      title: "About this prototype",
      description:
        "What this air traffic control prototype is and is not: a research system composing conflict alerting from small independent deterministic detectors, its data sources, and its documented limitations.",
      breadcrumb: [{ name: "About", path: "/about" }],
    }),
});

// The honest framing lives here: what this prototype is, what it is not, and
// where its data comes from. A reviewer who wanders off the operator screen
// should land on the limitations, not on template boilerplate.
function About() {
  return (
    <main className="h-screen overflow-y-auto bg-[var(--color-bg)] text-[var(--color-text)]">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="mb-3 font-mono text-xs tracking-[0.2em] text-[var(--color-text-dim)] uppercase">
          About this prototype
        </div>
        <h1 className="mb-6 font-mono text-2xl font-bold tracking-wide text-[var(--color-phosphor)]">
          ATC Decision Support
        </h1>

        <p className="mb-4 text-[15px] leading-relaxed">
          A research prototype testing whether air traffic control conflict
          alerting can be composed from a population of small, independent,
          deterministic detector functions rather than a single monolithic rule
          engine. Every alerting rule is a plain function a domain expert can
          read; the same traffic picture produces the same alerts every time.
        </p>

        <div className="panel mb-8 border-[var(--color-warning)] p-4">
          <div className="mb-2 font-mono text-xs tracking-[0.2em] text-[var(--color-warning)] uppercase">
            Not operational software
          </div>
          <p className="m-0 text-[14px] leading-relaxed text-[var(--color-text-dim)]">
            This is not certified software and is not usable for operational air
            traffic control. Thresholds are untuned. Live mode classifies only a
            fraction of nearby traffic, several detector inputs are synthesised
            because ADS-B does not carry them, and the incident scenarios are
            reconstructions with the outcome already known. Everything here is
            designed to sit underneath a controller's judgment, never in place
            of it.
          </p>
        </div>

        <h2 className="mb-3 font-mono text-sm tracking-[0.2em] text-[var(--color-text-dim)] uppercase">
          What you can do here
        </h2>
        <ul className="mb-8 list-none space-y-2 p-0 text-[14px] leading-relaxed">
          <li>
            <Link to="/" className="text-[var(--color-advisory)]">
              Scenarios
            </Link>
            <span className="text-[var(--color-text-dim)]">
              {" "}
              — twenty-eight deterministic scenarios: nine reconstruct
              documented incidents (Tenerife 1977 through the 2025 Potomac
              midair, sources cited per scenario), eleven form a negative-control
              corpus that must stay quiet, the rest are synthetic stress cases.
              Each loads paused.
            </span>
          </li>
          <li>
            <Link to="/live" className="text-[var(--color-advisory)]">
              Live mode
            </Link>
            <span className="text-[var(--color-text-dim)]">
              {" "}
              — the same detector population running on live ADS-B and METAR for
              six US airports. No key required.
            </span>
          </li>
          <li>
            <Link to="/squawks" className="text-[var(--color-advisory)]">
              Squawks
            </Link>
            <span className="text-[var(--color-text-dim)]">
              {" "}
              — transponder code reference.
            </span>
          </li>
        </ul>

        <h2 className="mb-3 font-mono text-sm tracking-[0.2em] text-[var(--color-text-dim)] uppercase">
          Data sources
        </h2>
        <p className="mb-8 text-[14px] leading-relaxed text-[var(--color-text-dim)]">
          Live traffic from{" "}
          <a href="https://adsb.lol" className="text-[var(--color-advisory)]">
            adsb.lol
          </a>
          , a volunteer ADS-B network. Weather from the{" "}
          <a
            href="https://aviationweather.gov"
            className="text-[var(--color-advisory)]"
          >
            NOAA Aviation Weather Center
          </a>
          . Neither endorses this work. Incident reconstructions draw on
          published NTSB, ICAO, CIAIAC and ANSV reports.
        </p>

        <h2 className="mb-3 font-mono text-sm tracking-[0.2em] text-[var(--color-text-dim)] uppercase">
          Author
        </h2>
        <p className="mb-8 text-[14px] leading-relaxed text-[var(--color-text-dim)]">
          Filipe Brito Ferreira ·{" "}
          <a
            href="mailto:me@fbritoferreira.com"
            className="text-[var(--color-advisory)]"
          >
            me@fbritoferreira.com
          </a>{" "}
          ·{" "}
          <a
            href="https://www.fbritoferreira.com"
            className="text-[var(--color-advisory)]"
          >
            fbritoferreira.com
          </a>
          . The whitepaper documenting the architecture, the measurement
          methodology and the findings that ran against the design is published
          at{" "}
          <a
            href="https://www.fbritoferreira.com/research/atc-decision-support/"
            className="text-[var(--color-advisory)]"
          >
            A Multi-Detector Decision-Support Architecture for Air Traffic
            Control
          </a>
          . The source repository is scheduled for publication under Apache-2.0.
        </p>

        <Link
          to="/"
          className="rounded border border-[var(--color-line)] px-3 py-2 font-mono text-xs tracking-widest text-[var(--color-text-dim)] uppercase no-underline hover:text-[var(--color-text)]"
        >
          ← Back to scenarios
        </Link>
      </div>
    </main>
  );
}
