import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AlertsSidebar } from "#/components/AlertsSidebar";
import { FlightStrips } from "#/components/FlightStrips";
import { HeaderBar } from "#/components/HeaderBar";
import { IncidentBanner } from "#/components/IncidentBanner";
import { RadarMap } from "#/components/RadarMap";
import { RunwayGatePanel } from "#/components/RunwayGatePanel";
import type { ScenarioId } from "#/sim/scenarios";
import { useSim } from "#/sim/store";
import { seo } from "#/lib/seo";

export const Route = createFileRoute("/")({
  component: Dashboard,
  head: () =>
    seo({
      path: "/",
      title: "ATC Decision Support — live demo",
      description:
        "Interactive air traffic control decision-support prototype: eleven deterministic doctrinal detectors behind a predictive orchestrator, replayed against documented incidents including the 2025 Potomac mid-air.",
    }),
});

function Dashboard() {
  const { state, dispatch } = useSim();
  const [hovered, setHovered] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [scenario, setScenario] = useState<ScenarioId>("nominal");
  const highlighted = hovered.length > 0 ? hovered : selected;

  const toggleSelect = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  };

  const loadScenario = (id: ScenarioId) => {
    setScenario(id);
    setSelected([]);
    setHovered([]);
    dispatch({ type: "loadScenario", id });
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-[var(--color-bg)] text-[var(--color-text)]">
      <HeaderBar
        state={state}
        scenario={scenario}
        onScenario={loadScenario}
        onSpeed={(speed) => dispatch({ type: "setSpeed", speed })}
        onReset={() => loadScenario(scenario)}
      />
      <IncidentBanner
        scenario={scenario}
        onDismiss={() => loadScenario("nominal")}
      />

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

        <AlertsSidebar alerts={state.alerts} onHover={setHovered} />
      </div>
    </div>
  );
}
