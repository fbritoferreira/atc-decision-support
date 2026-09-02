import type { Flight, SimState } from "#/sim/types";

type Props = {
  state: SimState;
  highlightedIds: string[];
  onSelect: (id: string) => void;
};

const phaseColor: Record<Flight["phase"], string> = {
  enroute: "text-[var(--color-text-dim)]",
  approach: "text-[var(--color-phosphor)]",
  final: "text-[var(--color-amber)]",
  landed: "text-[var(--color-text-dim)]",
  "taxi-in": "text-[var(--color-text-dim)]",
  "at-gate": "text-[var(--color-text-dim)]",
  "taxi-out": "text-[var(--color-cyan)]",
  queued: "text-[var(--color-cyan)]",
  departed: "text-[var(--color-text-dim)]",
};

function Strip({
  f,
  highlighted,
  isLive,
  onSelect,
}: {
  f: Flight;
  highlighted: boolean;
  isLive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left font-mono text-[13px] px-3 py-2 border-b border-[var(--color-line)] flex items-center gap-3 hover:bg-[var(--color-panel-strong)] ${
        highlighted ? "bg-[var(--color-panel-strong)] border-l-2 border-l-[var(--color-red)]" : ""
      }`}
    >
      <span className="text-[var(--color-text)] font-bold w-16 truncate">{f.callsign}</span>
      <span className="text-[var(--color-text-dim)] w-12">{f.aircraft}</span>
      <span className="text-[var(--color-text-dim)] w-10 uppercase">{f.wake.slice(0, 3)}</span>
      <span className={`w-20 uppercase ${phaseColor[f.phase]}`}>{f.phase}</span>
      <span className="text-[var(--color-text-dim)] w-12">
        {f.assignedRunway ?? "—"}
        {f.assignedGate ? `/${f.assignedGate}` : ""}
      </span>
      <span className="text-[var(--color-text)] tabular-nums w-12 text-right">
        {f.type === "arrival" ? `${f.etaMin.toFixed(0)}m` : f.destination}
      </span>
      {/* ADS-B carries no fuel state, so on a live picture this figure is
          synthesised by the ingest as ETA plus sixty minutes. Printing it
          beside real altitudes and speeds presented an invented number in the
          same style as measured ones, and its warning colour could never
          trigger either, since the synthesis leaves a constant sixty-minute
          margin against a thirty-minute threshold. Shown only where fuel is
          actually known, which is the scenario corpus, where it comes from the
          official accident report. */}
      <span
        className={`tabular-nums w-12 text-right ${
          !isLive && f.fuelMin < f.etaMin + 30
            ? "text-[var(--color-red)]"
            : "text-[var(--color-text-dim)]"
        }`}
      >
        {isLive ? "—" : `${f.fuelMin.toFixed(0)}m`}
      </span>
    </button>
  );
}

export function FlightStrips({ state, highlightedIds, onSelect }: Props) {
  const arrivals = state.flights
    .filter((f) => f.type === "arrival")
    .sort((a, b) => a.etaMin - b.etaMin);
  const departures = state.flights.filter((f) => f.type === "departure");

  return (
    <div className="panel flex flex-col min-h-0">
      <div className="panel-header flex items-center justify-between gap-4">
        <span>Flight strips</span>
        <span className="font-mono text-[11px] normal-case tracking-normal text-[var(--color-text-dim)]">
          Click to highlight on radar
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="bg-[var(--color-panel-strong)] px-3 py-1.5 text-[12px] font-mono uppercase tracking-widest text-[var(--color-phosphor)]">
          Arrivals · {arrivals.length}
        </div>
        {arrivals.map((f) => (
          <Strip
            isLive={Boolean(state.live)}
            key={f.id}
            f={f}
            highlighted={highlightedIds.includes(f.id)}
            onSelect={() => onSelect(f.id)}
          />
        ))}
        <div className="bg-[var(--color-panel-strong)] px-3 py-1.5 text-[12px] font-mono uppercase tracking-widest text-[var(--color-advisory)] mt-2">
          Departures · {departures.length}
        </div>
        {departures.map((f) => (
          <Strip
            isLive={Boolean(state.live)}
            key={f.id}
            f={f}
            highlighted={highlightedIds.includes(f.id)}
            onSelect={() => onSelect(f.id)}
          />
        ))}
      </div>
    </div>
  );
}
