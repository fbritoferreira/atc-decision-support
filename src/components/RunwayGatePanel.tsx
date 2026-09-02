import { paletteByIndex } from "#/sim/runway-colors";
import type { SimState } from "#/sim/types";

type Props = {
  state: SimState;
};

export function RunwayGatePanel({ state }: Props) {
  return (
    <div className="panel">
      <div className="panel-header">Runways · Gates · Weather</div>
      <div className="grid grid-cols-3 gap-0 text-xs">
        <div className="border-r border-[var(--color-line)] p-3">
          <div className="text-[12px] uppercase tracking-widest text-[var(--color-text-dim)] mb-2">
            Runways
          </div>
          <div className="space-y-1 font-mono">
            {state.runways.map((r, i) => {
              const palette = paletteByIndex(i);
              const using = state.flights.find(
                (f) => f.assignedRunway === r.id && (f.phase === "final" || f.phase === "queued"),
              );
              return (
                <div key={r.id} className="flex items-center gap-2">
                  <span
                    className="inline-block w-2 h-2 rounded-sm"
                    style={{ background: palette.stroke, boxShadow: `0 0 6px ${palette.glow}` }}
                  />
                  <span className="font-bold flex-1" style={{ color: palette.text }}>
                    {r.id}
                  </span>
                  <span className="text-[var(--color-text-dim)] text-[12px]">{r.mode}</span>
                  <span
                    className={
                      using
                        ? "phosphor-glow"
                        : "text-[var(--color-text-dim)]"
                    }
                    style={using ? { color: palette.stroke } : undefined}
                  >
                    {using ? using.callsign : "clear"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="border-r border-[var(--color-line)] p-3">
          <div className="text-[12px] uppercase tracking-widest text-[var(--color-text-dim)] mb-2">
            Gates
          </div>
          <div className="grid grid-cols-5 gap-1 font-mono text-[12px]">
            {state.gates.map((g) => {
              const occupied = !!g.occupiedBy;
              return (
                <div
                  key={g.id}
                  className={`px-1 py-1 border text-center ${
                    occupied
                      ? "border-[var(--color-amber)] text-[var(--color-amber)] bg-[var(--color-amber)]/10"
                      : "border-[var(--color-line)] text-[var(--color-text-dim)]"
                  }`}
                  title={occupied ? `Occupied by ${g.occupiedBy}` : "Free"}
                >
                  {g.id}
                </div>
              );
            })}
          </div>
        </div>

        <div className="p-3">
          <div className="text-[12px] uppercase tracking-widest text-[var(--color-text-dim)] mb-2">
            Weather (METAR)
          </div>
          {/* On a live picture the weather block is seeded with a default
              before the first METAR arrives, and carried over from the
              previous airport across a switch, so it is shown only once an
              observation exists for the field on screen. Otherwise the panel
              printed a fabricated calm VFR reading, or another airport's, in
              the same style as a measured one. */}
          {state.live && state.weatherObservedFor !== state.sectorId.split(" ")[0] ? (
            <div className="font-mono text-[var(--color-text-dim)]">
              awaiting observation for {state.sectorId.split(" ")[0]}
            </div>
          ) : (
          <div className="font-mono space-y-1">
            <div className="flex justify-between">
              <span className="text-[var(--color-text-dim)]">Wind</span>
              <span className="text-[var(--color-text)]">
                {state.weather.windDirDeg}°T/{state.weather.windKts}G{state.weather.gustsKts}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-text-dim)]">Vis</span>
              <span className="text-[var(--color-text)]">{state.weather.visibilityNm} NM</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-text-dim)]">Ceil</span>
              <span className="text-[var(--color-text)]">{state.weather.ceilingFt} ft</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-text-dim)]">Cond</span>
              <span
                className={
                  state.weather.condition === "VFR"
                    ? "text-[var(--color-phosphor)]"
                    : "text-[var(--color-amber)]"
                }
              >
                {state.weather.conditionObserved === false
                  ? `${state.weather.condition} (assumed)`
                  : state.weather.condition}
              </span>
            </div>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
