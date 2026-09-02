import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ChevronDown, Radio } from "lucide-react";
import { AlertsSidebar } from "#/components/AlertsSidebar";
import { SeverityLedger } from "#/components/HeaderBar";
import { FlightStrips } from "#/components/FlightStrips";
import { RadarMap } from "#/components/RadarMap";
import { RunwayGatePanel } from "#/components/RunwayGatePanel";
import { FeedUnavailable } from "#/components/FeedUnavailable";
import { AIRPORTS, listAirports, lookupAirport } from "#/sim/airports";
import { formatClock } from "#/sim/engine";
import { useLiveSim } from "#/sim/live-store";
import { canonicalFor, seo } from "#/lib/seo";

export const Route = createFileRoute("/live/$airport")({
  component: LiveAirport,
  head: ({ params }) => {
    const code = String(params.airport ?? "").toUpperCase();
    const airport = lookupAirport(code);
    // An unrecognised code renders the picker rather than an airport, so it is
    // a soft-404: keep it crawlable but out of the index.
    if (!airport) {
      return seo({
        path: `/live/${code}`,
        title: "Unknown airport",
        description:
          "That airport code is not in the live directory. Pick a monitored airport to open its live traffic picture.",
        breadcrumb: [{ name: "Live airports", path: "/live" }],
        noIndex: true,
      });
    }
    const runways = airport.runways.map((r) => r.id).join(", ");
    return seo({
      path: `/live/${airport.icao}`,
      title: `${airport.name} (${airport.icao}) live traffic`,
      description: `Live ADS-B traffic and METAR weather for ${airport.name} (${airport.icao} / ${airport.iata}) in ${airport.city}, run through the conflict-detection stack. Runways ${runways}.`,
      breadcrumb: [
        { name: "Live airports", path: "/live" },
        { name: `${airport.icao}`, path: `/live/${airport.icao}` },
      ],
      nodes: [
        {
          "@type": "Airport",
          "@id": `${canonicalFor(`/live/${airport.icao}`)}#airport`,
          name: airport.name,
          iataCode: airport.iata,
          icaoCode: airport.icao,
          address: { "@type": "PostalAddress", addressLocality: airport.city },
          geo: {
            "@type": "GeoCoordinates",
            latitude: airport.arp.lat,
            longitude: airport.arp.lon,
          },
        },
      ],
    });
  },
});

