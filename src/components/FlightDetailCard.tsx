import { useEffect, useState } from "react";
import { Plane, X } from "lucide-react";
import { fetchRoute, type FlightRoute } from "#/sim/live-routes";
import { paletteForRunway } from "#/sim/runway-colors";
import type { Flight, Runway } from "#/sim/types";

type Props = {
  flight: Flight;
  pos: { x: number; y: number };
  runways: Runway[];
  isLive?: boolean;
  onClose: () => void;
};

const phaseLabel: Record<Flight["phase"], string> = {
  enroute: "EN ROUTE",
  approach: "APPROACH",
  final: "FINAL",
  landed: "LANDED",
  "taxi-in": "TAXI IN",
  "at-gate": "AT GATE",
  "taxi-out": "TAXI OUT",
  queued: "QUEUED",
  departed: "DEPARTED",
};

export function FlightDetailCard({ flight, pos, runways, isLive, onClose }: Props) {
  const altFl = String(Math.round(flight.altitudeFt / 100)).padStart(3, "0");
  const runwayPalette = paletteForRunway(flight.assignedRunway, runways);
  const [route, setRoute] = useState<FlightRoute | null | "loading">(null);

  useEffect(() => {
    if (!isLive) {
      setRoute(null);
      return;
    }
    let cancelled = false;
    setRoute("loading");
    fetchRoute(flight.callsign).then((r) => {
      if (!cancelled) setRoute(r);
    });
    return () => {
      cancelled = true;
    };
  }, [flight.callsign, isLive]);
  return (
    <div
      className="fixed z-30 panel font-mono text-xs"
      style={{
        left: Math.min(pos.x + 16, window.innerWidth - 280),
        top: Math.max(8, Math.min(pos.y - 60, window.innerHeight - 280)),
        width: 260,
        boxShadow: "0 0 24px rgba(74, 222, 128, 0.18)",
      }}
    >
      <div className="panel-header flex items-center justify-between">
        <span>{flight.callsign}</span>
        <button
          type="button"
          onClick={onClose}
          className="text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
          aria-label="Close"
        >
          <X size={12} />
        </button>
      </div>
      <div className="p-3 space-y-2">
        <div className="flex justify-between">
          <span className="text-[var(--color-text-dim)]">TYPE</span>
          <span className="text-[var(--color-text)]">
            {flight.aircraft} · {flight.wake.toUpperCase()}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--color-text-dim)]">PHASE</span>
          <span className="text-[var(--color-phosphor)]">{phaseLabel[flight.phase]}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--color-text-dim)]">ROUTE</span>
          <span className="text-[var(--color-text)]">
            {flight.origin} → {flight.destination}
          </span>
        </div>
        {isLive && (
          <div className="border-t border-[var(--color-line)] pt-2">
            <div className="flex items-center gap-1 text-[11px] text-[var(--color-text-dim)] tracking-widest mb-1">
              <Plane size={9} />
              FLIGHT ROUTE
            </div>
            {route === "loading" && (
              <div className="text-[var(--color-text-dim)]">looking up…</div>
            )}
            {route === null && (
              <div className="text-[var(--color-text-dim)]">no route data for this callsign</div>
            )}
            {route && route !== "loading" && (
              <div className="space-y-1">
                {route.airline && (
                  <div className="text-[var(--color-text)]">{route.airline}</div>
                )}
                {route.origin && (
                  <div>
                    <span className="text-[var(--color-phosphor)] font-bold">
                      {route.origin.iata || route.origin.icao}
                    </span>
                    <span className="text-[var(--color-text-dim)]">
                      {" "}— {route.origin.city}, {route.origin.country}
                    </span>
                  </div>
                )}
                {route.destination && (
                  <div>
                    <span className="text-[var(--color-amber)] font-bold">
                      {route.destination.iata || route.destination.icao}
                    </span>
                    <span className="text-[var(--color-text-dim)]">
                      {" "}— {route.destination.city}, {route.destination.country}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <div className="border-t border-[var(--color-line)] pt-2 grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-[11px] text-[var(--color-text-dim)] tracking-widest">ALT</div>
            <div className="text-[var(--color-text)] font-bold">{altFl}</div>
          </div>
          <div>
            <div className="text-[11px] text-[var(--color-text-dim)] tracking-widest">GS</div>
            <div className="text-[var(--color-text)] font-bold">{Math.round(flight.speedKts)}</div>
          </div>
          <div>
            <div className="text-[11px] text-[var(--color-text-dim)] tracking-widest">HDG</div>
            <div className="text-[var(--color-text)] font-bold">
              {String(Math.round(flight.headingDeg)).padStart(3, "0")}°
            </div>
          </div>
        </div>
        <div className="border-t border-[var(--color-line)] pt-2 grid grid-cols-2 gap-2">
          <div
            className="px-2 py-1.5 rounded border"
            style={
              flight.assignedRunway
                ? { borderColor: runwayPalette.stroke, background: runwayPalette.fill }
                : { borderColor: "var(--color-line)" }
            }
          >
            <div className="text-[11px] text-[var(--color-text-dim)] tracking-widest flex items-center gap-1">
              {flight.assignedRunway && (
                <span
                  className="inline-block w-1.5 h-1.5 rounded-sm"
                  style={{ background: runwayPalette.stroke, boxShadow: `0 0 4px ${runwayPalette.glow}` }}
                />
              )}
              RUNWAY
            </div>
            <div
              className="font-bold text-base"
              style={{ color: flight.assignedRunway ? runwayPalette.text : "var(--color-text-dim)" }}
            >
              {flight.assignedRunway ?? "—"}
            </div>
          </div>
          <div className="px-2 py-1.5 rounded border border-[var(--color-line)]">
            <div className="text-[11px] text-[var(--color-text-dim)] tracking-widest">GATE</div>
            <div
              className={`font-bold text-base ${
                flight.assignedGate ? "text-[var(--color-text)]" : "text-[var(--color-text-dim)]"
              }`}
            >
              {flight.assignedGate ?? "—"}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[var(--color-text-dim)] tracking-widest">ETA</div>
            <div
              className={
                flight.etaMin > 0 ? "text-[var(--color-text)]" : "text-[var(--color-text-dim)]"
              }
            >
              {flight.etaMin > 0 ? `${flight.etaMin.toFixed(0)} min` : "—"}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[var(--color-text-dim)] tracking-widest">FUEL</div>
            {/* Synthesised by the ingest as ETA plus sixty on a live picture,
                because ADS-B carries no fuel state. Shown only where it is
                genuinely known, which is the scenario corpus. */}
            <div
              className={
                !isLive && flight.fuelMin < flight.etaMin + 30
                  ? "text-[var(--color-red)]"
                  : "text-[var(--color-text)]"
              }
            >
              {isLive ? "not transmitted" : `${flight.fuelMin.toFixed(0)} min`}
            </div>
          </div>
        </div>
        <div className="border-t border-[var(--color-line)] pt-2 flex justify-between">
          <span className="text-[var(--color-text-dim)]">SQUAWK</span>
          <span className="text-[var(--color-text)]">{flight.squawk}</span>
        </div>
      </div>
    </div>
  );
}
