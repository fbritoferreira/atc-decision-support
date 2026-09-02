import { useState } from "react";
import { SCENARIOS, type ScenarioId } from "#/sim/scenarios";

// Grouped by whether the scenario reconstructs a documented incident, which
// the id says, not by whether it carries an `incident` description block,
// which it did before. negative-control-asrs carries one, honestly labelled
// "illustrative; not a real incident", and was therefore listed under
// "Historical incidents": a synthetic negative control presented to a
// reviewer as a reconstruction, on the surface the write-up tells reviewers
// to open first. The block is kept, because the banner it feeds explains the
// scenario; only the grouping test changed.
const isHistorical = (s: (typeof SCENARIOS)[number]) =>
  s.id.startsWith("incident-");
import { BookOpen, ChevronDown } from "lucide-react";

type Props = {
  active: ScenarioId;
  onSelect: (id: ScenarioId) => void;
};

export function ScenarioPicker({ active, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const current = SCENARIOS.find((s) => s.id === active) ?? SCENARIOS[0];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 font-mono text-xs px-3 py-1 border border-[var(--color-line)] rounded text-[var(--color-text)] hover:bg-[var(--color-panel-strong)]"
      >
        <span className="text-[var(--color-text-dim)] uppercase tracking-widest text-[12px]">
          Scenario:
        </span>
        <span className="text-[var(--color-phosphor)]">{current.name}</span>
        <ChevronDown size={12} className="text-[var(--color-text-dim)]" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 w-[420px] panel max-h-[70vh] overflow-y-auto">
          <div className="px-3 py-1 text-[12px] font-mono uppercase tracking-widest text-[var(--color-phosphor)] bg-[var(--color-panel-strong)]">
            Synthetic scenarios
          </div>
          {SCENARIOS.filter((s) => !isHistorical(s)).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                onSelect(s.id);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 border-b border-[var(--color-line)] hover:bg-[var(--color-panel-strong)] ${
                s.id === active ? "bg-[var(--color-panel-strong)]" : ""
              }`}
            >
              <div className="font-mono text-xs text-[var(--color-text)] font-bold mb-1">
                {s.name}
              </div>
              <div className="text-[13px] text-[var(--color-text-dim)] leading-snug">{s.brief}</div>
            </button>
          ))}
          <div className="px-3 py-1 text-[12px] font-mono uppercase tracking-widest text-[var(--color-amber)] bg-[var(--color-panel-strong)] flex items-center gap-1">
            <BookOpen size={10} />
            Historical incidents
          </div>
          {SCENARIOS.filter(isHistorical).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                onSelect(s.id);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 border-b border-[var(--color-line)] hover:bg-[var(--color-panel-strong)] ${
                s.id === active ? "bg-[var(--color-panel-strong)]" : ""
              }`}
            >
              <div className="flex items-baseline justify-between mb-1">
                <span className="font-mono text-xs text-[var(--color-text)] font-bold">{s.name}</span>
                {s.incident && (
                  <span className="font-mono text-[12px] text-[var(--color-text-dim)]">
                    {s.incident.location}
                  </span>
                )}
              </div>
              <div className="text-[13px] text-[var(--color-text-dim)] leading-snug mb-1">{s.brief}</div>
              {s.incident && (
                <div className="text-[12px] text-[var(--color-amber)] leading-snug border-l-2 border-[var(--color-amber)] pl-2 mt-1">
                  <span className="font-mono uppercase tracking-widest">Would flag:</span>{" "}
                  {s.incident.aiWouldFlag}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
