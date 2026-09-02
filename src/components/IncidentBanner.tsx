import { BookOpen, X } from "lucide-react";
import { SCENARIOS, type ScenarioId } from "#/sim/scenarios";

type Props = {
  scenario: ScenarioId;
  onDismiss: () => void;
};

export function IncidentBanner({ scenario, onDismiss }: Props) {
  const meta = SCENARIOS.find((s) => s.id === scenario);
  if (!meta?.incident) return null;
  const info = meta.incident;
  // Labelled by what the scenario is, not by whether it carries a block. The
  // heading read "Historical Reconstruction" for anything with an `incident`
  // field, which included negative-control-asrs, whose own body text in this
  // same banner reads "illustrative; not a real incident". The label
  // contradicted the sentence underneath it.
  const historical = meta.id.startsWith("incident-");

  return (
    <div
      className="border-b border-[var(--color-warning)] bg-[var(--color-amber)]/8 px-4 py-2"
      style={{ background: "rgba(251, 191, 36, 0.06)" }}
    >
      <div className="flex items-start gap-3">
        <BookOpen size={16} className="text-[var(--color-warning)] mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="font-mono font-bold text-[var(--color-warning)] text-xs tracking-widest uppercase">
              {historical ? "Historical Reconstruction" : "Synthetic Scenario"}
            </span>
            <span className="font-mono text-[12px] text-[var(--color-text-dim)]">
              {info.location} · {info.year} · {info.report}
            </span>
          </div>
          <div className="text-[13px] text-[var(--color-text)] leading-snug mb-1">{info.summary}</div>
          <div className="text-[13px] text-[var(--color-warning)] leading-snug">
            <span className="font-mono uppercase tracking-widest">Would flag:</span>{" "}
            {info.aiWouldFlag}
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-[var(--color-text-dim)] hover:text-[var(--color-text)] shrink-0"
          aria-label="Switch back to nominal"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
