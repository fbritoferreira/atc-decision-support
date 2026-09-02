import type { Alert, AlertSeverity, TrackedAlert } from "#/sim/types";

type Props = {
  alerts: Alert[];
  onHover: (flightIds: string[]) => void;
  /**
   * Live mode only: the full tracked set. Alerts absent from detector output
   * but inside their grace period render dimmed as CLEARING instead of
   * vanishing — the visible half of the flicker suppression in lifecycle.ts.
   */
  tracked?: TrackedAlert[];
};

// Severity is encoded three ways at once — rail colour, text tag, and for
// critical an inverse-video header — so no tier depends on colour vision or
// on reading small print.
const SEV: Record<AlertSeverity, { color: string; tag: string }> = {
  critical: { color: "var(--color-critical)", tag: "CRIT" },
  warning: { color: "var(--color-warning)", tag: "WARN" },
  advisory: { color: "var(--color-advisory)", tag: "ADV" },
  info: { color: "var(--color-info)", tag: "INFO" },
};

function AlertCard({
  a,
  onHover,
  clearing = false,
}: {
  a: Alert;
  onHover: Props["onHover"];
  clearing?: boolean;
}) {
  const sev = SEV[a.severity];
  const critical = a.severity === "critical" && !clearing;
  return (
    <div
      className={`relative border-b border-[var(--color-line)] hover:bg-[var(--color-panel-strong)] ${
        clearing ? "opacity-45" : ""
      }`}
      onMouseEnter={() => onHover(a.flightIds)}
      onMouseLeave={() => onHover([])}
    >
      {/* Full-height severity rail: tier readable from the card edge alone. */}
      <div
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: sev.color }}
        aria-hidden
      />
      <div className="pl-4 pr-3 py-3">
        <div className="flex items-center gap-2 mb-1.5">
          <span
            className={`sev-chip ${critical ? "sev-inverse" : ""}`}
            style={critical ? undefined : { color: sev.color }}
          >
            {sev.tag}
          </span>
          <span className="font-mono text-xs uppercase tracking-[0.14em] text-[var(--color-text-dim)]">
            {a.category.replace(/-/g, " ")}
          </span>
          {a.lookaheadMin !== undefined && (
            <span className="font-mono text-xs px-1.5 py-0.5 border border-[var(--color-text-dim)] rounded-sm text-[var(--color-text-dim)] tracking-wider">
              +{a.lookaheadMin} MIN
            </span>
          )}
          {clearing && (
            <span className="font-mono text-xs px-1.5 py-0.5 border border-[var(--color-text-dim)] rounded-sm text-[var(--color-text-dim)] tracking-wider">
              CLEARING
            </span>
          )}
        </div>
        <div className="text-[15px] font-semibold text-[var(--color-text)] leading-snug mb-1">
          {a.title}
        </div>
        <div className="font-mono text-[13px] text-[var(--color-text-dim)] tabular-nums mb-2">
          {a.detail}
        </div>
        <div className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[13px] leading-snug">
          <span className="font-mono text-xs tracking-[0.14em] text-[var(--color-text-dim)] pt-0.5">
            REASON
          </span>
          <span className="text-[var(--color-text-dim)]">{a.reason}</span>
          <span
            className="font-mono text-xs tracking-[0.14em] pt-0.5"
            style={{ color: sev.color }}
          >
            ACTION
          </span>
          <span className="text-[var(--color-text)]">{a.suggestedAction}</span>
        </div>
      </div>
    </div>
  );
}

export function AlertsSidebar({ alerts, onHover, tracked }: Props) {
  // Alerts inside their grace period: detectors have stopped emitting them,
  // but they are not yet gone. Shown dimmed so a resolving condition fades
  // instead of blinking out.
  const clearing = (tracked ?? []).filter((t) => t.stale && t.suppressedBy === undefined);

  return (
    <aside className="panel w-[400px] shrink-0 flex flex-col min-h-0">
      <div className="panel-header flex items-center justify-between">
        <span>Alerts</span>
        <span className="font-mono tabular-nums">{alerts.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {alerts.length === 0 && clearing.length === 0 && (
          <div className="p-6 text-center">
            <div className="font-mono text-sm tracking-[0.2em] text-[var(--color-phosphor)] mb-2">
              SECTOR NOMINAL
            </div>
            <div className="text-[13px] text-[var(--color-text-dim)]">
              No alerts. All monitored separations inside limits.
            </div>
          </div>
        )}
        {alerts.map((a) => (
          <AlertCard key={a.id} a={a} onHover={onHover} />
        ))}
        {clearing.map((a) => (
          <AlertCard key={a.id} a={a} onHover={onHover} clearing />
        ))}
      </div>
    </aside>
  );
}
