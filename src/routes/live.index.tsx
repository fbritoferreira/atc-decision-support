import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Plane } from "lucide-react";
import { listAirports } from "#/sim/airports";
import { canonicalFor, seo } from "#/lib/seo";

export const Route = createFileRoute("/live/")({
  component: LiveIndex,
  head: () =>
    seo({
      path: "/live",
      title: "Live airport directory",
      description:
        "Airports available for live monitoring: each pulls real-time ADS-B traffic from adsb.lol and live METAR weather from aviationweather.gov into the detector stack.",
      breadcrumb: [{ name: "Live airports", path: "/live" }],
      nodes: [
        {
          "@type": "ItemList",
          name: "Live airports",
          numberOfItems: listAirports().length,
          itemListElement: listAirports().map((a, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: `${a.name} (${a.icao})`,
            url: canonicalFor(`/live/${a.icao}`),
          })),
        },
      ],
    }),
});

function LiveIndex() {
  const airports = listAirports();
  return (
    <div className="h-screen w-screen overflow-y-auto bg-[var(--color-bg)] text-[var(--color-text)]">
      <header className="panel-header flex items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-panel-strong)] px-6 py-3">
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className="flex items-center gap-1 font-mono text-[10px] text-[var(--color-text-dim)] no-underline hover:text-[var(--color-text)]"
          >
            <ArrowLeft size={12} />
            BACK TO SCENARIOS
          </Link>
          <div className="flex items-center gap-2 font-mono text-base font-bold tracking-wider text-[var(--color-phosphor)]">
            <Plane size={16} />
            LIVE AIRPORT DIRECTORY
          </div>
        </div>
      </header>
      <main className="px-6 py-8">
        <p className="mb-6 max-w-2xl text-sm text-[var(--color-text-dim)]">
          Each airport pulls real-time ADS-B traffic from adsb.lol and live
          METAR weather from aviationweather.gov. Open one in this tab, or in a
          new window for multi-screen control room setups.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {airports.map((a) => (
            <Link
              key={a.icao}
              to="/live/$airport"
              params={{ airport: a.icao }}
              className="panel p-5 no-underline transition-colors hover:border-[var(--color-phosphor)]"
            >
              <div className="mb-1 flex items-baseline justify-between">
                <span
                  className="font-mono text-3xl font-bold text-[var(--color-phosphor)] tabular-nums"
                  style={{ textShadow: "0 0 12px rgba(74, 222, 128, 0.6)" }}
                >
                  {a.iata}
                </span>
                <span className="font-mono text-xs text-[var(--color-text-dim)]">
                  {a.icao}
                </span>
              </div>
              <div className="mb-1 text-sm text-[var(--color-text)]">
                {a.name}
              </div>
              <div className="mb-3 text-xs text-[var(--color-text-dim)]">
                {a.city}
              </div>
              <div className="flex items-center justify-between border-t border-[var(--color-line)] pt-2 font-mono text-[10px] tracking-widest text-[var(--color-text-dim)]">
                <span>{a.runways.length} runways</span>
                <span>{a.gates.length} gates</span>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
