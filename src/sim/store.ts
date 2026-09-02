import { useEffect, useReducer } from "react";
import { seedState } from "./data";
import { tick } from "./engine";
import { runPredictiveRules } from "./predict";
import { SCENARIOS, type ScenarioId } from "./scenarios";
import { resetTrails, updateTrails } from "./trails";
import type { Flight, SimState } from "./types";

type Action =
  | { type: "tick"; dtMin: number }
  | { type: "setSpeed"; speed: SimState["speed"] }
  | { type: "reassignRunway"; flightId: string; runwayId: string }
  | { type: "reassignGate"; flightId: string; gateId: string }
  | { type: "loadScenario"; id: ScenarioId }
  | { type: "reset" };

const updateFlight = (flights: Flight[], id: string, patch: Partial<Flight>): Flight[] =>
  flights.map((f) => (f.id === id ? { ...f, ...patch } : f));

const reducer = (state: SimState, action: Action): SimState => {
  switch (action.type) {
    case "tick": {
      const advanced = tick(state, action.dtMin);
      const trails = updateTrails(state.trails, advanced.flights);
      return { ...advanced, trails, alerts: runPredictiveRules(advanced) };
    }
    case "setSpeed":
      return { ...state, speed: action.speed };
    case "reassignRunway": {
      const flights = updateFlight(state.flights, action.flightId, { assignedRunway: action.runwayId });
      const next = { ...state, flights };
      return { ...next, alerts: runPredictiveRules(next) };
    }
    case "reassignGate": {
      const flights = updateFlight(state.flights, action.flightId, { assignedGate: action.gateId });
      const next = { ...state, flights };
      return { ...next, alerts: runPredictiveRules(next) };
    }
    case "loadScenario": {
      const scenario = SCENARIOS.find((s) => s.id === action.id);
      if (!scenario) return state;
      const next = scenario.build();
      return { ...next, trails: resetTrails(), alerts: runPredictiveRules(next) };
    }
    case "reset": {
      const fresh = seedState();
      return { ...fresh, trails: resetTrails(), alerts: runPredictiveRules(fresh) };
    }
  }
};

const initial = (): SimState => {
  const s = seedState();
  return { ...s, trails: resetTrails(), alerts: runPredictiveRules(s) };
};

export const useSim = () => {
  const [state, dispatch] = useReducer(reducer, undefined, initial);

  useEffect(() => {
    if (state.speed === 0) return;
    const id = setInterval(() => {
      dispatch({ type: "tick", dtMin: 0.25 });
    }, 1000);
    return () => clearInterval(id);
  }, [state.speed]);

  return { state, dispatch };
};