function AirportSwitcher({ active }: { active: string }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const airports = listAirports();
  const current = AIRPORTS[active];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded border border-[var(--color-line)] px-3 py-1 font-mono text-xs text-[var(--color-text)] hover:bg-[var(--color-panel-strong)]"
      >
        <span className="text-[10px] tracking-widest text-[var(--color-text-dim)] uppercase">
          Airport:
        </span>
        <span className="text-[var(--color-phosphor)]">
          {current ? `${current.iata} · ${current.icao}` : active}
        </span>
        <ChevronDown size={12} className="text-[var(--color-text-dim)]" />
      </button>
      {open && (
        <div className="panel absolute top-full right-0 z-20 mt-1 max-h-96 w-[320px] overflow-y-auto">
          {airports.map((a) => (
            <button
              key={a.icao}
              type="button"
              onClick={() => {
                navigate({ to: "/live/$airport", params: { airport: a.icao } });
                setOpen(false);
              }}
              className={`w-full border-b border-[var(--color-line)] px-3 py-2 text-left hover:bg-[var(--color-panel-strong)] ${
                a.icao === active ? "bg-[var(--color-panel-strong)]" : ""
              }`}
            >
              <div className="flex items-baseline gap-2">
                <span className="font-mono font-bold text-[var(--color-phosphor)]">
                  {a.iata}
                </span>
                <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
                  {a.icao}
                </span>
              </div>
              <div className="text-[11px] text-[var(--color-text)]">
                {a.name}
              </div>
              <div className="text-[10px] text-[var(--color-text-dim)]">
                {a.city}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LiveAirport() {
  const { airport } = Route.useParams();
  const apt = lookupAirport(airport);

  if (!apt) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-[var(--color-bg)] text-[var(--color-text)]">
        <div className="mb-3 font-mono text-lg text-[var(--color-red)]">
          UNKNOWN AIRPORT · {airport.toUpperCase()}
        </div>
        <div className="mb-6 text-sm text-[var(--color-text-dim)]">
          No airport metadata in the registry. Try ICAO (KJFK) or IATA (JFK).
        </div>
        <Link
          to="/live"
          className="border border-[var(--color-phosphor)] px-3 py-1 font-mono text-xs text-[var(--color-phosphor)] no-underline"
        >
          BROWSE AIRPORTS
        </Link>
      </div>
    );
  }

  return <LiveDashboard icao={apt.icao} />;
}

function LiveDashboard({ icao }: { icao: string }) {
  const apt = useMemo(() => AIRPORTS[icao], [icao]);
  const { state } = useLiveSim(apt);
  const [hovered, setHovered] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const highlighted = hovered.length > 0 ? hovered : selected;

  const toggleSelect = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  };

  const counts = {
    arr: state.flights.filter((f) => f.type === "arrival").length,
    dep: state.flights.filter((f) => f.type === "departure").length,
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-[var(--color-bg)] text-[var(--color-text)]">
      <header className="flex items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-panel-strong)] px-4 py-2.5">
        <div className="flex items-center gap-5">
          <Link
            to="/"
            className="flex items-center gap-1 font-mono text-xs tracking-widest text-[var(--color-text-dim)] uppercase no-underline hover:text-[var(--color-text)]"
          >
            <ArrowLeft size={12} />
            Scenarios
          </Link>
          <div className="font-mono text-lg font-bold tracking-wider text-[var(--color-phosphor)]">
            {apt.icao} TWR
          </div>
          <div className="font-mono text-lg text-[var(--color-text)] tabular-nums">
            {formatClock(state.clockMin)}
          </div>
          <div className="flex items-center gap-2">
            <span
              className="sev-chip"
              style={{ color: "var(--color-critical)" }}
            >
              LIVE
            </span>
            <span className="font-mono text-xs text-[var(--color-text-dim)] tabular-nums">
              {state.liveError
                ? `feed error: ${state.liveError}`
                : state.liveUpdatedAt
                  ? `${state.liveStale ? "STALE, " : ""}updated ${Math.max(0, Math.floor((Date.now() - state.liveUpdatedAt) / 1000))}s ago`
                  : state.flights.length > 0
                    ? "age unknown"
                    : "connecting"}
            </span>
          </div>
          <div className="font-mono text-sm tracking-wider text-[var(--color-text-dim)] tabular-nums">
            ARR <span className="text-[var(--color-text)]">{counts.arr}</span>
            <span className="mx-2 opacity-50">·</span>
            DEP <span className="text-[var(--color-text)]">{counts.dep}</span>
          </div>
          <SeverityLedger state={state} />
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/squawks"
            target="_blank"
            className="flex items-center gap-1 rounded border border-[var(--color-line)] px-2 py-1 font-mono text-[10px] tracking-widest text-[var(--color-text-dim)] uppercase no-underline hover:text-[var(--color-text)]"
          >
            <Radio size={11} />
            SQUAWKS
          </Link>
          <AirportSwitcher active={icao} />
        </div>
      </header>

      {/* A stale picture still has traffic in it and stays on screen labelled
          STALE; only a refusal with nothing cached behind it gets the panel,
          because that is the case where the scope would otherwise be blank. */}
      {state.liveError && state.flights.length === 0 ? (
        <FeedUnavailable error={state.liveError} />
      ) : (
      <div className="flex min-h-0 flex-1 gap-2 p-2">
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <RadarMap state={state} highlightedIds={highlighted} />
          <RunwayGatePanel state={state} />
        </div>

        <div className="flex min-h-0 w-[420px] shrink-0 flex-col">
          <FlightStrips
            state={state}
            highlightedIds={highlighted}
            onSelect={toggleSelect}
          />
        </div>

        <AlertsSidebar
          alerts={state.alerts}
          tracked={state.trackedAlerts}
          onHover={setHovered}
        />
      </div>
      )}
    </div>
  );
}
