import { Link } from "@tanstack/react-router";
import { formatClock } from "#/sim/engine";
import type { ScenarioId } from "#/sim/scenarios";
import type { SimState } from "#/sim/types";
import { ScenarioPicker } from "./ScenarioPicker";

type Props = {
  state: SimState;
  scenario: ScenarioId;
  onScenario: (id: ScenarioId) => void;
  onSpeed: (speed: SimState["speed"]) => void;
  onReset: () => void;
};

// The severity ledger: one chip per tier, always present, always in the same
// place, so "is anything red?" is answerable from across the room without
// reading. Zero-count chips dim and go dashed rather than disappearing —
// a vanished chip and a zero look identical at a glance, and only one of
// them is news.
export function SeverityLedger({ state }: { state: SimState }) {
  const count = (sev: string) => state.alerts.filter((a) => a.severity === sev).length;
  const tiers = [
    { tag: "CRIT", n: count("critical"), color: "var(--color-critical)", inverse: true },
    { tag: "WARN", n: count("warning"), color: "var(--color-warning)", inverse: false },
    { tag: "ADV", n: count("advisory"), color: "var(--color-advisory)", inverse: false },
  ];
  return (
    <div className="flex items-center gap-2">
      {tiers.map((t) => (
        <span
          key={t.tag}
          className={`sev-chip ${t.inverse && t.n > 0 ? "sev-inverse" : ""}`}
          style={t.inverse && t.n > 0 ? undefined : { color: t.color }}
          data-zero={t.n === 0}
        >
          {t.tag} {t.n}
        </span>
      ))}
    </div>
  );
}

export function HeaderBar({ state, scenario, onScenario, onSpeed, onReset }: Props) {
  const arr = state.flights.filter(
    (f) => f.type === "arrival" && f.phase !== "landed" && f.phase !== "at-gate",
  ).length;
  const dep = state.flights.filter((f) => f.type === "departure" && f.phase !== "departed").length;

  return (
    <header className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-line)] bg-[var(--color-panel-strong)]">
      <div className="flex items-center gap-5">
        <div className="font-mono font-bold text-[var(--color-phosphor)] text-lg tracking-wider">
          {state.sectorId}
        </div>
        <div className="font-mono text-lg text-[var(--color-text)] tabular-nums">
          {formatClock(state.clockMin)}
        </div>
        {state.live && (
          <div className="flex items-center gap-2">
            <span className="sev-chip" style={{ color: "var(--color-critical)" }}>
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
        )}
        <div className="font-mono text-sm text-[var(--color-text-dim)] tracking-wider tabular-nums">
          ARR <span className="text-[var(--color-text)]">{arr}</span>
          <span className="mx-2 opacity-50">·</span>
          DEP <span className="text-[var(--color-text)]">{dep}</span>
        </div>
        <SeverityLedger state={state} />
      </div>

      <div className="flex items-center gap-2">
        <Link
          to="/live"
          className="font-mono text-xs px-2.5 py-1.5 border border-[var(--color-line)] rounded text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:border-[var(--color-text-dim)] no-underline tracking-widest uppercase"
        >
          Live airports
        </Link>
        <Link
          to="/squawks"
          target="_blank"
          className="font-mono text-xs px-2.5 py-1.5 border border-[var(--color-line)] rounded text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:border-[var(--color-text-dim)] no-underline tracking-widest uppercase"
          title="Transponder code reference (opens in a new tab)"
        >
          Squawks
        </Link>
        <ScenarioPicker active={scenario} onSelect={onScenario} />
        {!state.live && (
          <div className="flex items-center gap-1 ml-2">
            <span className="font-mono text-xs text-[var(--color-text-dim)] tracking-widest uppercase mr-1">
              Speed
            </span>
            {([0, 1, 2, 4, 8] as SimState["speed"][]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onSpeed(s)}
                aria-pressed={state.speed === s}
                className={`font-mono text-sm px-2.5 py-1 border rounded tabular-nums ${
                  state.speed === s
                    ? "border-[var(--color-phosphor)] text-[var(--color-phosphor)] bg-[var(--color-phosphor-dim)]/20"
                    : "border-[var(--color-line)] text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
                }`}
              >
                {s === 0 ? "HOLD" : `${s}×`}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={onReset}
          className="font-mono text-xs px-2.5 py-1.5 ml-3 border border-[var(--color-line)] text-[var(--color-text-dim)] hover:text-[var(--color-text)] rounded tracking-widest uppercase"
        >
          {state.live ? "Refresh" : "Reset"}
        </button>
      </div>
    </header>
  );
}
